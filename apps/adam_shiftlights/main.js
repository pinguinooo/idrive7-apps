'use strict';
/**
 * Shift Lights - RPM shift lights on the instrument cluster (under the M logo) and the HUD, drawn by the
 * cluster-render service (cluster_render_client.js). The centre screen holds the settings pages (ui.js: Home, HUD,
 * Cluster, Behavior, About), drawn only when something changes: no preview, no render loop. "HUD" and
 * "Instrument cluster" are two on/off settings; each shows its own style, live.
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
const { createRpmPoll, pct } = require('./rpmpoll');
const { ClusterRender } = require('./cluster_render_client');
const { Canvas } = require('./kit/canvas');
const { createUi } = require('./ui');

const RATE_LOG_MS = 30000;
const FES = 'de.bmw.infotainment.drivingexcitement.FES';
const CDS = 'de.bmw.infotainment.vehicle.CDS';

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

            // the settings pages: drawn on a change only (a setting, a tab, the layout, a status event), coalesced
            // into one guarded draw; never from refresh() or the rpm path. The kit resends the last frame by itself.
            const pages = createUi();
            let drawQueued = false;
            const draw = guard('draw', () => {
                drawQueued = false;
                if (!ui.isVisible('MAIN')) return;
                const t = ctx.theme(), cv = ctx.canvas(1600, 520).clear(t.bg);
                pages.draw(cv, t, { get, schema: settings.schema || (ctx.spec && ctx.spec.settings) || [], cfg, carMode, offReason: offReason(), version: (ctx.spec && ctx.spec.version) || '' }, act);
                return ui.image('MAIN_GFX', cv);
            });
            function changed() { if (!drawQueued) { drawQueued = true; setTimeout(draw, 0); } }
            /** What a page button does: its settings writes (settings.onChange then redraws). */
            const act = (writes) => guard('ui ' + writes.map((w) => w[0]).join(' '), () => { writes.forEach((w) => settings.set(w[0], w[1])); });

            let carMode = null;     // the car's drive mode (logic.driveModeOf), null until it sends one
            // "Fast RPM": Car's own rpm handler, counted on the subscription and fed by the getter when the car's
            // updates are slow, so the polled rpm goes through Car (data(), gear guess, onSample) like any other
            const poll = createRpmPoll({ cfg: cfg.rpm, log, enabled: () => L.readLead(cfg, get).poll && !offReason() && !d.demo });
            const watched = [];
            const signals = ctx.signals && Object.assign({}, ctx.signals, {
                watch(iface, inst, handlers, lg, opts) {
                    const own = iface === CDS && handlers && typeof handlers.statusEngineSpeed2 === 'function' ? handlers.statusEngineSpeed2 : null;
                    const p = Promise.resolve(ctx.signals.watch(iface, inst, own ? Object.assign({}, handlers, { statusEngineSpeed2: poll.wrap(own) }) : handlers, lg, opts));
                    watched.push(p);
                    if (own) p.then(guard('rpm poll attach', (res) => poll.attach(res, own)), () => {});
                    return p;
                },
            });
            const car = new Car(Object.assign({}, ctx, { signals }), ['rpm', 'temps', 'speed', 'gear'], {
                [FES]: {
                    statusFESVehicleDynamicSwitchHMI: guard('drive mode', (v) => {
                        const m = L.driveModeOf(v && v.actualValueModeDrivingExperience);
                        if (m === carMode) return;
                        carMode = m;
                        log.info('car drive mode ' + JSON.stringify(v && v.actualValueModeDrivingExperience) + ' -> ' + (m || 'none: using the setting'));
                        refreshNow();
                        changed();
                    }),
                },
            });
            let d = {}, mt = null, th = null, states = { cluster: null, hud: null }, killed = safety.pollKill(fs, killPath);
            let samples = 0, logged = {}, lastMtKey = '', sel = null, lastStyles = { cluster: '', hud: '' };
            let lead = L.makeLead(cfg.rpm), sampleT = null, litChanges = 0, refreshMs = [];
            const OFF = { lit: 0, red: false, flashing: false, flashT0: null }, warned = Object.create(null);
            // "Start with the car" off: the platform starts the app anyway, so nothing is sent until MAIN was shown
            let opened = ui.isVisible('MAIN');
            ui.onVisible(guard('visible', (name, v) => {
                if (name !== 'MAIN' || !v) return;
                if (!opened) { opened = true; refreshNow(); }
                changed();
            }));

            /** Both displays' style settings, checked (a bad saved value falls back, logged once per value). */
            function readSel() {
                const s = { cluster: L.readStyle(cfg, get, 'cluster'), hud: L.readStyle(cfg, get, 'hud') };
                s.cluster.warnings.concat(s.hud.warnings).forEach((w) => { if (!warned[w]) { warned[w] = true; log.warn('settings: ' + w); } });
                return s;
            }
            /** The lead setting, checked (a bad saved value falls back, logged once per value). */
            function readLead() {
                const r = L.readLead(cfg, get);
                r.warnings.forEach((w) => { if (!warned[w]) { warned[w] = true; log.warn('settings: ' + w); } });
                return r;
            }
            /**
             * A display's next state for its style's lights; a new style starts from off. p: lead(). The bracket style has
             * no lights: one stand-in light, so its fill still turns red and flashes at the shift point (0.4.2).
             */
            function next(which, now, p) {
                const lights = L.lightsOf(cfg, which, sel[which].style) || { count: 1, reds: 1 };
                const prev = sel[which].style === lastStyles[which] ? states[which] : null;
                lastStyles[which] = sel[which].style;
                return L.step(prev, p.rpm, th, lights.count, cfg, now, lights.reds, p.add);
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
                const p = lead(d.rpm, sampleT !== null ? sampleT : now, readLead().leadMs);
                const before = states;
                states = { cluster: next('cluster', now, p), hud: next('hud', now, p) };
                if (!before.cluster || !before.hud || before.cluster.lit !== states.cluster.lit || before.hud.lit !== states.hud.lit) litChanges++;
                const active = !offReason();
                const display = L.readDisplays(get).display;
                output.apply({ display, active, sel, states, rpm: p.rpm, th, gear: L.gearGlyph(d.stage, d.gear) });
                const s = states.cluster, h = states.hud;
                // no lit counts here: a log line is a synchronous file write, and the lights change many times a second
                const line = { cluster: sel.cluster.style, hud: sel.hud.style, red: s.red || h.red, flash: s.flashing || h.flashing, display, active };
                if (JSON.stringify(line) !== JSON.stringify(logged)) { logged = line; log.info('state ' + JSON.stringify(line) + ' lit ' + s.lit + '/' + h.lit + ' rpm ' + (isFinite(d.rpm) ? Math.round(d.rpm) : 'n/a') + (d.demo ? ' demo' : '')); }
            }
            const refreshNow = guard('refresh', () => refresh(Date.now()));

            safety.onTrip(() => { output.apply({ display: 'off', active: false, sel, states }); changed(); });
            car.onSample(guard('sample', (data, t) => {
                d = data; samples++; sampleT = typeof t === 'number' ? t : null;
                const t0 = process.hrtime();
                refresh(Date.now());
                const dt = process.hrtime(t0);
                if (refreshMs.length < 2000) refreshMs.push(dt[0] * 1e3 + dt[1] / 1e6);
            }), guard('source', () => { states = { cluster: OFF, hud: OFF }; lead = L.makeLead(cfg.rpm); sampleT = null; changed(); }));
            const ms = (v) => (v === null ? '-' : v.toFixed(v < 10 ? 1 : 0));
            setInterval(guard('rate', () => {
                const r = poll.stats();
                // "rpm samples/s:" = every Car sample (rpm, speed and polled ticks); notified = the car's rpm notifications alone
                log.info('rpm samples/s: ' + (samples * 1000 / RATE_LOG_MS).toFixed(1) + (d.demo ? ' (demo)' : '') +
                    ', notified/s ' + r.notified.toFixed(1) + ' gap p50/p90 ' + ms(r.gapP50) + '/' + ms(r.gapP90) + ' ms' +
                    ', polled/s ' + r.polled.toFixed(1) + ' rtt p50/max ' + ms(r.rttP50) + '/' + ms(r.rttMax) + ' ms, poll failures ' + r.fails +
                    ', refresh p50/max ' + ms(pct(refreshMs, 0.5)) + '/' + ms(pct(refreshMs, 1)) + ' ms, lit changes ' + litChanges);
                samples = 0; litChanges = 0; refreshMs = [];
            }), RATE_LOG_MS);

            const was = { hudOn: get('hudOn') === true, clusterOn: get('clusterOn') === true };
            settings.onChange(guard('settings', (key, value) => {
                if (key === 'hudOn' || key === 'clusterOn') {
                    if (value === true && !was[key] && safety.tripped()) { safety.reset(); log.info('safety reset by the ' + key + ' setting'); }
                    was[key] = value === true;
                }
                refreshNow();
                changed();
            }));
            setInterval(guard('kill', () => {
                const k = safety.pollKill(fs, killPath);
                if (k !== killed) { killed = k; log.warn(k ? 'kill file found: output off' : 'kill file gone: output allowed'); refreshNow(); changed(); }
            }), cfg.safety.killPollMs);
            ui.onClick('BTN_HUD', guard('hud on/off', () => settings.cycle('hudOn')));
            ui.onClick('BTN_CLUSTER', guard('cluster on/off', () => settings.cycle('clusterOn')));

            // where the kit runs the screen the pages do the bar's jobs, so its buttons go; elsewhere they stay and
            // BTN_ALL opens the HMI's settings list (every setting)
            if (ctx.hideButton) ['BTN_HUD', 'BTN_CLUSTER', 'BTN_ALL'].forEach((b) => ctx.hideButton(b));
            ui.onClick('BTN_ALL', guard('settings button', () => ui.open && ui.open('SETTINGS')));
            if (ctx.onTab) ctx.onTab(guard('tab', (i) => { pages.tab(i); changed(); }));
            if (ctx.onLayout) ctx.onLayout(guard('layout', changed));
            if (ui.onFocus) ui.onFocus(guard('focus', (name, on) => { if (name === 'MAIN' && on) changed(); }));
            Promise.all(watched).then(guard('rpm poll start', () => poll.start()), (e) => log.warn('rpm poll not started: ' + e));
            refreshNow();
            changed();
            const lr = readLead();
            log.info('started: show ' + L.readDisplays(get).display + ', mode ' + JSON.stringify(eff()) + ', cluster ' + (sel || readSel()).cluster.style + ', hud ' + (sel || readSel()).hud.style +
                ', lead ' + lr.leadMs + ' ms, rpm poll ' + (lr.poll ? 'on' : 'off'));
        } catch (e) {
            log.error('start: ' + (e && e.stack || e));
        }
    },
});
