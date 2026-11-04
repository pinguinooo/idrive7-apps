'use strict';
/**
 * Shift Lights - RPM shift lights on the instrument cluster (under the M logo) and the HUD, drawn by the
 * cluster-render service (cluster_render_client.js); the centre screen shows a live preview. The cluster and
 * the HUD each show their own style ("Cluster: style", "HUD: style" in the settings), switched live.
 * Tunables: config.js. Pure maths: logic.js, geom.js. Every callback goes through safety.guard: nothing may throw
 * out of the main loop (the kit exits on an uncaught exception, and the car wipes then uninstalls an app
 * that crashes). Kill switches: the "Shift lights on" setting, "Show on" = Off, or the kill file whose path
 * is logged at start.
 */
const fs = require('fs');
const mgu = require('./kit/mgu');
const Car = require('./kit/car');
const L = require('./logic');
const { createSafety } = require('./safety');
const { createOutput } = require('./output');
const { ClusterRender } = require('./cluster_render_client');
const { Canvas } = require('./kit/canvas');
const view = require('./view');

const RATE_LOG_MS = 30000;

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        try {
            const checked = L.validateConfig(require('./config'));
            const cfg = checked.cfg;
            checked.errors.forEach((e) => log.warn('config: ' + e));
            const safety = createSafety({ cfg, log });
            const guard = safety.guard;
            // SHIFTLIGHTS_CR_SOCKET: the emulator's fake service; unset on the car (the client's default path)
            const makeCanvas = (w, h) => new Canvas(w, h);
            const output = createOutput({ ClusterRender, socketPath: process.env.SHIFTLIGHTS_CR_SOCKET || undefined, log, cfg, guard, makeCanvas });
            const killPath = safety.killFile(ctx.dataDir);
            log.info('kill switch file: ' + killPath);

            const car = new Car(ctx, ['rpm', 'temps', 'speed', 'gear']);
            let d = {}, mt = null, th = null, states = { cluster: null, hud: null }, killed = safety.pollKill(fs, killPath);
            let samples = 0, logged = {}, lastMtKey = '', sel = null, lastStyles = { cluster: '', hud: '' };
            const OFF = { lit: 0, red: false, flashing: false, flashT0: null }, warned = Object.create(null);
            const get = (k) => settings.get(k);

            /** Both displays' style settings, checked (a bad saved value falls back, logged once per value). */
            function readSel() {
                const s = { cluster: L.readStyle(cfg, get, 'cluster'), hud: L.readStyle(cfg, get, 'hud') };
                s.cluster.warnings.concat(s.hud.warnings).forEach((w) => { if (!warned[w]) { warned[w] = true; log.warn('settings: ' + w); } });
                return s;
            }
            /** A display's next state for its style's lights (none: all off); a new style starts from off. */
            function next(which, now) {
                const lights = L.lightsOf(cfg, which, sel[which].style);
                const prev = sel[which].style === lastStyles[which] ? states[which] : null;
                lastStyles[which] = sel[which].style;
                return lights ? L.step(prev, d.rpm, th, lights.count, cfg, now, lights.reds) : OFF;
            }

            const offReason = () => (killed ? 'OFF: kill file' : !settings.get('enabled') ? 'OFF: setting'
                : safety.tripped() ? 'STOPPED after errors: turn Shift lights off and on'
                    : settings.get('display') === 'off' ? 'DISPLAY OFF' : d.demo ? 'DEMO DATA: nothing sent to the cluster' : '');

            /** Thresholds, states and output from the latest sample and settings. */
            function refresh(now) {
                mt = L.modeThresholds(cfg, (k) => settings.get(k), settings.get('driveMode'));
                const k = JSON.stringify(mt);
                if (k !== lastMtKey) { lastMtKey = k; log.info('thresholds ' + k); if (mt.invalid) log.warn('the ' + mt.mode + ' start/shift settings do not fit (shift 200+ over start, under the limit): using config.js'); }
                th = L.thresholds(cfg, mt, d.oil);
                sel = readSel();
                states = { cluster: next('cluster', now), hud: next('hud', now) };
                const active = !offReason();
                const display = settings.get('display');
                output.apply({ display, active, sel, states, rpm: d.rpm, th, gear: d.gear });
                const s = states.cluster, h = states.hud;
                const line = { cluster: sel.cluster.style, hud: sel.hud.style, lit: s.lit, hudLit: h.lit, red: s.red || h.red, flash: s.flashing || h.flashing, display, active };
                if (JSON.stringify(line) !== JSON.stringify(logged)) { logged = line; log.info('state ' + JSON.stringify(line) + ' rpm ' + (isFinite(d.rpm) ? Math.round(d.rpm) : 'n/a') + (d.demo ? ' demo' : '')); }
            }
            const refreshNow = guard('refresh', () => refresh(Date.now()));

            safety.onTrip(() => { output.apply({ display: 'off', active: false, sel, states }); });
            car.onSample(guard('sample', (data) => { d = data; samples++; refresh(Date.now()); }),
                guard('source', () => { states = { cluster: OFF, hud: OFF }; }));
            setInterval(guard('rate', () => { log.info('rpm samples/s: ' + (samples * 1000 / RATE_LOG_MS).toFixed(1) + (d.demo ? ' (demo)' : '')); samples = 0; }), RATE_LOG_MS);

            let wasEnabled = settings.get('enabled');
            settings.onChange(guard('settings', (key, value) => {
                if (key === 'enabled') {
                    if (value && !wasEnabled && safety.tripped()) { safety.reset(); log.info('safety reset by the Shift lights setting'); }
                    wasEnabled = !!value;
                }
                refreshNow();
            }));
            setInterval(guard('kill', () => {
                const k = safety.pollKill(fs, killPath);
                if (k !== killed) { killed = k; log.warn(k ? 'kill file found: output off' : 'kill file gone: output allowed'); refreshNow(); }
            }), cfg.safety.killPollMs);
            ui.onClick('BTN_DISPLAY', guard('show on', () => settings.cycle('display')));

            ctx.loop('MAIN', 30, guard('draw', async () => {
                const t = ctx.theme(), cv = ctx.canvas(1600, 520).clear(t.bg);
                view.draw(cv, t, {
                    cfg, now: Date.now(), rpm: d.rpm, oil: d.oil, gear: d.gear, demo: !!d.demo, mt: mt || L.modeThresholds(cfg, get, settings.get('driveMode')),
                    th: th || L.thresholds(cfg, cfg.modes[cfg.driveMode], undefined), states: { cluster: states.cluster || OFF, hud: states.hud || OFF },
                    sel: sel || readSel(), display: settings.get('display'), offReason: offReason(), link: output.status(),
                });
                await ui.image('MAIN_GFX', cv);
            }));
            refreshNow();
            log.info('started: display ' + settings.get('display') + ', mode ' + settings.get('driveMode') + ', cluster ' + (sel || readSel()).cluster.style + ', hud ' + (sel || readSel()).hud.style);
        } catch (e) {
            log.error('start: ' + (e && e.stack || e));
        }
    },
});
