'use strict';
/**
 * Shift Lights - RPM shift lights on the instrument cluster (under the M logo) and the HUD, drawn by the
 * cluster-render service (cluster_render_client.js); the centre screen shows a live preview. "HUD" and
 * "Instrument cluster" are two on/off settings; each shows its own style ("HUD: style", "Cluster: style"), live.
 * The drive mode comes from the car (FES drive experience) when it sends one, else from the setting.
 * Tunables: config.js. Pure maths: logic.js, geom.js. Every callback goes through safety.guard: nothing may throw
 * out of the main loop (the kit exits on an uncaught exception, and the car wipes then uninstalls an app
 * that crashes). Kill switches: both on/off settings off, or the kill file whose path is logged at start.
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
const FES = 'de.bmw.infotainment.drivingexcitement.FES';

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

            const get = (k) => settings.get(k);
            // 0.2.x saved "enabled" + "display": move them to the two on/off settings once (before any listener)
            const moves = L.migrateSettings(get);
            moves.forEach((w) => { try { settings.set(w[0], w[1]); } catch (e) { log.warn('settings migration ' + w[0] + ': ' + e); } });
            if (moves.length) log.info('settings migrated to v' + L.SETTINGS_V + ': ' + JSON.stringify(moves));

            let carMode = null;     // the car's drive mode (logic.driveModeOf), null until it sends one
            const car = new Car(ctx, ['rpm', 'temps', 'speed', 'gear'], {
                [FES]: {
                    statusFESVehicleDynamicSwitchHMI: guard('drive mode', (v) => {
                        const m = L.driveModeOf(v && v.actualValueModeDrivingExperience);
                        if (m === carMode) return;
                        carMode = m;
                        log.info('car drive mode ' + JSON.stringify(v && v.actualValueModeDrivingExperience) + ' -> ' + (m || 'none: using the setting'));
                        refreshNow();
                    }),
                },
            });
            let d = {}, mt = null, th = null, states = { cluster: null, hud: null }, killed = safety.pollKill(fs, killPath);
            let samples = 0, logged = {}, lastMtKey = '', sel = null, lastStyles = { cluster: '', hud: '' };
            const OFF = { lit: 0, red: false, flashing: false, flashT0: null }, warned = Object.create(null);
            // "Start with the car" off: the platform starts the app anyway, so nothing is sent until MAIN was shown
            let opened = ui.isVisible('MAIN');
            ui.onVisible(guard('visible', (name, v) => { if (name === 'MAIN' && v && !opened) { opened = true; refreshNow(); } }));

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

            const eff = () => L.effectiveMode(carMode, get, cfg);
            const offReason = () => {
                if (killed) return 'OFF: kill file';
                if (L.readDisplays(get).display === 'off') return 'OFF: HUD and cluster are both off';
                if (safety.tripped()) return 'STOPPED after errors: turn HUD or cluster off and on';
                if (get('autoStart') === false && !opened) return 'WAITING: open Shift Lights once (Start with the car is off)';
                const e = eff();
                if (L.holdForSportPlus(get('onlySportPlus'), e)) return 'WAITING FOR SPORT+ (now ' + e.mode.toUpperCase().replace('PLUS', '+') + ')';
                return d.demo ? 'DEMO DATA: nothing sent to the cluster' : '';
            };

            /** Thresholds, states and output from the latest sample and settings. */
            function refresh(now) {
                mt = L.modeThresholds(cfg, get, eff().mode);
                const k = JSON.stringify(mt);
                if (k !== lastMtKey) { lastMtKey = k; log.info('thresholds ' + k); if (mt.invalid) log.warn('the ' + mt.mode + ' start/shift settings do not fit (shift 200+ over start, under the limit): using config.js'); }
                th = L.thresholds(cfg, mt, d.oil);
                sel = readSel();
                states = { cluster: next('cluster', now), hud: next('hud', now) };
                const active = !offReason();
                const display = L.readDisplays(get).display;
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

            const was = { hudOn: get('hudOn') === true, clusterOn: get('clusterOn') === true };
            settings.onChange(guard('settings', (key, value) => {
                if (key === 'hudOn' || key === 'clusterOn') {
                    if (value === true && !was[key] && safety.tripped()) { safety.reset(); log.info('safety reset by the ' + key + ' setting'); }
                    was[key] = value === true;
                }
                refreshNow();
            }));
            setInterval(guard('kill', () => {
                const k = safety.pollKill(fs, killPath);
                if (k !== killed) { killed = k; log.warn(k ? 'kill file found: output off' : 'kill file gone: output allowed'); refreshNow(); }
            }), cfg.safety.killPollMs);
            ui.onClick('BTN_HUD', guard('hud on/off', () => settings.cycle('hudOn')));
            ui.onClick('BTN_CLUSTER', guard('cluster on/off', () => settings.cycle('clusterOn')));

            ctx.loop('MAIN', 30, guard('draw', async () => {
                const t = ctx.theme(), cv = ctx.canvas(1600, 520).clear(t.bg);
                view.draw(cv, t, {
                    cfg, now: Date.now(), rpm: d.rpm, oil: d.oil, gear: d.gear, demo: !!d.demo, mt: mt || L.modeThresholds(cfg, get, eff().mode),
                    th: th || L.thresholds(cfg, cfg.modes[cfg.driveMode], undefined), states: { cluster: states.cluster || OFF, hud: states.hud || OFF },
                    sel: sel || readSel(), displays: L.readDisplays(get), eff: eff(), onlySportPlus: get('onlySportPlus') === true,
                    offReason: offReason(), link: output.status(),
                });
                await ui.image('MAIN_GFX', cv);
            }));
            refreshNow();
            log.info('started: show ' + L.readDisplays(get).display + ', mode ' + JSON.stringify(eff()) + ', cluster ' + (sel || readSel()).cluster.style + ', hud ' + (sel || readSel()).hud.style);
        } catch (e) {
            log.error('start: ' + (e && e.stack || e));
        }
    },
});
