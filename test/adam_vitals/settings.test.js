'use strict';
/* settings_check.js against the real app.json: bad values fall back, labels match values, the new marks, and the
 * move from 0.1.0's saved settings (migrate). */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..', '..', 'apps', 'adam_vitals');
const { clean, migrate, SETTINGS_V } = require(path.join(APP, 'settings_check.js'));
const U = require(path.join(APP, 'units.js'));
const SPEC = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));
const schema = SPEC.settings;
const defaults = () => { const o = {}; schema.forEach((s) => { o[s.key] = s.default; }); return o; };
const item = (k) => schema.filter((s) => s.key === k)[0];
const F = (c) => Math.round(U.cToF(c));
/* settings.json as 0.1.0 (df42874) saved it: every key with its 0.1.0 default (the kit writes them all with the first
 * change), the kit's theme mark, and two choices of the owner (start page Warm-up, peaks off). */
const V010 = { units: 'us', page: 'warmup', showWarmup: true, warmOil: 80, warmCoolant: 80, cooldown: true, oilWarn: 125, coldLimit: 0,
    redline: 0, maxPower: 285, powerSource: 'sport', boostSource: 'auto', engine: 'auto', peaks: false, peakHold: 15, xdrive: 'auto',
    flipLong: false, showGearbox: 'auto', showEgs: 'auto', showIat: 'auto', showHpfp: 'auto', showLpfp: 'auto', showTiming: 'auto',
    showBoostCtl: 'auto', showLoad: 'auto', showMisfire: 'auto', showTyres: 'auto', showTyreTemp: 'auto', theme: 'm_tricolour',
    layout: 'full', renderer: 'auto', demo: 'auto', _themeV: 2 };
const apply = (file, writes) => { const o = Object.assign({}, file); writes.forEach((w) => { o[w[0]] = w[1]; }); return o; };

