'use strict';
/* Shift Lights 0.4.3: the one-time move of old HUD defaults (and the old manual night dim), the HUD page's defaults and its
 * Reset HUD to defaults (asks first), Night dim Auto from the car's day / night (decoding, the hold, the page line), and
 * Flash mode App (output.js with a fake client and fake timers: the order, the rate, in step, the stop, a backed-up socket).
 * End to end with the real main.js: main_flow.test.js ("0.4.3 ..."). */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const Module = require('module');
const L = require('../../apps/adam_shiftlights/logic');
const P = require('../../apps/adam_shiftlights/pages');
const { createOutput } = require('../../apps/adam_shiftlights/output');
const { createSafety } = require('../../apps/adam_shiftlights/safety');
const { Canvas } = require('../../kit/runtime/canvas.js');
const config = require('../../apps/adam_shiftlights/config');
const cfg = L.validateConfig(config).cfg;
const APP = path.join(__dirname, '..', '..', 'apps', 'adam_shiftlights');
const KIT = path.join(__dirname, '..', '..', 'kit', 'runtime');
const SPEC = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));
const item = (k) => SPEC.settings.filter((s) => s.key === k)[0];
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (req, parent) {
    if (/^\.\/kit\//.test(req) && parent && parent.filename && path.dirname(parent.filename) === APP) return realResolve.call(this, path.join(KIT, req.slice(6)), parent);
    return realResolve.apply(this, arguments);
};
const { createUi } = require('../../apps/adam_shiftlights/ui');
Module._resolveFilename = realResolve;
const { Recorder } = require(path.join(KIT, 'record.js'));
const themes = require(path.join(KIT, 'themes.js'));

const model = (saved, more) => {
    const vals = {};
    SPEC.settings.forEach((s) => { vals[s.key] = s.default; });
    Object.assign(vals, saved);
    return Object.assign({ get: (k) => vals[k], schema: SPEC.settings, cfg, carMode: null, offReason: '', version: SPEC.version }, more);
};
const mig = (saved) => { const o = {}; L.migrateSettings((k) => saved[k], cfg).forEach((w) => { o[w[0]] = w[1]; }); return o; };

/* ---- a fake cluster-render client and fake timers for output.js ---- */
class FakeCR extends EventEmitter {
    constructor() { super(); FakeCR.last = this; this.sent = []; this.blocked = false; this.n = 0; }
    connect() {}
    close() {}
    effect() { return ++this.n; }
    image() { return ++this.n; }
    uniform(ref, name, v) { this.sent.push(['uniform', ref, name, v.join(' ')]); }
    animate(ref, o) { this.sent.push(['animate', ref, o.keys]); return 1; }
    stop(ref) { this.sent.push(['stop', ref]); }
    set() {}
    pixels() { return true; }
    drop(ref) { this.sent.push(['drop', ref]); }
}
function fakeTimers() {
    const T = { live: [], setInterval(fn, ms) { const t = { fn, ms }; T.live.push(t); return t; }, clearInterval(t) { T.live = T.live.filter((x) => x !== t); } };
    T.tick = () => T.live.slice().forEach((t) => t.fn());
    return T;
}
function rig(c) {
    const lines = [], timers = fakeTimers();
    const log = { info: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push('ERR ' + m) };
    const safety = createSafety({ cfg: c || cfg, log });
    const out = createOutput({ ClusterRender: FakeCR, log, cfg: c || cfg, guard: safety.guard, makeCanvas: (w, h) => new Canvas(w, h), timers });
    return { out, timers, lines, safety, cr: () => FakeCR.last };
}
const SEL = (h) => ({ cluster: L.readStyle(cfg, () => undefined, 'cluster'), hud: Object.assign(L.readStyle(cfg, (k) => item(k) && item(k).default, 'hud'), { style: h || 'large' }) });
const ST = (flashing) => ({ cluster: { lit: 10, flashing }, hud: { lit: 10, flashing } });
const A = (flashing, more) => Object.assign({ display: 'hud', active: true, sel: SEL(), states: ST(flashing), rpm: 6800, th: L.thresholds(cfg, cfg.modes.sportplus, 95), gear: 3 }, more);
const ons = (cr, from) => cr.sent.slice(from || 0).filter((m) => m[0] === 'uniform' && m[2] === 'u_on');

module.exports = [
    // ---- 1. HUD defaults ----
    ['migration (once): a saved old default moves to today\'s (100 % -> 110, centre -> 80 px left / 60 px down, bar +70 -> 0); every other value stays', () => {
        const D = cfg.hud.defaults;
        assert.deepStrictEqual(mig({ _settingsV: 3, hudSize: 100, hudX: 0, hudY: 0, hudBarX: 70 }), { hudSize: D.size, hudX: D.x, hudY: D.y, hudBarX: D.barX, _settingsV: L.SETTINGS_V });
        // one at a time: only the key that holds its old default
        [['hudSize', 100, D.size], ['hudX', 0, D.x], ['hudY', 0, D.y], ['hudBarX', 70, D.barX]].forEach((x) => {
            const saved = { _settingsV: 3, hudSize: 120, hudX: -30, hudY: 20, hudBarX: 25 };
            saved[x[0]] = x[1];
            const w = {}; w[x[0]] = x[2]; w._settingsV = L.SETTINGS_V;
            assert.deepStrictEqual(mig(saved), w, x[0]);
        });
        // today's defaults, chosen values, steps next to the old default, garbage and a missing key: nothing moves
        [{ hudSize: 110, hudX: -80, hudY: 60, hudBarX: 0 }, { hudSize: 90, hudX: 10, hudY: -10, hudBarX: 65 }, { hudSize: '100', hudX: null, hudY: false, hudBarX: '70' }, {}]
            .forEach((v) => assert.deepStrictEqual(mig(Object.assign({ _settingsV: 3 }, v)), { _settingsV: L.SETTINGS_V }, JSON.stringify(v)));
        // the old manual night dim: on -> Night dim On; off, missing or garbage -> nothing (Auto, the default)
        assert.deepStrictEqual(mig({ _settingsV: 3, hudNight: true, clusterNight: true }), { hudNightMode: 'on', clusterNightMode: 'on', _settingsV: L.SETTINGS_V });
        assert.deepStrictEqual(mig({ _settingsV: 3, hudNight: false, clusterNight: 'yes' }), { _settingsV: L.SETTINGS_V });
        // runs once: a v4 save is never moved again (100 % chosen after 0.4.3 stays)
        assert.deepStrictEqual(L.migrateSettings((k) => ({ _settingsV: L.SETTINGS_V, hudSize: 100, hudBarX: 70, hudNight: true })[k], cfg), []);
        // without cfg (older callers): the built-in defaults, the same values
        assert.deepStrictEqual(L.migrateSettings((k) => ({ _settingsV: 3, hudSize: 100 })[k]), [['hudSize', 110], ['_settingsV', L.SETTINGS_V]]);
        assert.deepStrictEqual(L.OLD_DEFAULTS, [['hudSize', 100], ['hudX', 0], ['hudY', 0], ['hudBarX', 70]]);
    }],
    ['HUD page: every stepper says its default; the HMI list marks the HUD moves too; app.json, config.js and the page agree', () => {
        const D = cfg.hud.defaults, v = P.view(1, model({ hudOn: true })), by = (id) => v.rows.filter((r) => r.id === id)[0];
        assert.deepStrictEqual([D.size, D.x, D.y, D.barX], ['hudSize', 'hudX', 'hudY', 'hudBarX'].map((k) => item(k).default));
        assert.strictEqual(by('hudSize').desc, 'Bigger grows upward. Default 110%');
        assert.strictEqual(by('hudBright').desc, 'How bright the lit lights are. Default 100%');
        assert.strictEqual(by('hudX').desc, 'Line it up over the speed. Default 80 px left');
        assert.strictEqual(by('hudY').desc, 'Fine-tune where it sits over the speed. Default 60 px down');
        assert.strictEqual(by('hudBarX').desc, 'Moves the shift bar only; kept inside the visible area. Default same as the HUD');
        assert.deepStrictEqual(['hudSize', 'hudX', 'hudY', 'hudBarX'].map((k) => by(k).value), ['110%', '80 px left', '60 px down', 'Same as the HUD']);
        // the cluster's 0 already reads "Default": its moves say nothing more; its size does
        const c = P.view(2, model({ clusterOn: true })), cby = (id) => c.rows.filter((r) => r.id === id)[0];
        assert.deepStrictEqual([cby('clusterX').desc, cby('clusterSize').desc], ['Keep it clear of the dial numbers', 'Grows from its centre. Default 100%']);
        ['hudX', 'hudY', 'hudBarX', 'hudSize', 'hudBright'].forEach((k) => assert.strictEqual(item(k).markDefault, true, k));
    }],
    ['Reset HUD to defaults: only with the HUD on, writes only what differs (size, move, bar move), asks first, dimmed when all are at their defaults', () => {
        const D = cfg.hud.defaults;
        const off = P.view(1, model({ hudOn: true, hudSize: 120, hudX: -30, hudY: 0, hudBarX: 25, hudBright: 40, hudStyle: 'bar' })).noteAction;
        assert.deepStrictEqual([off.key, off.text, off.confirm, off.busy], ['hud:reset', 'Reset HUD to defaults', true, false]);
        assert.deepStrictEqual(off.writes, [['hudSize', D.size], ['hudX', D.x], ['hudY', D.y], ['hudBarX', D.barX]], 'brightness and style are not part of it');
        assert.deepStrictEqual(P.view(1, model({ hudOn: true, hudX: 0 })).noteAction.writes, [['hudX', D.x]]);
        const same = P.view(1, model({ hudOn: true }));
        assert.deepStrictEqual([same.noteAction.busy, same.noteAction.writes], [true, []]);
        assert.ok(P.controlsOf(same).every((x) => x.key !== 'hud:reset'));
        assert.strictEqual(P.view(1, model({})).noteAction.key, 'hud:turnon', 'HUD off: the button turns it on');
        assert.ok(!P.view(2, model({ clusterOn: true, clusterSize: 70 })).noteAction, 'none on the Cluster page');
    }],
    ['the confirm: the first press arms "Confirm reset" (nothing saved, a draw asked), the second within 5 s saves; it runs out after 5 s or with the clock set back', () => {
        const realNow = Date.now, realSet = global.setTimeout;
        let skew = 0, draws = 0, timeouts = 0;
        Date.now = () => realNow() + skew;
        global.setTimeout = (fn, ms) => { timeouts++; return realSet(() => {}, 0); };   // the run-out redraw: counted, not waited
        try {
            const ui = createUi(() => { draws++; }), m = model({ hudOn: true, hudSize: 120 }), ran = [];
            const frame = () => {
                ui.tab(1);
                const r = new Recorder(1600, 520, { textScale: 1 }).reset(), text = r.text, texts = [];
                r.own = true; r.chrome = { tabs: null };
                r.text = function (s) { texts.push(String(s)); return text.apply(this, arguments); };
                ui.draw(r, themes.theme('m_tricolour'), m, (writes) => () => { ran.push(writes); });
                return { texts, press: () => r.targets.filter((g) => g.key === 'hud:reset')[0].run() };
            };
            let f = frame();
            assert.ok(f.texts.indexOf('RESET HUD TO DEFAULTS') >= 0);
            f.press();
            assert.deepStrictEqual([ran.length, draws, timeouts], [0, 1, 1], 'armed: nothing saved, a draw now and one at the run-out');
            f = frame();
            assert.ok(f.texts.indexOf('CONFIRM RESET') >= 0, f.texts.join(' | '));
            f.press();
            assert.deepStrictEqual(ran, [[['hudSize', 110]]]);
            // armed, then 5 s pass: asks again
            f = frame(); f.press(); skew += 5001;
            f = frame();
            assert.ok(f.texts.indexOf('RESET HUD TO DEFAULTS') >= 0, 'ran out');
            f.press();
            assert.strictEqual(ran.length, 1, 'a press after the run-out only arms again');
            // armed, then the clock set back an hour: asks again (never a stuck "Confirm")
            skew -= 3600 * 1000;
            f = frame();
            assert.ok(f.texts.indexOf('RESET HUD TO DEFAULTS') >= 0, 'clock set back');
            f.press(); f = frame(); f.press();
            assert.strictEqual(ran.length, 2, 'armed and confirmed after the jump');
        } finally { Date.now = realNow; global.setTimeout = realSet; }
    }],

    // ---- 2. Night dim Auto ----
    ['dayNightOf: TAG / 1 day, NACHT / 2 night, however the binding hands it over; no change, invalid and junk say nothing', () => {
        const d = (v) => L.dayNightOf(v);
        assert.deepStrictEqual(['TAG', 1, '1', ' TAG ', 'NACHT', 2, '2'].map((x) => d({ dayNightChangeOver: x })), ['day', 'day', 'day', 'day', 'night', 'night', 'night']);
        assert.deepStrictEqual([d({ statusDayNightChangeOver: { dayNightChangeOver: 'NACHT' } }), d({ a: { b: { dayNightChangeOver: 1 } } })], ['night', 'day'], 'wrapped');
        ['KEINE_AENDERUNG', 0, 'SIGNAL_UNGUELTIG', 3, 'tag', 'NIGHT', 4, -1, 2.5, null, undefined, {}, [], 'x', true].forEach((x) => assert.strictEqual(d({ dayNightChangeOver: x }), null, JSON.stringify(x)));
        [null, undefined, 7, {}, []].forEach((v) => assert.strictEqual(d(v), null, JSON.stringify(v)));
        assert.deepStrictEqual([d('NACHT'), d(1)], ['night', 'day'], 'a bare enum (no struct) is read too');
        let deep = { dayNightChangeOver: 2 };
        for (let i = 0; i < 20; i++) deep = { x: deep };
        assert.strictEqual(d(deep), null, 'nesting past 4 levels is not searched');
        const loop = {}; loop.self = loop;
        assert.strictEqual(d(loop), null, 'a cycle never hangs');
        assert.strictEqual(L.dayNightRaw({ dayNightChangeOver: 'TAG' }), 'TAG');
    }],
    ['nightStep: the first word at once; a change only after it held 5 s; no word keeps it; a clock set back counts as held', () => {
        const H = cfg.nightHoldMs;
        assert.strictEqual(H, 5000);
        let s = L.nightStep(null, null, 0, H);
        assert.deepStrictEqual(s, { night: null, want: null, since: null }, 'nothing yet');
        s = L.nightStep(s, 'night', 1000, H);
        assert.strictEqual(s.night, true, 'the first word applies at once');
        s = L.nightStep(s, 'day', 2000, H);
        assert.strictEqual(s.night, true, 'held');
        assert.strictEqual(L.nightStep(s, null, 6999, H).night, true, '4999 ms');
        assert.strictEqual(L.nightStep(s, null, 7000, H).night, false, '5000 ms');
        // flicker: night, day, night inside the hold: never changes
        let f = L.nightStep(null, 'day', 0, H);
        [['night', 1000], ['day', 1500], ['night', 2000], ['day', 2500]].forEach((x) => { f = L.nightStep(f, x[0], x[1], H); assert.strictEqual(f.night, false, x.join(' ')); });
        assert.strictEqual(L.nightStep(f, null, 2500 + H - 1, H).night, false);
        // the same word again does not restart the hold; no word keeps the state
        let g = L.nightStep(L.nightStep(null, 'day', 0, H), 'night', 100, H);
        g = L.nightStep(g, 'night', 4000, H);
        assert.strictEqual(L.nightStep(g, null, 5100, H).night, true, 'held since 100, not 4000');
        assert.strictEqual(L.nightStep(L.nightStep(null, 'night', 0, H), null, 99999, H).night, true);
        // a wall clock set back an hour while a change waits: applies at once (never a stuck hold)
        const w = L.nightStep(L.nightStep(null, 'day', 1e6, H), 'night', 1e6 + 10, H);
        assert.strictEqual(L.nightStep(w, null, 1e6 - 3600e3, H).night, true);
    }],
    ['readStyle: Auto dims only while the car says night; On always, Off never; a bad saved mode reads Auto with a warning', () => {
        const at = (mode, carNight) => L.readStyle(cfg, (k) => (k === 'hudNightMode' ? mode : undefined), 'hud', carNight);
        assert.deepStrictEqual([true, false, null, undefined].map((n) => at('auto', n).night), [true, false, false, false]);
        assert.deepStrictEqual([true, false, null].map((n) => at('on', n).night), [true, true, true]);
        assert.deepStrictEqual([true, false, null].map((n) => at('off', n).night), [false, false, false]);
        ['yes', true, 1, null, 'AUTO'].forEach((x) => {
            const r = at(x, true);
            assert.deepStrictEqual([r.nightMode, r.night], ['auto', true], JSON.stringify(x));
            assert.ok(r.warnings.some((m) => m.indexOf('hudNightMode: ') === 0));
        });
        assert.strictEqual(L.levelOf(cfg, at('auto', true)), cfg.nightDim);
        assert.strictEqual(L.levelOf(cfg, at('auto', false)), 1);
    }],
    ['the Night dim row: pills Auto / On / Off; the line says what it uses and the car\'s last value, or that none came / the car has none', () => {
        const row = (saved, night, which) => P.view(which === 'cluster' ? 2 : 1, model(Object.assign({ hudOn: true, clusterOn: true, bothMode: 'cluster' }, saved), { night })).rows.filter((r) => /NightMode$/.test(r.id))[0];
        const r0 = row({}, undefined);
        assert.deepStrictEqual([r0.kind, r0.controls.map((c) => c.text), r0.value], ['pills', ['Auto', 'On', 'Off'], 'Auto']);
        assert.strictEqual(r0.desc, 'Auto, no day / night signal from the car yet: full brightness');
        assert.strictEqual(row({}, { night: true, raw: 'NACHT', sub: 'present' }).desc, 'Auto, car says night (NACHT): dimmed to 35%');
        assert.strictEqual(row({}, { night: false, raw: 1, sub: 'present' }).desc, 'Auto, car says day (1): full brightness');
        assert.strictEqual(row({}, { night: null, raw: 'SIGNAL_UNGUELTIG', sub: 'present' }).desc, 'Auto, car says no day / night word (SIGNAL_UNGUELTIG): full brightness');
        assert.strictEqual(row({}, { night: null, raw: undefined, sub: 'missing' }).desc, 'Auto, this car sends no day / night signal: full brightness');
        assert.strictEqual(row({ hudNightMode: 'on' }, { night: false, raw: 'TAG' }).desc, 'On: dimmed to 35% (car says day (TAG))');
        assert.strictEqual(row({ hudNightMode: 'off' }, { night: true, raw: 'NACHT' }).desc, 'Off: full brightness (car says night (NACHT))');
        assert.strictEqual(row({ clusterNightMode: 'auto' }, { night: true, raw: 2 }, 'cluster').desc, 'Auto, car says night (2): dimmed to 35%');
        assert.deepStrictEqual(row({ hudNightMode: 'on' }, undefined).controls.map((c) => [c.key, c.on, c.writes]),
            [['hud:hudNightMode:auto', false, [['hudNightMode', 'auto']]], ['hud:hudNightMode:on', true, []], ['hud:hudNightMode:off', false, [['hudNightMode', 'off']]]]);
    }],

    // ---- 3. Flash mode App ----
    ['Flash mode App: u_on 1 first, then 0 / 1 every 125 ms on every flashing layer in step; no animation; the ticker stops when the flash ends', () => {
        const r = rig();
        r.out.apply(A(false));
        const cr = r.cr(), layers = cr.n;
        assert.strictEqual(layers, 3, 'HUD Large: slats, bracket image, fill');
        assert.deepStrictEqual(r.timers.live, [], 'no ticker before a flash');
        const n0 = cr.sent.length;
        r.out.apply(A(true));
        assert.deepStrictEqual(r.timers.live.map((t) => t.ms), [125]);
        const start = cr.sent.slice(n0);
        // each effect layer: no u_on 0 before its flash u_st (it is 1 from its making), and no animation
        const flashSt = start.filter((m) => m[2] === 'u_st' && m[3].split(' ')[1] === '1');
        assert.strictEqual(flashSt.length, 2, 'slats + fill');
        assert.ok(!start.some((m) => m[0] === 'animate'));
        r.timers.tick();
        assert.deepStrictEqual(ons(cr, n0).map((m) => m[3]), ['0', '0'], 'both layers to their off half together');
        r.timers.tick(); r.timers.tick();
        assert.deepStrictEqual(ons(cr, n0).map((m) => m[3]), ['0', '0', '1', '1', '0', '0']);
        assert.strictEqual(r.out.status().flash.ticking, true);
        const n1 = cr.sent.length;
        r.out.apply(A(false));
        assert.deepStrictEqual(r.timers.live, [], 'stopped at once');
        assert.strictEqual(r.out.status().flash.ticking, false);
        r.timers.tick();
        assert.deepStrictEqual(ons(cr, n1), [], 'nothing more');
        // the next flash: u_on 1 goes before its u_st (the last one ended in the off half)
        const n2 = cr.sent.length;
        r.out.apply(A(true));
        const again = cr.sent.slice(n2).filter((m) => m[0] === 'uniform');
        const firstSt = again.findIndex((m) => m[2] === 'u_st'), firstOn = again.findIndex((m) => m[2] === 'u_on');
        assert.ok(firstOn >= 0 && firstOn < firstSt && again[firstOn][3] === '1', JSON.stringify(again));
        const n3 = cr.sent.length;
        r.timers.tick();
        assert.deepStrictEqual(ons(cr, n3).map((m) => m[3]), ['0', '0'], 'a full lit half first, then off (the phase starts over)');
        r.out.apply({ display: 'off', active: false });
        assert.deepStrictEqual(r.timers.live, [], 'dropping the layers stops it too');
    }],
    ['Flash mode App: never faster than every 125 ms, even with flashHz 20; a backed-up socket skips a toggle (counted) instead of queueing', () => {
        const c20 = L.validateConfig(Object.assign({}, config, { flashHz: 20 }));
        assert.deepStrictEqual(c20.errors, []);
        const r = rig(c20.cfg);
        r.out.apply(A(true));
        assert.deepStrictEqual(r.timers.live.map((t) => t.ms), [125]);
        const cr = r.cr(), n0 = cr.sent.length;
        cr.blocked = true;
        r.timers.tick(); r.timers.tick();
        assert.deepStrictEqual([ons(cr, n0).length, r.out.status().flash.skipped], [0, 2]);
        cr.blocked = false;
        r.timers.tick();
        assert.deepStrictEqual(ons(cr, n0).map((m) => m[3]), ['0', '0'], 'back: the next toggle');
        // the Renderer keeps the config's own rate (its animation), App mode only is capped
        const R = rig(c20.cfg);
        R.out.apply(A(true, { flashMode: 'renderer' }));
        assert.deepStrictEqual(R.cr().sent.filter((m) => m[0] === 'animate').map((m) => m[2]), ['0:1 25:0 50:1', '0:1 25:0 50:1']);
        assert.deepStrictEqual(R.timers.live, [], 'Renderer: no ticker');
    }],
    ['Flash mode setting: App by default, Renderer only when saved; a missing or bad saved value reads App; the About row says which', () => {
        assert.deepStrictEqual([item('flashMode').default, L.FLASH_MODES], ['app', ['app', 'renderer']]);
        assert.strictEqual(L.readFlashMode((k) => (k === 'flashMode' ? 'renderer' : undefined)), 'renderer');
        [undefined, null, 'RENDERER', 'auto', 1, true, {}].forEach((x) => assert.strictEqual(L.readFlashMode(() => x), 'app', JSON.stringify(x)));
        assert.strictEqual(L.readFlashMode(() => { throw new Error('settings broke'); }), 'app');
        const row = (saved) => P.view(4, model(saved)).rows.filter((r) => r.id === 'flashMode')[0];
        assert.deepStrictEqual([row({}).label, row({}).value, row({}).desc], ['Shift flash', 'App', 'App: this app turns it on and off, 8 times a second']);
        assert.deepStrictEqual([row({ flashMode: 'renderer' }).value, row({ flashMode: 'renderer' }).desc], ['Renderer', 'Renderer: the cluster plays it (a G01 showed solid red)']);
        assert.strictEqual(row({ flashMode: 'junk' }).value, 'App');
    }],
    ['Flash mode: a change makes new layers (fresh u_on 1, no leftover animation or ticker); a throw in the ticker is caught by the guard', () => {
        const r = rig();
        r.out.apply(A(true, { flashMode: 'renderer' }));
        const cr = r.cr(), n0 = cr.sent.length;
        r.out.apply(A(true, { flashMode: 'app' }));
        const sw = cr.sent.slice(n0);
        assert.ok(sw.filter((m) => m[0] === 'drop').length === 3 && !sw.some((m) => m[0] === 'animate'), JSON.stringify(sw.map((m) => m[0])));
        assert.deepStrictEqual(r.timers.live.map((t) => t.ms), [125]);
        const n1 = cr.sent.length;
        r.out.apply(A(true, { flashMode: 'renderer' }));
        assert.deepStrictEqual(r.timers.live, [], 'back to Renderer: the ticker is gone');
        assert.strictEqual(cr.sent.slice(n1).filter((m) => m[0] === 'animate').length, 2);
        // a client that throws on u_on: the guard catches it (logged, counted), nothing escapes the timer
        const g = rig();
        g.out.apply(A(true));
        const gc = g.cr(), u = gc.uniform.bind(gc);
        gc.uniform = (ref, name, v) => { if (name === 'u_on') throw new Error('socket broke'); return u(ref, name, v); };
        assert.doesNotThrow(() => g.timers.tick());
        assert.ok(g.lines.some((l) => /^ERR .*flash.*socket broke/.test(l)), g.lines.join('\n'));
        assert.strictEqual(g.safety.tripped(), false, 'one error does not trip it');
    }],
];
