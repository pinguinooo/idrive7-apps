'use strict';
/* logic.js: the when-to-show table for every drive mode x setting, every single condition that keeps the cover off,
 * the Safety settings (BMW popups x the popup signal's state, drop if no drive mode, the speed timeout) as a decision
 * table, every always-on guard under every Safety value (garbage too), the 1 s hold (blip, clock backwards, no
 * change), the slats, the 0-60 timer, settings fallback (strict side for Safety), the 0.1.0 migration, panel layout. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const L = require('../../apps/adam_mtrack/logic');
const cfg = require('../../apps/adam_mtrack/config');
const SPEC = JSON.parse(fs.readFileSync(path.join(__dirname, '../../apps/adam_mtrack/app.json'), 'utf8'));

const NOW = 1000000;
/** Every condition true, the Safety settings at their defaults: the cover may show (held since long ago). */
const OK = () => ({ coverOn: true, killed: false, tripped: false, demo: false, art: true, link: 'ready', cc: 'present', ccActive: false, ccNewAt: null,
    target: 'shown', holder: '', speedAt: NOW - 100, lastErrorAt: null, mode: 'sportplus', when: 'sportplus',
    popupGuard: 'auto', modeMissingDrop: false, staleMs: 1000 });
const want = (s, since) => L.decide(s, NOW, since === undefined ? NOW - 5000 : since, cfg);
const reasonOf = (s) => { const r = want(s); return r.want ? '' : r.reason; };
/** Every value a hand-edited settings file could hold for each Safety setting (valid ones and garbage). */
const ANY = {
    popupGuard: ['auto', 'require', 'ignore', 'off', '', null, undefined, 0, true, {}],
    modeMissingDrop: [true, false, 'false', 0, null, undefined],
    staleMs: [500, 1000, 1500, 3000, 1e9, Infinity, -1, 0, NaN, '1000', null, undefined],
    when: ['sportplus', 'sport', 'always', 'never', undefined],
};
function everySafetyValue(fn) {
    ANY.popupGuard.forEach((popupGuard) => ANY.modeMissingDrop.forEach((modeMissingDrop) => ANY.staleMs.forEach((staleMs) =>
        ANY.when.forEach((when) => fn({ popupGuard, modeMissingDrop, staleMs, when })))));
}

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
            [{ art: false }, 'noart'], [{ art: undefined }, 'noart'],
            [{ link: 'connecting' }, 'renderer'], [{ link: 'none' }, 'renderer'], [{ cc: 'missing', popupGuard: 'require' }, 'nocc'],
            [{ cc: 'waiting' }, 'ccwait'], [{ ccActive: true }, 'cc'],
            [{ ccNewAt: NOW - 999 }, 'cc'], [{ target: 'waiting', holder: 'stock' }, 'held'], [{ target: 'parked', holder: 'stock' }, 'held'],
            [{ target: 'waiting', holder: 'foreign' }, 'busy'], [{ busy: 'the HUD is shown' }, 'busy'], [{ busy: 'x', ccActive: true }, 'busy'],
            [{ heldUntil: NOW + 5000 }, 'held'], [{ speedAt: NOW - 1001 }, 'nospeed'], [{ speedAt: null }, 'nospeed'],
            [{ speedAt: NOW + 50 }, 'nospeed'], [{ lastErrorAt: NOW - 999 }, 'error'], [{ mode: 'comfort' }, 'mode'],
            [{ mode: null, modeMissingDrop: true }, 'nomode'],
        ];
        cases.forEach((c) => {
            const r = want(Object.assign(OK(), c[0]));
            assert.deepStrictEqual([r.want, r.reason, r.since], [false, c[1], null], JSON.stringify(c[0]));
        });
    }],
    ['BMW popups x the popup signal: Use if sent blocks only on a popup (or while not answered yet), Require also without the signal, Ignore never', () => {
        // the popup signal's state -> the reason for auto / require / ignore / a garbage value (read as require); '' = shows
        const SIG = [
            ['present, idle', { cc: 'present' }, ['', '', '', '']],
            ['present, a message up', { cc: 'present', ccActive: true }, ['cc', 'cc', '', 'cc']],
            ['present, a new message 0.5 s ago', { cc: 'present', ccNewAt: NOW - 500 }, ['cc', 'cc', '', 'cc']],
            ['missing (Adam\'s car)', { cc: 'missing' }, ['', 'nocc', '', 'nocc']],
            ['missing, the new-message event 0.5 s ago', { cc: 'missing', ccNewAt: NOW - 500 }, ['cc', 'nocc', '', 'nocc']],
            ['not answered yet', { cc: 'waiting' }, ['ccwait', 'nocc', '', 'nocc']],
            ['an unknown state (read as not answered)', { cc: 'x' }, ['ccwait', 'nocc', '', 'nocc']],
        ];
        SIG.forEach((c) => ['auto', 'require', 'ignore', 'banana'].forEach((pg, i) => {
            assert.strictEqual(reasonOf(Object.assign(OK(), c[1], { popupGuard: pg })), c[2][i], c[0] + ' / ' + pg);
        }));
        assert.strictEqual(L.popupGuardOf(undefined), 'require', 'no value: the strict side');
        // Ignore never overrides BMW holding the panel (the renderer's own rule)
        assert.strictEqual(reasonOf(Object.assign(OK(), { popupGuard: 'ignore', ccActive: true, target: 'waiting', holder: 'stock' })), 'held');
    }],
    ['drive mode x When to show x Drop if no drive mode: a missing mode drops when on; when off only Always shows without it', () => {
        const T = {     // mode -> [when sportplus, sport, always] for drop off, then drop on
            sportplus: [['', '', ''], ['', '', '']], sport: [['mode', '', ''], ['mode', '', '']],
            comfort: [['mode', 'mode', ''], ['mode', 'mode', '']], null: [['mode', 'mode', ''], ['nomode', 'nomode', 'nomode']],
        };
        Object.keys(T).forEach((mk) => [false, true].forEach((drop, d) => ['sportplus', 'sport', 'always'].forEach((when, w) => {
            const mode = mk === 'null' ? null : mk;
            assert.strictEqual(reasonOf(Object.assign(OK(), { mode, when, modeMissingDrop: drop })), T[mk][d][w], mk + ' / ' + when + ' / drop ' + drop);
        })));
        ['yes', 1, null, undefined].forEach((x) => assert.strictEqual(reasonOf(Object.assign(OK(), { mode: null, when: 'always', modeMissingDrop: x })), 'nomode', 'drop ' + x + ': strict'));
    }],
    ['speed timeout: 0.5 to 3 s as set; any other value is the tested 1 s, never longer and never off', () => {
        const at = (age, staleMs) => reasonOf(Object.assign(OK(), { speedAt: NOW - age, staleMs }));
        [[500, 499, ''], [500, 501, 'nospeed'], [1000, 999, ''], [1000, 1001, 'nospeed'], [1500, 1499, ''], [1500, 1501, 'nospeed'],
            [3000, 2999, ''], [3000, 3001, 'nospeed']].forEach((c) => assert.strictEqual(at(c[1], c[0]), c[2], c[0] + ' ms timeout, speed ' + c[1] + ' ms old'));
        [1e9, Infinity, -1, 0, 499, 3001, NaN, '3000', null, undefined, {}].forEach((x) => {
            assert.strictEqual(L.staleMsOf(x, cfg), cfg.safety.speedStaleMs, String(x));
            assert.strictEqual(at(1001, x), 'nospeed', 'bad timeout ' + String(x) + ': 1 s still applies');
            assert.strictEqual(at(999, x), '', 'bad timeout ' + String(x) + ': a fresh speed still shows');
        });
        assert.deepStrictEqual([L.speedStatus(null, NOW, 1000, cfg), L.speedStatus(NOW - 10, NOW, 1000, cfg), L.speedStatus(NOW - 2000, NOW, 1000, cfg),
            L.speedStatus(NOW + 10, NOW, 1000, cfg)], ['missing', 'present', 'stale', 'stale'], 'missing / present / stale / from the future');
    }],
    ['every always-on guard blocks under every Safety value a settings file can hold (valid or garbage)', () => {
        const LOCKED = [
            [{ killed: true }, 'kill'], [{ tripped: true }, 'tripped'], [{ demo: true }, 'demo'], [{ art: false }, 'noart'], [{ link: 'none' }, 'renderer'],
            [{ target: 'waiting', holder: 'stock' }, 'held'], [{ target: 'parked', holder: 'foreign' }, 'busy'], [{ busy: 'the HUD is waiting' }, 'busy'],
            [{ heldUntil: NOW + 1 }, 'held'], [{ speedAt: NOW - 3001 }, 'nospeed'],
            [{ speedAt: null }, 'nospeed'], [{ speedAt: NOW + 5 }, 'nospeed'], [{ lastErrorAt: NOW - 10 }, 'error'],
        ];
        let n = 0;
        LOCKED.forEach((c) => everySafetyValue((safety) => {
            const s = Object.assign(OK(), safety, c[0]), r = want(s);
            n++;
            assert.ok(!r.want, JSON.stringify(c[0]) + ' shown with ' + JSON.stringify(safety));
            assert.strictEqual(r.reason, c[1], JSON.stringify(c[0]) + ' with ' + JSON.stringify(safety));
        }));
        assert.ok(n > 20000, 'combinations ' + n);
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
    ['settings: defaults from app.json, cover off; garbage of every type falls back with its key listed (a Safety setting to its strict side); hidden widgets fall back', () => {
        const def = L.readSettings(() => undefined, SPEC.settings);
        assert.strictEqual(def.values.coverOn, false);
        assert.deepStrictEqual([def.values.popupGuard, def.values.modeMissingDrop, def.values.speedStaleMs], ['auto', false, 1000], 'Safety defaults');
        assert.deepStrictEqual(def.bad, []);
        const bad = { coverOn: 'yes', whenToShow: 'never', leftPanel: 'xyz', leftLower: 7, rightPanel: null, rightLower: ['power'], swapSides: 1, coverSlats: {}, units: 'imperial', bright: 55, nightDim: 'off', demo: true,
            popupGuard: 'Auto', modeMissingDrop: 'false', speedStaleMs: 99999 };
        const r = L.readSettings((k) => bad[k], SPEC.settings);
        SPEC.settings.forEach((s) => assert.deepStrictEqual(r.values[s.key], L.STRICT[s.key] !== undefined ? L.STRICT[s.key] : s.default, s.key));
        assert.deepStrictEqual([r.values.popupGuard, r.values.modeMissingDrop, r.values.speedStaleMs], ['require', true, 1000], 'strict side, tested timeout');
        assert.deepStrictEqual(r.bad.slice().sort(), Object.keys(bad).sort());
        [500, 750, 3500, '1000', -500].forEach((x) => {
            const t = L.readSettings((k) => (k === 'speedStaleMs' ? x : undefined), SPEC.settings).values.speedStaleMs;
            assert.ok(t >= cfg.safety.speedStaleMinMs && t <= cfg.safety.speedStaleMaxMs, x + ' -> ' + t);
        });
        const h = L.readSettings((k) => ({ leftPanel: 'media', rightLower: 'oilpress' })[k], SPEC.settings);
        assert.deepStrictEqual([h.values.leftPanel, h.values.rightLower], ['coolant', 'power']);
        assert.deepStrictEqual(h.bad.sort(), ['leftPanel', 'rightLower']);
        assert.deepStrictEqual(L.readSettings(() => { throw new Error('x'); }, SPEC.settings).values.coverOn, false);
    }],
    ['panels: a whole widget takes both halves (its lower ignored), swap moves only the panels, a whole in a lower half is ignored', () => {
        const v = (o) => L.readSettings((k) => o[k], SPEC.settings).values;
        assert.deepStrictEqual(L.layoutOf(v({})), { left: { upper: 'coolant', lower: 'oil' }, right: { upper: 'torque', lower: 'power' } });
        assert.deepStrictEqual(L.layoutOf(v({ leftPanel: 'coolant', leftLower: 'gforce' })).left, { upper: 'coolant', lower: 'none' });
        assert.deepStrictEqual(L.layoutOf(v({ leftPanel: 'gforce', leftLower: 'boost' })).left, { full: 'gforce' });
        assert.deepStrictEqual(L.layoutOf(v({ swapSides: true })), { left: { upper: 'torque', lower: 'power' }, right: { upper: 'coolant', lower: 'oil' } });
    }],
    ['migration from 0.1.0: the Safety settings get their defaults (BMW popups = Use if sent), then _settingsV 2, once', () => {
        // a settings.json as 0.1.0 saved it (every 0.1.0 key, _settingsV 1, no Safety key)
        const v010 = { coverOn: true, whenToShow: 'always', leftPanel: 'tyres', leftLower: 'none', rightPanel: 'torque', rightLower: 'power', swapSides: false,
            coverSlats: true, units: 'us', bright: 100, nightDim: false, demo: 'auto', _settingsV: 1 };
        const file = Object.assign({}, v010), get = (k) => file[k];
        const moves = L.migrateSettings(get, SPEC.settings);
        assert.deepStrictEqual(moves, [['popupGuard', 'auto'], ['modeMissingDrop', false], ['speedStaleMs', 1000], ['_settingsV', 2]]);
        moves.forEach((w) => { file[w[0]] = w[1]; });
        assert.deepStrictEqual(L.migrateSettings(get, SPEC.settings), [], 'once');
        const r = L.readSettings(get, SPEC.settings);
        assert.deepStrictEqual(r.bad, []);
        Object.keys(v010).filter((k) => k !== '_settingsV').forEach((k) => assert.deepStrictEqual(r.values[k], v010[k], k + ' kept'));
        // the blocker Adam hit: no popup signal on his car. 0.1.1 shows; Require is the old rule
        const st = (pg) => Object.assign(OK(), { cc: 'missing', when: r.values.whenToShow, popupGuard: pg, modeMissingDrop: r.values.modeMissingDrop, staleMs: r.values.speedStaleMs });
        assert.strictEqual(reasonOf(st(r.values.popupGuard)), '', 'migrated: shows without the popup signal');
        assert.strictEqual(reasonOf(st('require')), 'nocc');
        // the kit's Settings hands defaults for keys a file lacks: only the version is written
        const kit = Object.assign({}, v010, { popupGuard: 'auto', modeMissingDrop: false, speedStaleMs: 1000 });
        assert.deepStrictEqual(L.migrateSettings((k) => kit[k], SPEC.settings), [['_settingsV', 2]]);
        // a saved bad value is never overwritten here: it reads as the strict side
        const odd = Object.assign({}, v010, { popupGuard: 'banana' });
        assert.deepStrictEqual(L.migrateSettings((k) => odd[k], SPEC.settings), [['modeMissingDrop', false], ['speedStaleMs', 1000], ['_settingsV', 2]]);
        assert.strictEqual(L.readSettings((k) => odd[k], SPEC.settings).values.popupGuard, 'require');
        assert.deepStrictEqual(L.migrateSettings(() => { throw new Error('x'); }, SPEC.settings), [['popupGuard', 'auto'], ['modeMissingDrop', false], ['speedStaleMs', 1000], ['_settingsV', 2]]);
        assert.deepStrictEqual(L.migrateSettings(() => undefined), [['_settingsV', 2]], 'no schema: only the version');
    }],
    ['brightness: the setting times night dim', () => {
        assert.strictEqual(L.levelOf(cfg, { bright: 100, nightDim: false }), 1);
        assert.strictEqual(L.levelOf(cfg, { bright: 40, nightDim: false }), 0.4);
        assert.strictEqual(L.levelOf(cfg, { bright: 100, nightDim: true }), cfg.nightDim);
        assert.strictEqual(L.levelOf(cfg, { bright: 'x' }), 1);
    }],
    ['after BMW took the panel the cover waits heldBackoffMs; a heldUntil past, or further away than the backoff (a clock jump), does not hold it', () => {
        const B = cfg.renderer.heldBackoffMs;
        assert.strictEqual(reasonOf(Object.assign(OK(), { heldUntil: NOW + B })), 'held');
        assert.strictEqual(reasonOf(Object.assign(OK(), { heldUntil: NOW + 1 })), 'held');
        assert.strictEqual(reasonOf(Object.assign(OK(), { heldUntil: NOW })), '');
        assert.strictEqual(reasonOf(Object.assign(OK(), { heldUntil: NOW - 1 })), '');
        assert.strictEqual(reasonOf(Object.assign(OK(), { heldUntil: NOW + B + 1 })), '', 'a wall clock that jumped back never holds it longer than the backoff');
        assert.strictEqual(reasonOf(Object.assign(OK(), { heldUntil: null })), '');
        assert.strictEqual(reasonOf(Object.assign(OK(), { busy: '' })), '', 'no other app: shows');
        assert.strictEqual(reasonOf(Object.assign(OK(), { busy: 'the HUD is shown', heldUntil: NOW + 5 })), 'busy', 'another app outranks the backoff');
    }],
    ['0.1.6 gearGlyph: P R N letters; D or no stage with a whole gear 1-8 its digit; D with no usable gear D; no stage -1 R; else a dash', () => {
        ['P', 'R', 'N'].forEach((st) => [undefined, null, 0, 3, -1, 'x', NaN].forEach((g) => assert.strictEqual(L.gearGlyph(st, g), st, st + ' ' + String(g))));
        [1, 2, 3, 4, 5, 6, 7, 8].forEach((g) => { assert.strictEqual(L.gearGlyph('D', g), String(g)); assert.strictEqual(L.gearGlyph(undefined, g), String(g)); assert.strictEqual(L.gearGlyph(null, g), String(g)); });
        [undefined, null, 0, 9, 10, -1, 2.5, NaN, Infinity, '4', 'G4', {}].forEach((g) => assert.strictEqual(L.gearGlyph('D', g), 'D', 'D ' + String(g)));
        assert.strictEqual(L.gearGlyph(undefined, -1), 'R');
        assert.strictEqual(L.gearGlyph(null, -1), 'R');
        [0, undefined, null, 9, 10, NaN, '3'].forEach((g) => assert.strictEqual(L.gearGlyph(undefined, g), '-', 'no stage ' + String(g)));
        ['M', 'S', 'M1', 'd', '', 4, {}].forEach((st) => [3, -1, undefined].forEach((g) => assert.strictEqual(L.gearGlyph(st, g), '-', JSON.stringify(st) + ' ' + String(g))));
        ['1', '2', '3', '4', '5', '6', '7', '8'].forEach((c) => assert.ok(!/M/.test(L.gearGlyph('D', Number(c))), 'no M prefix'));
    }],
    /* makeLead: apps/adam_shiftlights/logic.js's, its tests ported (test/adam_shiftlights/logic.test.js) on cfg.rpmLead, plus the maxAddRpm cap */
    ['lead: leadMs 0 adds nothing; flat, falling and noisy-flat rpm get no lead', () => {
        const ramp = (f, rpmAt, n, hz, ms) => { const out = []; for (let i = 0; i < n; i++) out.push(f(rpmAt(i * 1000 / hz), i * 1000 / hz, ms)); return out; };
        ramp(L.makeLead(cfg.rpmLead), (t) => 5000 + 3 * t, 40, 20, 0).forEach((r) => assert.strictEqual(r.add, 0));
        let seed = 7;
        const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
        [(t) => 6200, (t) => 6800 - 2 * t, (t) => 6200 + Math.round((rnd() * 2 - 1) * 25)].forEach((g, i) => {
            [10, 20, 50].forEach((hz) => ramp(L.makeLead(cfg.rpmLead), g, 60, hz, 80).forEach((r) => assert.strictEqual(r.add, 0, 'case ' + i + ' at ' + hz + ' Hz')));
        });
    }],
    ['lead: a 3 rpm/ms rise at 20 Hz leads 180 rpm at 60 ms once the window is full; capped at maxAddRpm (300)', () => {
        const f = L.makeLead(cfg.rpmLead);
        let r;
        for (let t = 0; t <= 400; t += 50) r = f(5000 + 3 * t, t, 60);
        assert.ok(Math.abs(r.add - 180) <= 2, String(r.add));
        assert.strictEqual(r.rpm, 5000 + 3 * 400 + r.add);
        const g = L.makeLead(cfg.rpmLead);
        for (let t = 0; t <= 400; t += 50) r = g(1000 + 6 * t, t, 80);
        assert.strictEqual(r.add, cfg.rpmLead.maxAddRpm, '6 rpm/ms x 80 ms = 480, capped');
        assert.strictEqual(r.rpm, 1000 + 6 * 400 + cfg.rpmLead.maxAddRpm);
        assert.strictEqual(g(1000 + 6 * 410, 410, 80).add, cfg.rpmLead.maxAddRpm, 'the kept slope is capped too');
        assert.strictEqual(cfg.rpmLead.maxAddRpm, 300);
    }],
    ['lead: the soft gate gives none at 1 rpm/ms, half the slope at 1.5, all of it from 2', () => {
        const at = (slope) => { const f = L.makeLead(cfg.rpmLead); let r; for (let t = 0; t <= 400; t += 20) r = f(5000 + slope * t, t, 60); return r.add / (slope * 60); };
        assert.ok(Math.abs(at(1.0)) < 0.01, String(at(1.0)));
        assert.ok(Math.abs(at(1.5) - 0.5) < 0.01, String(at(1.5)));
        assert.ok(Math.abs(at(2.0) - 1) < 0.01, String(at(2.0)));
    }],
    ['lead: a gap over 2 x the window, an invalid rpm or time, or a clock set back an hour starts again with no lead', () => {
        const f = L.makeLead(cfg.rpmLead);
        for (let t = 0; t <= 400; t += 50) f(5000 + 3 * t, t, 60);
        assert.strictEqual(f(6500, 400 + 2 * cfg.rpmLead.slopeWindowMs + 10, 60).add, 0, 'gap');
        [undefined, NaN, -1, '6000'].forEach((bad) => {
            const g = L.makeLead(cfg.rpmLead);
            for (let t = 0; t <= 400; t += 50) g(5000 + 3 * t, t, 60);
            const r = g(bad, 450, 60);
            assert.ok(Object.is(r.rpm, bad) && r.add === 0, String(bad));     // Object.is: Node 8's deepStrictEqual has NaN !== NaN
            assert.strictEqual(g(6400, 500, 60).add, 0, 'history cleared after ' + String(bad));
        });
        assert.strictEqual(L.makeLead(cfg.rpmLead)(6000, NaN, 60).add, 0);
        const T0 = 1.7e12, h = L.makeLead(cfg.rpmLead);
        let r;
        for (let t = 0; t <= 400; t += 50) r = h(3000 + 3 * t, T0 + t, 60);
        assert.ok(r.add > 100, 'leading before the jump: ' + r.add);
        assert.strictEqual(h(4300, T0 + 450 - 3600e3, 60).add, 0, 'wall clock set back an hour: no lead (KB-ANY-204)');
        assert.strictEqual(h(4450, T0 + 500 - 3600e3, 60).add, 0, 'and none from the stale history after it');
    }],
    ['lead: an unchanged rpm (a speed tick) keeps the last lead inside the window, then decays to 0', () => {
        const f = L.makeLead(cfg.rpmLead);
        let r;
        for (let t = 0; t <= 400; t += 50) r = f(5000 + 3 * t, t, 60);
        assert.strictEqual(f(6200, 410, 60).add, r.add);
        assert.strictEqual(f(6200, 540, 60).add, r.add);
        assert.strictEqual(f(6200, 400 + cfg.rpmLead.slopeWindowMs + 1, 60).add, 0);
    }],
    ['step with a lead: lit at once when a boundary is crossed, off only lead + hysteresis under it; a falling lead never flickers', () => {
        const th = L.thresholds(cfg, 'sportplus', 95);
        [0, 100].forEach((add) => {
            let s = null, prev = -1;
            for (let r = 5900; r <= 6700; r++) {
                s = L.step(s, r, th, cfg, add);
                assert.ok(s.lit >= prev, 'rising never goes down: rpm ' + r);
                prev = s.lit;
            }
        });
        const s = L.step(null, 6450, th, cfg, 100);
        assert.strictEqual(s.lit, 5);
        // the lead falls away (6450 shown -> the raw 6350 a moment later): still 5 lit, as hysteresis + lead covers it
        assert.strictEqual(L.step(s, 6350, th, cfg, 100).lit, 5, 'no flicker as the lead falls away');
        assert.strictEqual(L.step(s, 6350, th, cfg, 0).lit, 4, 'without the lead it goes off (hysteresis 50 only)');
        assert.deepStrictEqual([-5, NaN, 'x', undefined].map((a) => L.step(s, 6350, th, cfg, a).lit), [4, 4, 4, 4], 'a bad lead counts as 0');
    }],
    ['readSettings: tachLead outside its steps (55, 100, "40", null, -20) falls back to the default with its key listed; every step kept', () => {
        const def = SPEC.settings.filter((x) => x.key === 'tachLead')[0].default;
        assert.strictEqual(def, cfg.rpmLead.leadMs);
        assert.strictEqual(L.readSettings(() => undefined, SPEC.settings).values.tachLead, def);
        [55, 100, '40', null, -20, true].forEach((x) => {
            const r = L.readSettings((k) => (k === 'tachLead' ? x : undefined), SPEC.settings);
            assert.strictEqual(r.values.tachLead, def, JSON.stringify(x));
            assert.ok(r.bad.indexOf('tachLead') >= 0, JSON.stringify(x));
        });
        cfg.LEAD_STEPS.forEach((x) => assert.strictEqual(L.readSettings((k) => (k === 'tachLead' ? x : undefined), SPEC.settings).values.tachLead, x));
    }],
];
