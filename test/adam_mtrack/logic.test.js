'use strict';
/* logic.js: the when-to-show table for every drive mode x setting, every single condition that keeps the cover off,
 * the 1 s hold (blip, clock backwards, no change), the slats, the 0-60 timer, settings fallback and panel layout. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const L = require('../../apps/adam_mtrack/logic');
const cfg = require('../../apps/adam_mtrack/config');
const SPEC = JSON.parse(fs.readFileSync(path.join(__dirname, '../../apps/adam_mtrack/app.json'), 'utf8'));

const NOW = 1000000;
/** Every condition true: the cover may show (held since long ago). */
const OK = () => ({ coverOn: true, killed: false, tripped: false, demo: false, link: 'ready', ccKnown: true, ccActive: false, ccNewAt: null,
    target: 'shown', holder: '', speedAt: NOW - 100, lastErrorAt: null, mode: 'sportplus', when: 'sportplus' });
const want = (s, since) => L.decide(s, NOW, since === undefined ? NOW - 5000 : since, cfg);

const MODES = [['sportplus', [2, '2', 'SPORT_EXPERT']], ['sport', [1, 3, 'SPORT_DYNAMIC', 'SPORT']], ['comfort', [4, 7, 10, 'COMFORT', 'ECO_PRO']], [null, [0, 61, undefined, null, 'X', 3.5, 11]]];
const TABLE = { sportplus: { sportplus: true, sport: true, always: true }, sport: { sportplus: false, sport: true, always: true },
    comfort: { sportplus: false, sport: false, always: true }, null: { sportplus: false, sport: false, always: true } };