module.exports = [
    ['garbage values fall back to their defaults and are listed', () => {
        const saved = Object.assign(defaults(), { units: 'xyz', warmOil: 999, showWarmup: 'yes', maxPower: 286, page: 7, warmTrans: 'hot', transWarmup: 1 });
        const r = clean(schema, saved);
        assert.deepStrictEqual(r.bad.slice().sort(), ['maxPower', 'page', 'showWarmup', 'transWarmup', 'units', 'warmOil', 'warmTrans']);
        assert.deepStrictEqual(r.values, defaults());
        assert.strictEqual(r.values.units, 'us');
        assert.strictEqual(saved.units, 'xyz', 'the input is not changed');
    }],
    ['valid values are kept, unknown keys survive', () => {
        const saved = Object.assign(defaults(), { units: 'metric', warmOil: 98.9, warmTrans: 76.7, transWarmup: false, showWarmup: false, maxPower: 300,
            page: 'cooldown', _themeV: 2, _reset_x: 1, _settingsV: 2 });
        const r = clean(schema, saved);
        assert.deepStrictEqual(r.bad, []);
        assert.deepStrictEqual(r.values, saved);
    }],
    ['a values object that is not an object gives all defaults', () => {
        [null, [], 'str', 42, undefined].forEach((v) => {
            const r = clean(schema, v);
            assert.deepStrictEqual(r.values, defaults(), JSON.stringify(v));
            assert.deepStrictEqual(r.bad, []);
        });
    }],
    ['a missing key gets its default without being reported', () => {
        const r = clean(schema, { units: 'car' });
        assert.strictEqual(r.values.units, 'car');
        assert.strictEqual(r.values.warmOil, item('warmOil').default);
        assert.strictEqual(r.values.warmTrans, item('warmTrans').default);
        assert.deepStrictEqual(r.bad, []);
    }],
    ['number type: only its steps (peakHold)', () => {
        assert.deepStrictEqual(clean(schema, Object.assign(defaults(), { peakHold: 7 })).bad, ['peakHold']);
        assert.deepStrictEqual(clean(schema, Object.assign(defaults(), { peakHold: 30 })).bad, []);
    }],
    ['the marks: oil and coolant warm at 220 F, transmission 160 F, oil warning 275 F, transmission counted, Auto shown', () => {
        assert.strictEqual(F(item('warmOil').default), 220);
        assert.strictEqual(F(item('warmCoolant').default), 220);
        assert.strictEqual(F(item('warmTrans').default), 160);
        assert.strictEqual(F(item('oilWarn').default), 275);
        assert.strictEqual(item('transWarmup').default, true);
        assert.strictEqual(item('transWarmup').label, 'Include transmission in warm-up');
        assert.strictEqual(item('showEgs').default, 'auto');
        assert.deepStrictEqual(item('showEgs').options.map((o) => o[0]), ['auto', 'on', 'off'], 'the 0.1.0 values still valid');
        assert(/hide when not available/i.test(item('showEgs').options[0][1]));
    }],
    ['every hp and degree F label matches its value', () => {
        item('maxPower').options.forEach((o) => assert.strictEqual(o[1], Math.round(o[0] * 1.34102) + ' hp (' + o[0] + ' kW)'));
        ['warmOil', 'warmCoolant', 'warmTrans', 'oilWarn'].forEach((k) => item(k).options.forEach((o) =>
            assert.strictEqual(o[1], F(o[0]) + ' °F (' + Math.round(o[0]) + ' °C)', k)));
        // the warm marks are whole F: a stored value 1 decimal of deg C shows its F label back exactly
        ['warmOil', 'warmCoolant', 'warmTrans'].forEach((k) => item(k).options.forEach((o) =>
            assert(Math.abs(U.cToF(o[0]) - F(o[0])) < 0.1, k + ' ' + o[0])));
    }],
    ['labels are ASCII plus the degree sign, defaults are options', () => {
        schema.forEach((s) => {
            [s.label].concat((s.options || []).map((o) => o[1])).forEach((l) => assert(/^[\x20-\x7e°]*$/.test(l), s.key + ': ' + l));
            if (s.type === 'choice') assert(s.options.some((o) => o[0] === s.default), s.key + ' default');
        });
        assert.strictEqual(item('units').default, 'us');
        assert.strictEqual(item('maxPower').default, 285);
    }],
    ['migration from 0.1.0: warm marks to 220 F and the oil warning to 275 F once, every other saved value kept', () => {
        assert.strictEqual(SETTINGS_V, 2);
        const w = migrate(V010, schema);
        assert.deepStrictEqual(w, [['warmOil', item('warmOil').default], ['warmCoolant', item('warmCoolant').default], ['oilWarn', item('oilWarn').default], ['_settingsV', 2]]);
        const after = apply(V010, w);
        assert.deepStrictEqual(migrate(after, schema), [], 'once');
        const r = clean(schema, after);
        assert.deepStrictEqual(r.bad, [], 'nothing saved by 0.1.0 is a bad value now');
        Object.keys(V010).filter((k) => ['warmOil', 'warmCoolant', 'oilWarn'].indexOf(k) < 0).forEach((k) => assert.deepStrictEqual(r.values[k], V010[k], k + ' kept'));
        assert.strictEqual(r.values.warmTrans, item('warmTrans').default, 'new keys get their defaults');
        assert.strictEqual(r.values.transWarmup, true);
        // whatever 0.1.0 had (he may have picked 212 F, its highest): moved, he asked for 220 F
        assert.deepStrictEqual(migrate(Object.assign({}, V010, { warmOil: 100, warmCoolant: 90, oilWarn: 130 }), schema).map((x) => x[0]), ['warmOil', 'warmCoolant', 'oilWarn', '_settingsV']);
    }],
    ['migration: a 0.2.0 choice is kept, a fresh install only gets the version, anything odd never throws', () => {
        const mine = Object.assign(defaults(), { warmOil: 98.9, oilWarn: 125, _settingsV: 2 });
        assert.deepStrictEqual(migrate(mine, schema), [], 'chosen in 0.2.0: kept');
        assert.deepStrictEqual(migrate(Object.assign({}, mine, { _settingsV: 3 }), schema), [], 'a later version: left alone');
        assert.deepStrictEqual(migrate(defaults(), schema), [['_settingsV', 2]], 'fresh: the defaults already');
        [null, undefined, [], 'x', 5].forEach((v) => assert.deepStrictEqual(migrate(v, schema), [['warmOil', item('warmOil').default], ['warmCoolant', item('warmCoolant').default], ['oilWarn', item('oilWarn').default], ['_settingsV', 2]], JSON.stringify(v)));
        assert.deepStrictEqual(migrate(V010, undefined), [['_settingsV', 2]], 'no schema: only the version');
        assert.deepStrictEqual(migrate(Object.assign({}, V010, { _settingsV: '2' }), schema).length, 4, 'a string version is not a version');
    }],
];
