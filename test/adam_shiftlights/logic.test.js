'use strict';
const assert = require('assert');
const L = require('../../apps/adam_shiftlights/logic');
const config = require('../../apps/adam_shiftlights/config');
const cfg = L.validateConfig(config).cfg;

const N = 6;
const none = () => 0;
const mt = (mode) => L.modeThresholds(cfg, none, mode);
const th = (mode, oil) => L.thresholds(cfg, mt(mode), oil);
const raw = (rpm, t) => L.rawState(rpm, t, N, cfg.engine.limiterBand);
/** Drive step() through rpms from a fresh state; returns every state. */
function run(rpms, t, n) {
    let s = null;
    return rpms.map((r, i) => (s = L.step(s, r, t, n || N, cfg, i * 50)));
}

module.exports = [
    ['config.js validates without errors and equals DEFAULTS', () => {
        const r = L.validateConfig(config);
        assert.deepStrictEqual(r.errors, []);
        assert.deepStrictEqual(r.cfg, L.DEFAULTS);
    }],
    ['Sport+ warm: rpm to lit fields, red, flashing', () => {
        const t = th('sportplus', 95);
        assert.deepStrictEqual([t.limit, t.shift, t.start, t.capped, t.oilKnown], [7000, 6800, 6000, false, true]);
        const lit = (r) => raw(r, t).lit;
        assert.deepStrictEqual([800, 5900, 6000].map(lit), [0, 0, 0]);
        assert.deepStrictEqual([6001, 6160, 6161, 6400, 6799].map(lit), [1, 1, 2, 3, 5]);
        assert.deepStrictEqual(raw(6800, t), { lit: 6, red: true, flashing: false });
        assert.deepStrictEqual(raw(6899, t), { lit: 6, red: true, flashing: false });
        assert.strictEqual(raw(6900, t).flashing, true);
        assert.strictEqual(raw(7000, t).flashing, true);
    }],
    ['Comfort vs Sport+ at 4600', () => {
        assert.strictEqual(raw(4600, th('comfort', 95)).lit, 3);
        assert.strictEqual(raw(4600, th('sportplus', 95)).lit, 0);
    }],
    ['cold oil 40: limit 5000, shift 4850, start 4050', () => {
        const t = th('sportplus', 40);
        assert.deepStrictEqual([t.limit, t.shift, t.start, t.capped], [5000, 4850, 4050, true]);
        assert.deepStrictEqual([4050, 4100, 4600, 4849].map((r) => raw(r, t).lit), [0, 1, 4, 5]);
        assert.deepStrictEqual(raw(4850, t), { lit: 6, red: true, flashing: false });
        assert.strictEqual(raw(4900, t).flashing, true);
    }],
    ['cold limits at oil 55, 30, 10, unknown; comfort at 40', () => {
        const v = (mode, oil) => { const t = th(mode, oil); return [t.limit, t.shift, t.start]; };
        assert.deepStrictEqual(v('sportplus', 55), [5750, 5600, 4800]);
        assert.deepStrictEqual(v('sportplus', 30), [4500, 4350, 3550]);
        assert.deepStrictEqual(v('sportplus', 10), [4500, 4350, 3550]);
        assert.deepStrictEqual(v('sportplus', undefined), [7000, 6800, 6000]);
        assert.strictEqual(th('sportplus', undefined).oilKnown, false);
        assert.strictEqual(th('sportplus', NaN).oilKnown, false);
        assert.deepStrictEqual(v('comfort', 40), [5000, 4850, 3850]);
    }],
    ['hysteresis: lit falls only 50 rpm under where it rose', () => {
        const t = th('sportplus', 95);
        let s = run([6161], t)[0];
        assert.strictEqual(s.lit, 2);
        const at = (r) => L.step(s, r, t, N, cfg, 0).lit;
        assert.strictEqual(at(6150), 2);
        assert.strictEqual(at(6111), 2);
        assert.strictEqual(at(6110), 1);
    }],
    ['hysteresis: 6155/6165 alternating forty times changes lit once', () => {
        const t = th('sportplus', 95), rpms = [];
        for (let i = 0; i < 40; i++) rpms.push(i % 2 ? 6165 : 6155);
        const lits = run(rpms, t).map((s) => s.lit);
        let changes = 0;
        for (let i = 1; i < lits.length; i++) if (lits[i] !== lits[i - 1]) changes++;
        assert.strictEqual(changes, 1);
        assert.deepStrictEqual([lits[0], lits[39]], [1, 2]);
    }],
    ['hysteresis: red holds at 6751, clears at 6749; flash holds at 6851, clears at 6849', () => {
        const t = th('sportplus', 95);
        const red = run([6800, 6751, 6749], t);
        assert.deepStrictEqual(red.map((s) => s.red), [true, true, false]);
        assert.deepStrictEqual(red.map((s) => s.lit), [6, 6, 5]);
        const fl = run([6900, 6851, 6849], t);
        assert.deepStrictEqual(fl.map((s) => s.flashing), [true, true, false]);
        assert.strictEqual(fl[2].red, true);
    }],
    ['flash timing at 4 Hz and 8 Hz', () => {
        const t0 = 1000;
        const on = (dt, hz) => L.flashOn(t0 + dt, t0, hz);
        assert.deepStrictEqual([0, 124, 250, 374].map((x) => on(x, 4)), [true, true, true, true]);
        assert.deepStrictEqual([125, 249].map((x) => on(x, 4)), [false, false]);
        assert.deepStrictEqual([0, 62, 63, 124, 125].map((x) => on(x, 8)), [true, true, false, false, true]);
    }],
    ['flashT0 set at entry, kept while flashing, reset on re-entry', () => {
        const t = th('sportplus', 95);
        let s = L.step(null, 6900, t, N, cfg, 100);
        assert.strictEqual(s.flashT0, 100);
        s = L.step(s, 7000, t, N, cfg, 400);
        assert.strictEqual(s.flashT0, 100);
        s = L.step(s, 6000, t, N, cfg, 600);
        assert.strictEqual(s.flashT0, null);
        s = L.step(s, 6950, t, N, cfg, 900);
        assert.strictEqual(s.flashT0, 900);
    }],
    ['fieldColor: inward y y y o o r from the outer end; the flash shows the last palette colour / all dark', () => {
        const C = cfg.colors, P = cfg.clusterStyles.row.palette;
        const full = { lit: 6, red: true, flashing: false };
        assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map((i) => L.fieldColor(full, P, i, C, true)), [C.y, C.y, C.y, C.o, C.o, C.r]);
        const three = { lit: 3, red: false, flashing: false };
        assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map((i) => L.fieldColor(three, P, i, C, true)), [C.y, C.y, C.y, null, null, null]);
        const fl = { lit: 6, red: true, flashing: true };
        assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map((i) => L.fieldColor(fl, P, i, C, true)), [C.r, C.r, C.r, C.r, C.r, C.r]);
        assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map((i) => L.fieldColor(fl, P, i, C, false)), [null, null, null, null, null, null]);
        assert.strictEqual(L.fieldColor(fl, cfg.clusterStyles.large.palette, 0, C, true), C.c);
    }],
    ['invalid rpm gives all off', () => {
        const t = th('sportplus', 95), zero = { lit: 0, red: false, flashing: false };
        [NaN, undefined, null, -1, Infinity, '7000'].forEach((r) => {
            assert.deepStrictEqual(raw(r, t), zero, String(r));
            assert.deepStrictEqual(L.step({ lit: 6, red: true, flashing: true, flashT0: 5 }, r, t, N, cfg, 0), Object.assign({ flashT0: null }, zero), String(r));
        });
    }],
    ['HUD bar (7 a side + the red centre): 7 before the shift point, 8 at it', () => {
        const t = th('sportplus', 95), lt = L.lightsOf(cfg, 'hud', 'large');
        assert.deepStrictEqual([lt.palette, lt.count, lt.reds], ['YYYYYOOR', 8, 1]);
        assert.deepStrictEqual([6000, 6001, 6400, 6799, 6800].map((r) => L.rawState(r, t, lt.count, 100, lt.reds).lit), [0, 1, 4, 7, 8]);
        assert.deepStrictEqual(run([6799], t, 8).map((s) => s.lit), [7]);
        assert.deepStrictEqual(L.lightsOf(cfg, 'hud', 'bar'), lt);
    }],
    ['cluster large (8 amber + 2 red a side): at most 8 below the shift point, 10 at 6800', () => {
        const t = th('sportplus', 95), lt = L.lightsOf(cfg, 'cluster', 'large');
        assert.deepStrictEqual([lt.count, lt.reds], [10, 2]);
        const lit = (r) => L.rawState(r, t, lt.count, 100, lt.reds).lit;
        assert.deepStrictEqual([6000, 6001, 6100, 6101, 6400, 6799, 6800, 6900].map(lit), [0, 1, 1, 2, 4, 8, 10, 10]);
        for (let r = 5000; r < 6800; r += 7) assert.ok(lit(r) <= 8, String(r));
        assert.strictEqual(L.lightsOf(cfg, 'cluster', 'classic').count, 10);
    }],
    ['stock blocks: stages 1 / 2 / 3 across start, half way, shift', () => {
        const t = th('sportplus', 95), lt = L.lightsOf(cfg, 'cluster', 'stock');
        assert.deepStrictEqual([lt.palette, lt.count, lt.reds], ['yoC', 3, 1]);
        const lit = (r) => L.rawState(r, t, lt.count, 100, lt.reds).lit;
        assert.deepStrictEqual([5999, 6001, 6400, 6401, 6799, 6800].map(lit), [0, 1, 1, 2, 2, 3]);
    }],
    ['classic HUD cells: 8 at the shift point; bracket and off have no lights', () => {
        const t = th('sportplus', 95), lt = L.lightsOf(cfg, 'hud', 'classic');
        assert.deepStrictEqual([lt.palette, lt.count], ['yyyyyoor', 8]);
        assert.deepStrictEqual([6799, 6800].map((r) => L.rawState(r, t, 8, 100, 1).lit), [7, 8]);
        assert.strictEqual(L.lightsOf(cfg, 'hud', 'bracket'), null);
        assert.strictEqual(L.lightsOf(cfg, 'hud', 'off'), null);       // an old saved 'off' draws nothing, never throws
        assert.strictEqual(L.lightsOf(cfg, 'cluster', 'off'), null);
        assert.strictEqual(L.lightsOf(cfg, 'cluster', 'row').count, 6);
    }],
    ['hysteresis with reds = 2: 6195/6205 alternating changes lit once; the reds hold to 6751', () => {
        const t = th('sportplus', 95), rpms = [];
        for (let i = 0; i < 40; i++) rpms.push(i % 2 ? 6205 : 6195);
        let s = null;
        const lits = rpms.map((r, i) => (s = L.step(s, r, t, 10, cfg, i * 50, 2)).lit);
        let changes = 0;
        for (let i = 1; i < lits.length; i++) if (lits[i] !== lits[i - 1]) changes++;
        assert.strictEqual(changes, 1);
        assert.deepStrictEqual([lits[0], lits[39]], [2, 3]);
        let r = null;
        const red = [6800, 6751, 6749].map((x, i) => (r = L.step(r, x, t, 10, cfg, i, 2)));
        assert.deepStrictEqual(red.map((x) => x.lit), [10, 10, 8]);
    }],
    ['readStyle: all 16 cluster x HUD pairs resolve each display to its own value', () => {
        L.CLUSTER_STYLES.forEach((c) => L.HUD_STYLES.forEach((h) => {
            const v = { clusterStyle: c, hudStyle: h, clusterSize: 110, hudSize: 80, clusterBright: 60, hudBright: 40, clusterNight: true, hudNight: false, hudX: -30, hudY: 20, clusterX: 15, clusterY: -10 };
            const get = (k) => v[k];
            const a = L.readStyle(cfg, get, 'cluster'), b = L.readStyle(cfg, get, 'hud');
            assert.deepStrictEqual([a.style, a.size, a.bright, a.night, a.warnings, a.x, a.y], [c, 110, 60, true, [], 15, -10], c + '/' + h);
            assert.deepStrictEqual([b.style, b.size, b.bright, b.night, b.warnings, b.x, b.y], [h, 80, 40, false, [], -30, 20], c + '/' + h);
            // changing one display's setting never changes the other's
            L.CLUSTER_STYLES.forEach((c2) => assert.strictEqual(L.readStyle(cfg, (k) => (k === 'clusterStyle' ? c2 : v[k]), 'hud').style, h));
            L.HUD_STYLES.forEach((h2) => assert.strictEqual(L.readStyle(cfg, (k) => (k === 'hudStyle' ? h2 : v[k]), 'cluster').style, c));
        }));
    }],
    ['readStyle: bad saved values fall back to the defaults with a warning, never a throw', () => {
        const bad = [undefined, null, 'banana', 7, '', {}, [], 'LARGE', true];
        bad.forEach((x) => {
            const v = { clusterStyle: x, hudStyle: x, clusterSize: 999, hudSize: x, clusterBright: -5, hudBright: x, clusterNight: 'yes', hudNight: x === true ? 1 : x };
            ['cluster', 'hud'].forEach((w) => {
                const r = L.readStyle(cfg, (k) => (/^(hud|cluster)[XY]$/.test(k) ? x : v[k]), w);
                assert.deepStrictEqual([r.style, r.size, r.bright, r.night, r.x, r.y], ['large', 100, 100, false, 0, 0], w + ' ' + JSON.stringify(x));
                assert.ok(r.warnings.length >= 3, JSON.stringify(r.warnings));
                assert.ok(r.warnings.some((m) => m.indexOf(w + 'Style: ') === 0), JSON.stringify(r.warnings));
            });
        });
        const boom = () => { throw new Error('settings broke'); };
        assert.strictEqual(L.readStyle(cfg, boom, 'hud').style, 'large');
        assert.strictEqual(L.readStyle(cfg, () => 'row', 'hud').style, 'large');        // a cluster-only id on the HUD
        assert.strictEqual(L.readStyle(cfg, () => 'bar', 'cluster').style, 'large');    // and the other way round
        assert.strictEqual(L.readStyle(cfg, (k) => (k === 'hudStyle' ? 'off' : undefined), 'hud').style, 'large');   // an old 'off'
        assert.strictEqual(L.readStyle(cfg, (k) => (k === 'hudX' ? 15 : undefined), 'hud').x, 0);   // not a step
        assert.deepStrictEqual(['clusterX', 'clusterY'].map((key) => L.readStyle(cfg, (k) => (k === key ? 7 : undefined), 'cluster')[key.slice(-1).toLowerCase()]), [0, 0]);
        assert.ok(L.readStyle(cfg, (k) => (k === 'clusterY' ? 300 : undefined), 'cluster').warnings.some((m) => /^clusterY: 300 is not one of/.test(m)));
    }],
    ['readDisplays: HUD and cluster toggle independently; both on follows "When both are on"', () => {
        const rd = (v) => L.readDisplays((k) => v[k]);
        const want = { 'false false': 'off', 'true false': 'hud', 'false true': 'cluster' };
        [false, true].forEach((hud) => [false, true].forEach((cl) => L.BOTH_MODES.concat([undefined, 'junk']).forEach((both) => {
            const r = rd({ hudOn: hud, clusterOn: cl, bothMode: both });
            const d = hud && cl ? { map: 'both', hud: 'hud', cluster: 'cluster' }[L.BOTH_MODES.indexOf(both) >= 0 ? both : 'hud'] : want[hud + ' ' + cl];
            assert.deepStrictEqual([r.hud, r.cluster, r.display], [hud, cl, d], [hud, cl, both].join('/'));
            // flipping one never changes the other
            assert.strictEqual(rd({ hudOn: !hud, clusterOn: cl, bothMode: both }).cluster, cl);
            assert.strictEqual(rd({ hudOn: hud, clusterOn: !cl, bothMode: both }).hud, hud);
        })));
        [1, 'true', 'on', null, {}].forEach((x) => assert.deepStrictEqual(rd({ hudOn: x, clusterOn: x }).display, 'off', JSON.stringify(x)));
        assert.strictEqual(L.readDisplays(() => { throw new Error('x'); }).display, 'off');
    }],
    ['migrateSettings: 0.2.x settings move to the two on/off settings; garbage never throws; runs once', () => {
        const mig = (v) => { const w = L.migrateSettings((k) => v[k]), o = {}; w.forEach((x) => { o[x[0]] = x[1]; }); return o; };
        assert.deepStrictEqual(mig({ enabled: true, display: 'both', clusterStyle: 'row', hudStyle: 'large' }), { clusterOn: true, hudOn: true, _settingsV: 3 });
        assert.deepStrictEqual(mig({ enabled: false, display: 'hud' }), { clusterOn: false, hudOn: false, _settingsV: 3 });
        assert.deepStrictEqual(mig({ display: 'hud', hudStyle: 'off', clusterStyle: 'large' }), { clusterOn: false, hudOn: false, hudStyle: 'large', _settingsV: 3 });
        assert.deepStrictEqual(mig({ enabled: true, display: 'both', hudStyle: 'off', clusterStyle: 'row' }), { clusterOn: true, hudOn: false, hudStyle: 'large', _settingsV: 3 });
        assert.deepStrictEqual(mig({ enabled: true, display: 'cluster', clusterStyle: 'stock', hudStyle: 'bar' }), { clusterOn: true, hudOn: false, _settingsV: 3 });
        assert.deepStrictEqual(mig({}), { clusterOn: false, hudOn: false, _settingsV: 3 });       // a fresh install: both off
        // an unknown style showed large in 0.2.x: it stays on
        assert.deepStrictEqual(mig({ display: 'both', clusterStyle: 'banana', hudStyle: 5 }), { clusterOn: true, hudOn: true, _settingsV: 3 });
        [{ display: 7 }, { display: null, enabled: 'x' }, { display: {}, clusterStyle: [], hudStyle: 5 }, { display: 'DASH' }].forEach((v) => {
            const o = mig(v);
            assert.deepStrictEqual([o.hudOn, o._settingsV], [false, 3], JSON.stringify(v));
            assert.strictEqual(o.clusterOn, false, JSON.stringify(v));
        });
        assert.deepStrictEqual(L.migrateSettings(() => { throw new Error('settings broke'); }).map((w) => w[0]), ['clusterOn', 'hudOn', '_settingsV']);
        assert.deepStrictEqual(L.migrateSettings((k) => ({ _settingsV: 3, display: 'both' })[k]), []);
    }],
    ['driveModeOf: the FES drive experience numbers and names; junk gives null', () => {
        const want = { 1: 'sport', 2: 'sportplus', 3: 'sport', 4: 'comfort', 5: 'comfort', 6: 'comfort', 7: 'comfort', 8: 'comfort', 9: 'comfort', 10: 'comfort' };
        Object.keys(want).forEach((n) => { assert.strictEqual(L.driveModeOf(Number(n)), want[n], n); assert.strictEqual(L.driveModeOf(n), want[n], '"' + n + '"'); });
        [0, 61, 62, 63, 11, -1, 2.5, NaN, null, undefined, '', 'X', {}, [], true].forEach((x) => assert.strictEqual(L.driveModeOf(x), null, JSON.stringify(x)));
        assert.deepStrictEqual(['SPORT_EXPERT', 'SPORT_DYNAMIC', 'SPORT_INDIVIDUAL', 'COMFORT', 'COMFORT_PLUS', 'ECO_PRO_EFFICIENT', 'ADAPTIVE', 'sport_expert'].map(L.driveModeOf),
            ['sportplus', 'sport', 'sport', 'comfort', 'comfort', 'comfort', 'comfort', 'sportplus']);
    }],
    ['effectiveMode and Only in Sport+: the car wins, the setting is the fallback; the gate holds outside Sport+', () => {
        const get = (v) => (k) => v[k];
        assert.deepStrictEqual(L.effectiveMode('sportplus', get({ driveMode: 'comfort' }), cfg), { mode: 'sportplus', source: 'car' });
        assert.deepStrictEqual(L.effectiveMode(null, get({ driveMode: 'comfort' }), cfg), { mode: 'comfort', source: 'setting' });
        assert.deepStrictEqual(L.effectiveMode(null, get({ driveMode: 'eco' }), cfg), { mode: 'sport', source: 'setting' });
        assert.deepStrictEqual(L.effectiveMode('junk', () => { throw new Error('x'); }, cfg), { mode: 'sport', source: 'setting' });
        assert.strictEqual(L.holdForSportPlus(true, { mode: 'sportplus' }), false);
        assert.strictEqual(L.holdForSportPlus(true, { mode: 'sport' }), true);
        assert.strictEqual(L.holdForSportPlus(true, { mode: 'comfort' }), true);
        assert.strictEqual(L.holdForSportPlus(true, null), true);
        [false, undefined, 'yes', 1].forEach((x) => assert.strictEqual(L.holdForSportPlus(x, { mode: 'comfort' }), false, String(x)));
        // the thresholds follow the car's mode
        assert.strictEqual(L.modeThresholds(cfg, () => 0, L.effectiveMode(L.driveModeOf(4), get({ driveMode: 'sportplus' }), cfg).mode).shift, 5000);
    }],
    ['levelOf: brightness setting x night dim x config brightness', () => {
        assert.strictEqual(L.levelOf(cfg, { bright: 100, night: false }), 1);
        assert.strictEqual(L.levelOf(cfg, { bright: 40, night: false }), 0.4);
        assert.strictEqual(L.levelOf(cfg, { bright: 100, night: true }), 0.35);
        assert.strictEqual(L.levelOf(cfg, { bright: 60, night: true }), 0.21);
    }],
    ['lead: leadMs 0 adds nothing; flat, falling and noisy-flat rpm get no lead', () => {
        const ramp = (f, rpmAt, n, hz, ms) => { const out = []; for (let i = 0; i < n; i++) out.push(f(rpmAt(i * 1000 / hz), i * 1000 / hz, ms)); return out; };
        ramp(L.makeLead(cfg.rpm), (t) => 5000 + 3 * t, 40, 20, 0).forEach((r) => assert.strictEqual(r.add, 0));
        let seed = 7;
        const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
        [(t) => 6200, (t) => 6800 - 2 * t, (t) => 6200 + Math.round((rnd() * 2 - 1) * 25)].forEach((g, i) => {
            [10, 20, 50].forEach((hz) => ramp(L.makeLead(cfg.rpm), g, 60, hz, 150).forEach((r) => assert.strictEqual(r.add, 0, 'case ' + i + ' at ' + hz + ' Hz')));
        });
    }],
    ['lead: a 3 rpm/ms rise at 20 Hz leads 180 rpm at 60 ms once the window is full; the slope stops at maxSlope', () => {
        const f = L.makeLead(cfg.rpm);
        let r;
        for (let t = 0; t <= 400; t += 50) r = f(5000 + 3 * t, t, 60);
        assert.ok(Math.abs(r.add - 180) <= 2, String(r.add));
        assert.strictEqual(r.rpm, 5000 + 3 * 400 + r.add);
        const g = L.makeLead(cfg.rpm);
        for (let t = 0; t <= 400; t += 50) r = g(1000 + 30 * t, t, 60);
        assert.strictEqual(r.add, cfg.rpm.maxSlope * 60);
        assert.strictEqual(g(13000, 450, 500).add, cfg.rpm.maxSlope * 150, 'leadMs clamps at 150');
    }],
    ['lead: the soft gate gives none at 1 rpm/ms, half the slope at 1.5, all of it from 2', () => {
        const at = (slope) => { const f = L.makeLead(cfg.rpm); let r; for (let t = 0; t <= 400; t += 20) r = f(5000 + slope * t, t, 100); return r.add / (slope * 100); };
        assert.ok(Math.abs(at(1.0)) < 0.01, String(at(1.0)));
        assert.ok(Math.abs(at(1.5) - 0.5) < 0.01, String(at(1.5)));
        assert.ok(Math.abs(at(2.0) - 1) < 0.01, String(at(2.0)));
    }],
    ['lead: a gap over 2 x the window, or an invalid rpm, starts again with no lead', () => {
        const f = L.makeLead(cfg.rpm);
        for (let t = 0; t <= 400; t += 50) f(5000 + 3 * t, t, 60);
        assert.strictEqual(f(6500, 400 + 2 * cfg.rpm.slopeWindowMs + 10, 60).add, 0, 'gap');
        [undefined, NaN, -1, '6000'].forEach((bad) => {
            const g = L.makeLead(cfg.rpm);
            for (let t = 0; t <= 400; t += 50) g(5000 + 3 * t, t, 60);
            const r = g(bad, 450, 60);
            assert.ok(Object.is(r.rpm, bad) && r.add === 0, String(bad));     // Object.is: Node 8's deepStrictEqual has NaN !== NaN
            assert.strictEqual(g(6400, 500, 60).add, 0, 'history cleared after ' + String(bad));
        });
        assert.strictEqual(L.makeLead(cfg.rpm)(6000, NaN, 60).add, 0);
    }],
    ['lead: an unchanged rpm (a speed tick) keeps the last lead inside the window, then decays to 0', () => {
        const f = L.makeLead(cfg.rpm);
        let r;
        for (let t = 0; t <= 400; t += 50) r = f(5000 + 3 * t, t, 60);
        assert.strictEqual(f(6200, 410, 60).add, r.add);
        assert.strictEqual(f(6200, 540, 60).add, r.add);
        assert.strictEqual(f(6200, 400 + cfg.rpm.slopeWindowMs + 1, 60).add, 0);
    }],
    ['step with a lead: on in the same call a boundary is crossed (no smoothing up), off only lead + 50 under it', () => {
        const t = th('sportplus', 95);
        [0, 100].forEach((add) => {
            let s = null;
            for (let r = 5900; r <= 7000; r++) {
                s = L.step(s, r, t, N, cfg, r, 1, add);
                assert.strictEqual(s.lit, raw(r, t).lit, 'rpm ' + r + ' lead ' + add);
            }
        });
        const s = L.step(null, 6161, t, N, cfg, 0, 1, 100);
        assert.strictEqual(s.lit, 2);
        assert.deepStrictEqual([6111, 6011, 6010].map((r) => L.step(s, r, t, N, cfg, 0, 1, 100).lit), [2, 2, 1]);
        assert.deepStrictEqual([6111, 6110].map((r) => L.step(s, r, t, N, cfg, 0, 1, 0).lit), [2, 1]);
        assert.deepStrictEqual([-5, NaN, 'x'].map((a) => L.step(s, 6110, t, N, cfg, 0, 1, a).lit), [1, 1, 1], 'a bad lead counts as 0');
    }],
    ['readLead: missing gives config (60, poll on); garbage falls back with a warning; only false turns the poll off', () => {
        const get = (v) => (k) => v[k];
        assert.deepStrictEqual(L.readLead(cfg, get({})), { leadMs: 60, poll: true, warnings: [] });
        ['x', 55, 151, null, -20].forEach((v) => {
            const r = L.readLead(cfg, get({ leadMs: v }));
            assert.strictEqual(r.leadMs, 60, String(v));
            assert.ok(r.warnings.length === 1 && /^leadMs: /.test(r.warnings[0]), JSON.stringify(r.warnings));
        });
        L.LEAD_STEPS.forEach((v) => assert.deepStrictEqual(L.readLead(cfg, get({ leadMs: v })).leadMs, v));
        assert.strictEqual(L.readLead(cfg, get({ rpmPoll: 'no' })).poll, true);
        assert.strictEqual(L.readLead(cfg, get({ rpmPoll: false })).poll, false);
        assert.strictEqual(L.readLead(cfg, () => { throw new Error('x'); }).leadMs, 60);
    }],
];
