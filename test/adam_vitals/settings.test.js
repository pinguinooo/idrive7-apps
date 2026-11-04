'use strict';
/* settings_check.js against the real app.json, and app.json's labels against their values. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..', '..', 'apps', 'adam_vitals');
const { clean } = require(path.join(APP, 'settings_check.js'));
const SPEC = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));
const schema = SPEC.settings;
const defaults = () => { const o = {}; schema.forEach((s) => { o[s.key] = s.default; }); return o; };
const item = (k) => schema.filter((s) => s.key === k)[0];

module.exports = [
    ['garbage values fall back to their defaults and are listed', () => {
        const saved = Object.assign(defaults(), { units: 'xyz', warmOil: 999, showWarmup: 'yes', maxPower: 286, page: 7 });
        const r = clean(schema, saved);
        assert.deepStrictEqual(r.bad.slice().sort(), ['maxPower', 'page', 'showWarmup', 'units', 'warmOil']);
        assert.deepStrictEqual(r.values, defaults());
        assert.strictEqual(r.values.units, 'us');
        assert.strictEqual(saved.units, 'xyz', 'the input is not changed');
    }],
    ['valid values are kept, unknown keys survive', () => {
        const saved = Object.assign(defaults(), { units: 'metric', warmOil: 90, showWarmup: false, maxPower: 300, page: 'cooldown', _themeV: 2, _reset_x: 1 });
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
        assert.strictEqual(r.values.warmOil, 80);
        assert.deepStrictEqual(r.bad, []);
    }],
    ['number type: only its steps (peakHold)', () => {
        assert.deepStrictEqual(clean(schema, Object.assign(defaults(), { peakHold: 7 })).bad, ['peakHold']);
        assert.deepStrictEqual(clean(schema, Object.assign(defaults(), { peakHold: 30 })).bad, []);
    }],
    ['every hp and degree F label matches its value', () => {
        item('maxPower').options.forEach((o) => assert.strictEqual(o[1], Math.round(o[0] * 1.34102) + ' hp (' + o[0] + ' kW)'));
        ['warmOil', 'warmCoolant', 'oilWarn'].forEach((k) => item(k).options.forEach((o) =>
            assert.strictEqual(o[1], Math.round(o[0] * 9 / 5 + 32) + ' °F (' + o[0] + ' °C)', k)));
    }],
    ['labels are ASCII plus the degree sign, defaults are options', () => {
        schema.forEach((s) => {
            [s.label].concat((s.options || []).map((o) => o[1])).forEach((l) => assert(/^[\x20-\x7e°]*$/.test(l), s.key + ': ' + l));
            if (s.type === 'choice') assert(s.options.some((o) => o[0] === s.default), s.key + ' default');
        });
        assert.strictEqual(item('units').default, 'us');
        assert.strictEqual(item('maxPower').default, 285);
    }],
];