module.exports = [
    ['driveModeOf: Shift Lights\' decoding (2 / SPORT_EXPERT = Sport+, 1 / 3 / SPORT_* = Sport, 4-10 = Comfort, else none)', () => {
        MODES.forEach((m) => m[1].forEach((raw) => assert.strictEqual(L.driveModeOf(raw), m[0], JSON.stringify(raw))));
    }],
    ['the decision table: every drive mode (raw values) x every When to show', () => {
        MODES.forEach((m) => m[1].forEach((raw) => ['sportplus', 'sport', 'always'].forEach((when) => {
            const s = Object.assign(OK(), { mode: L.driveModeOf(raw), when }), r = want(s);
            assert.strictEqual(r.want, TABLE[String(m[0])][when], JSON.stringify(raw) + ' / ' + when);
            if (!r.want) assert.strictEqual(r.reason, 'mode');
        })));
    }],
    ['a garbage When to show is the strictest (Sport+ only)', () => {
        assert.strictEqual(want(Object.assign(OK(), { when: 'x', mode: 'sportplus' })).want, true);
        assert.strictEqual(want(Object.assign(OK(), { when: 'x', mode: 'sport' })).want, false);
        assert.strictEqual(want(Object.assign(OK(), { when: undefined, mode: 'sport' })).want, false);
    }],
    ['each condition alone keeps the cover off, with its reason', () => {
        assert.strictEqual(want(OK()).want, true);
        const cases = [
            [{ coverOn: false }, 'off'], [{ coverOn: 'true' }, 'off'], [{ killed: true }, 'kill'], [{ tripped: true }, 'tripped'], [{ demo: true }, 'demo'],
            [{ link: 'connecting' }, 'renderer'], [{ link: 'none' }, 'renderer'], [{ ccKnown: false }, 'nocc'], [{ ccActive: true }, 'cc'],
            [{ ccNewAt: NOW - 999 }, 'cc'], [{ target: 'waiting', holder: 'stock' }, 'held'], [{ target: 'parked', holder: 'stock' }, 'held'],
            [{ target: 'waiting', holder: 'foreign' }, 'hud'], [{ speedAt: NOW - 1001 }, 'nospeed'], [{ speedAt: null }, 'nospeed'],
            [{ speedAt: NOW + 50 }, 'nospeed'], [{ lastErrorAt: NOW - 999 }, 'error'], [{ mode: 'comfort' }, 'mode'],
        ];
        cases.forEach((c) => {
            const r = want(Object.assign(OK(), c[0]));
            assert.deepStrictEqual([r.want, r.reason, r.since], [false, c[1], null], JSON.stringify(c[0]));
        });
    }],
    ['the edges: speed 999 ms old shows, 1001 ms does not; a new Check Control message or an error 1000 ms ago no longer holds it off', () => {
        assert.strictEqual(want(Object.assign(OK(), { speedAt: NOW - 999 })).want, true);
        assert.strictEqual(want(Object.assign(OK(), { speedAt: NOW - 1000 })).want, true);
        assert.strictEqual(want(Object.assign(OK(), { speedAt: NOW - 1001 })).want, false);
        assert.strictEqual(want(Object.assign(OK(), { ccNewAt: NOW - 1000 })).want, true);
        assert.strictEqual(want(Object.assign(OK(), { lastErrorAt: NOW - 1000 })).want, true);
        assert.strictEqual(want(Object.assign(OK(), { target: 'lingering' })).want, true);
        assert.strictEqual(want(Object.assign(OK(), { target: null })).want, true);
    }],
    ['without requireCheckControl a missing Check Control list does not block (config switch)', () => {
        const c = Object.assign({}, cfg, { requireCheckControl: false });
        assert.strictEqual(L.decide(Object.assign(OK(), { ccKnown: false }), NOW, NOW - 5000, c).want, true);
    }],
    ['hold: true only after 1000 ms of every condition; a blip at 500 ms starts it again; the clock going back restarts it', () => {
        let since = null, t = NOW;
        const step = (s) => { const r = L.decide(s, t, since, cfg); since = r.since; return r; };
        assert.deepStrictEqual([step(OK()).want, since], [false, NOW]);
        t = NOW + 500; assert.strictEqual(step(Object.assign(OK(), { speedAt: t })).reason, 'hold');
        assert.strictEqual(step(Object.assign(OK(), { speedAt: t, ccActive: true })).want, false);        // the blip
        t = NOW + 900; assert.strictEqual(step(Object.assign(OK(), { speedAt: t })).want, false);
        assert.strictEqual(since, NOW + 900);
        t = NOW + 1899; assert.strictEqual(step(Object.assign(OK(), { speedAt: t })).want, false);
        t = NOW + 1900; assert.strictEqual(step(Object.assign(OK(), { speedAt: t })).want, true);
        t = NOW + 1950; assert.strictEqual(step(Object.assign(OK(), { speedAt: t })).want, true, 'nothing changed: stays shown');
        assert.strictEqual(since, NOW + 900, 'since unchanged while shown');
        t = NOW + 100; const back = step(Object.assign(OK(), { speedAt: t }));
        assert.deepStrictEqual([back.want, since], [false, NOW + 100], 'clock went back: the hold starts again');
    }],
    ['the slats: thresholds per mode and cold oil, hysteresis, all lit and flashing at the limiter', () => {
        const th = L.thresholds(cfg, 'sportplus', 90);
        assert.deepStrictEqual(th, { limit: 7000, shift: 6800, start: 6000 });
        assert.deepStrictEqual(L.thresholds(cfg, 'sportplus', 20), { limit: 4500, shift: 4350, start: 3550 });
        assert.deepStrictEqual(L.thresholds(cfg, 'comfort', null), { limit: 7000, shift: 5000, start: 4000 });
        let s = L.step(null, 5900, th, cfg);
        assert.strictEqual(s.lit, 0);
        s = L.step(s, 6450, th, cfg); assert.strictEqual(s.lit, 5);
        s = L.step(s, 6420, th, cfg); assert.strictEqual(s.lit, 5, 'within the hysteresis');
        s = L.step(s, 6300, th, cfg); assert.strictEqual(s.lit, 4);
        s = L.step(s, 6800, th, cfg); assert.deepStrictEqual([s.lit, s.red, s.flashing], [10, true, false]);
        s = L.step(s, 6900, th, cfg); assert.deepStrictEqual([s.lit, s.flashing], [10, true]);
        s = L.step(s, 6860, th, cfg); assert.strictEqual(s.flashing, true, 'flash holds within the hysteresis');
        s = L.step(s, 6840, th, cfg); assert.strictEqual(s.flashing, false);
        assert.deepStrictEqual(L.step(s, NaN, th, cfg), { lit: 0, red: false, flashing: false });
    }],
    ['0-60 timer: armed at a standstill, both crossings interpolated, best kept, aborted by stopping or after 30 s', () => {
        const T = 60 * 1.609344;
        let t = L.timerStep(null, 0, 0, T);
        assert.strictEqual(t.phase, 'ready');
        t = L.timerStep(t, 1.5, 100, T);           // 0.5 crossed at 33.3 ms
        assert.strictEqual(t.phase, 'run');
        assert.ok(Math.abs(t.t0 - 33.33) < 0.1, String(t.t0));
        t = L.timerStep(t, 90, 4600, T);
        t = L.timerStep(t, 100, 5100, T);           // 96.56 crossed at 4928 ms
        assert.deepStrictEqual([t.phase, t.last, t.best], ['idle', 4.9, 4.9]);
        t = L.timerStep(t, 0, 9000, T); t = L.timerStep(t, 10, 9100, T); t = L.timerStep(t, 0.2, 9300, T);
        assert.strictEqual(t.phase, 'ready', 'stopped again: aborted');
        t = L.timerStep(t, 5, 10000, T); t = L.timerStep(t, 30, 41000, T);
        assert.deepStrictEqual([t.phase, t.last], ['idle', 4.9], 'over 30 s: dropped, last kept');
        assert.strictEqual(L.timerStep(t, NaN, 42000, T), t);
    }],
    ['settings: defaults from app.json, cover off; garbage of every type falls back with its key listed; hidden widgets fall back', () => {
        const def = L.readSettings(() => undefined, SPEC.settings);
        assert.strictEqual(def.values.coverOn, false);
        assert.deepStrictEqual(def.bad, []);
        const bad = { coverOn: 'yes', whenToShow: 'never', leftPanel: 'xyz', leftLower: 7, rightPanel: null, rightLower: ['power'], swapSides: 1, coverSlats: {}, units: 'imperial', bright: 55, nightDim: 'off', demo: true };
        const r = L.readSettings((k) => bad[k], SPEC.settings);
        SPEC.settings.forEach((s) => assert.deepStrictEqual(r.values[s.key], s.default, s.key));
        assert.deepStrictEqual(r.bad.slice().sort(), Object.keys(bad).sort());
        const h = L.readSettings((k) => ({ leftPanel: 'media', rightLower: 'oilpress' })[k], SPEC.settings);
        assert.deepStrictEqual([h.values.leftPanel, h.values.rightLower], ['tyres', 'power']);
        assert.deepStrictEqual(h.bad.sort(), ['leftPanel', 'rightLower']);
        assert.deepStrictEqual(L.readSettings(() => { throw new Error('x'); }, SPEC.settings).values.coverOn, false);
    }],
    ['panels: a whole widget takes both halves (its lower ignored), swap moves only the panels, a whole in a lower half is ignored', () => {
        const v = (o) => L.readSettings((k) => o[k], SPEC.settings).values;
        assert.deepStrictEqual(L.layoutOf(v({})), { left: { full: 'tyres' }, right: { upper: 'torque', lower: 'power' } });
        assert.deepStrictEqual(L.layoutOf(v({ leftPanel: 'coolant', leftLower: 'gforce' })).left, { upper: 'coolant', lower: 'none' });
        assert.deepStrictEqual(L.layoutOf(v({ leftPanel: 'gforce', leftLower: 'boost' })).left, { full: 'gforce' });
        assert.deepStrictEqual(L.layoutOf(v({ swapSides: true })), { left: { upper: 'torque', lower: 'power' }, right: { full: 'tyres' } });
    }],
    ['migration writes _settingsV once', () => {
        assert.deepStrictEqual(L.migrateSettings(() => undefined), [['_settingsV', 1]]);
        assert.deepStrictEqual(L.migrateSettings((k) => (k === '_settingsV' ? 1 : undefined)), []);
        assert.deepStrictEqual(L.migrateSettings(() => { throw new Error('x'); }), [['_settingsV', 1]]);
    }],
    ['brightness: the setting times night dim', () => {
        assert.strictEqual(L.levelOf(cfg, { bright: 100, nightDim: false }), 1);
        assert.strictEqual(L.levelOf(cfg, { bright: 40, nightDim: false }), 0.4);
        assert.strictEqual(L.levelOf(cfg, { bright: 100, nightDim: true }), cfg.nightDim);
        assert.strictEqual(L.levelOf(cfg, { bright: 'x' }), 1);
    }],
];
