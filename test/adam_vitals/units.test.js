'use strict';
/* units.js: conversions, the units setting against the car's own units, and the scales. */
const assert = require('assert');
const path = require('path');
const U = require(path.join(__dirname, '..', '..', 'apps', 'adam_vitals', 'units.js'));

const near = (a, b, eps, msg) => assert(Math.abs(a - b) <= (eps || 1e-9), (msg || '') + ' ' + a + ' vs ' + b);
const US = { temp: 'F', press: 'psi', power: 'hp', torque: 'lb-ft' }, METRIC = { temp: 'C', press: 'bar', power: 'kW', torque: 'Nm' };

module.exports = [
    ['temperature points', () => {
        assert.strictEqual(U.cToF(-40), -40);
        assert.strictEqual(U.cToF(100), 212);
        assert.strictEqual(Math.round(U.cToF(80)), 176);
        near(U.dCToF(10), 18);
    }],
    ['round trips stay within 1e-9', () => {
        [-40, 0, 37.5, 100, 150].forEach((x) => {
            near(U.fToC(U.cToF(x)), x, 1e-9, 'C/F');
            near(U.psiToBar(U.barToPsi(x)), x, 1e-9, 'bar/psi');
            near(U.hpToKw(U.kwToHp(x)), x, 1e-9, 'kW/hp');
            near(U.lbftToNm(U.nmToLbft(x)), x, 1e-9, 'Nm/lb-ft');
        });
    }],
    ['known values', () => {
        assert.strictEqual(Math.round(U.barToPsi(1) * 100) / 100, 14.5);
        assert.strictEqual(Math.round(U.kwToHp(285)), 382);
        assert.strictEqual(Math.round(U.nmToLbft(500)), 369);
    }],
    ['anything but a finite number converts to null', () => {
        [null, undefined, NaN, '12', Infinity, -Infinity, {}].forEach((x) => {
            ['cToF', 'fToC', 'dCToF', 'barToPsi', 'psiToBar', 'kwToHp', 'hpToKw', 'nmToLbft', 'lbftToNm'].forEach((f) => assert.strictEqual(U[f](x), null, f + '(' + String(x) + ')'));
            assert.strictEqual(U.T(x, U.US), null); assert.strictEqual(U.T(x, U.METRIC), null);
            assert.strictEqual(U.P(x, U.METRIC), null); assert.strictEqual(U.PW(x, U.METRIC), null); assert.strictEqual(U.TQ(x, U.METRIC), null);
        });
    }],
    ['resolve: an explicit setting beats the car, car follows it field by field', () => {
        assert.deepStrictEqual(U.resolve('us', { temp: 'C', press: 'BAR' }), US);
        assert.deepStrictEqual(U.resolve('metric', {}), METRIC);
        assert.deepStrictEqual(U.resolve('metric', { temp: 'F', press: 'PSI' }), METRIC);
        assert.deepStrictEqual(U.resolve('car', { temp: null, press: null }), US);
        assert.deepStrictEqual(U.resolve('car', { temp: 'C', press: 'KPA' }), METRIC);
        assert.deepStrictEqual(U.resolve('car', { temp: 'F', press: 'BAR' }), { temp: 'F', press: 'bar', power: 'hp', torque: 'lb-ft' });
        assert.deepStrictEqual(U.resolve('car', undefined), US);
        assert.deepStrictEqual(U.resolve('xyz', { temp: 'C', press: 'BAR' }), US);
        assert.deepStrictEqual(U.resolve(undefined, {}), US);
    }],
    ['shown values and labels follow the units', () => {
        assert.strictEqual(Math.round(U.T(90, U.US)), 194); assert.strictEqual(U.T(90, U.METRIC), 90);
        assert.strictEqual(U.tU(U.US), '°F'); assert.strictEqual(U.tU(U.METRIC), '°C');
        near(U.P(1, U.US), 14.5038); assert.strictEqual(U.P(1, U.METRIC), 1);
        assert.strictEqual(Math.round(U.TQ(500, U.US)), 369); assert.strictEqual(Math.round(U.PW(285, U.US)), 382);
    }],
    ['scales: psi boost -10..30, bar boost on its labels, temperature scales per unit', () => {
        const p = U.boostScale(U.US), b = U.boostScale(U.METRIC);
        assert.strictEqual(p.min, -10); assert.strictEqual(p.max, 30);
        assert.strictEqual(Math.abs((p.max - p.min) / p.every % 1) < 1e-9, true, 'psi labels end on max');
        assert.strictEqual(Math.abs((0 - b.min) / b.every % 1) < 1e-9, true, 'bar 0 is a label');
        assert.deepStrictEqual(U.tempScale('coolant', U.US), { min: 100, max: 260, step: 40 });
        assert.deepStrictEqual(U.tempScale('oil', U.US), { min: 100, max: 300, step: 50 });
        assert(U.tempScale('oil', U.METRIC).max >= 150);
    }],
];
