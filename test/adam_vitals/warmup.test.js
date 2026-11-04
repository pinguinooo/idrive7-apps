'use strict';
/* warmup.js: rev limit, warm-up estimate, and the takeover state machine (show, Hide, new drive, warm). */
const assert = require('assert');
const path = require('path');
const W = require(path.join(__dirname, '..', '..', 'apps', 'adam_vitals', 'warmup.js'));

const T = { warmOil: 80, warmCoolant: 80 };
/** run the takeover over [ms, {oil, coolant, rpm}] steps 1 s apart from s; returns the state */
function run(s, ms, inp) {
    let st = s.st;
    for (let t = 0; t < ms; t += 1000) { s.now += 1000; st = W.step(st, Object.assign({ now: s.now }, T, inp)); }
    s.st = st;
    return st;
}
const fresh = () => ({ st: W.init(), now: 1000 });
const showing = (s, o) => W.show(s.st, Object.assign({ enabled: true, page: 'main' }, o));

module.exports = [
    ['limit: null without oil, redline once warm, cold limit at 30 deg C, monotonic and in 100s', () => {
        assert.strictEqual(W.limit(null, 80, 7000, 3500), null);
        assert.strictEqual(W.limit(NaN, 80, 7000, 3500), null);
        assert.strictEqual(W.limit(80, 80, 7000, 3500), 7000);
        assert.strictEqual(W.limit(95, 80, 7000, 3500), 7000);
        assert.strictEqual(W.limit(30, 80, 7000, 3500), 3500);
        assert.strictEqual(W.limit(10, 80, 7000, 3500), 3500);
        assert.strictEqual(W.limit(30, 80, 3000, 3500), 3000, 'cold limit never above the redline');
        let prev = 0;
        for (let o = 30; o < 80; o++) { const l = W.limit(o, 80, 7000, 3500); assert(l >= prev && l % 100 === 0, o + ': ' + l); prev = l; }
    }],
    ['eta: none, ready, off, warming (est early), stalled', () => {
        assert.strictEqual(W.eta('oil', null, 80, {}, []).state, 'none');
        assert.strictEqual(W.eta('oil', 85, 80, {}, []).state, 'ready');
        assert.strictEqual(W.eta('oil', 40, 80, { rpm: 200 }, []).state, 'off');
        const e = W.eta('oil', 40, 80, { rpm: 900, speed: 0 }, []);
        assert.strictEqual(e.state, 'warming'); assert.strictEqual(e.est, true);
        assert(Math.abs(e.min - 40 / 1.5) < 1e-9, 'typical idle rate: ' + e.min);
        assert(Math.abs(W.eta('oil', 40, 80, { rpm: 1500, speed: 40 }, []).min - 10) < 1e-9, 'typical drive rate');
        // 3 min measured at a flat 40 deg C: not warming
        const flat = []; for (let i = 0; i <= 36; i++) flat.push([i * 5000, 40, 50, 900, 0, 0]);
        assert.strictEqual(W.eta('oil', 40, 80, { rpm: 900, speed: 0 }, flat).state, 'stalled');
        // 3 min measured at 2 deg C / min: that rate, no longer an estimate
        const up = []; for (let i = 0; i <= 36; i++) up.push([i * 5000, 34 + i * 5000 / 60000 * 2, 50, 900, 0, 0]);
        const m = W.measured(up, 1);
        assert(Math.abs(m.rate - 2) < 1e-6, 'measured rate ' + m.rate);
        const e2 = W.eta('oil', 40, 80, { rpm: 900, speed: 0 }, up);
        assert.strictEqual(e2.est, false); assert(Math.abs(e2.min - 20) < 1e-6, 'min ' + e2.min);
    }],
    ['measured: under 4 points is no rate; a clock step back in the rows does not throw', () => {
        assert.deepStrictEqual(W.measured([[0, 40], [5000, 41]], 1), { rate: null, span: 0 });
        const rows = [[100000, 40], [105000, 41], [110000, 42], [5000, 43], [10000, 44]];
        const m = W.measured(rows, 1);
        assert(m.rate === null || isFinite(m.rate));
    }],
    ['takeover: a cold start shows, Hide hides, still cold it stays hidden', () => {
        const s = fresh();
        run(s, 3000, { oil: 20, coolant: 25, rpm: 800 });
        assert.strictEqual(showing(s), true);
        assert.strictEqual(W.reason(s.st, true), 'shown');
        const before = JSON.stringify(s.st);
        s.st = W.dismiss(s.st);
        assert.strictEqual(JSON.parse(before).dismissed, false, 'dismiss returns a new state');
        assert.strictEqual(showing(s), false);
        assert.strictEqual(W.reason(s.st, true), 'dismissed');
        run(s, 60000, { oil: 30, coolant: 40, rpm: 1500 });
        assert.strictEqual(showing(s), false);
    }],
    ['takeover: a 2 min start-stop keeps it hidden, 10 min off brings it back on a cold start', () => {
        const s = fresh();
        run(s, 2000, { oil: 20, coolant: 25, rpm: 800 });
        s.st = W.dismiss(s.st);
        run(s, 120000, { oil: 30, coolant: 40, rpm: 0 });
        run(s, 2000, { oil: 30, coolant: 40, rpm: 800 });
        assert.strictEqual(showing(s), false, 'start-stop');
        run(s, 600000, { oil: 25, coolant: 30, rpm: null });
        run(s, 2000, { oil: 25, coolant: 30, rpm: 800 });
        assert.strictEqual(showing(s), true, 'new drive');
    }],
    ['takeover: warm hides it, a dip under the target the same drive stays hidden', () => {
        const s = fresh();
        run(s, 2000, { oil: 40, coolant: 50, rpm: 800 });
        assert.strictEqual(showing(s), true);
        run(s, 2000, { oil: 85, coolant: 85, rpm: 2000 });
        assert.strictEqual(showing(s), false); assert.strictEqual(W.reason(s.st, true), 'warm');
        run(s, 5000, { oil: 75, coolant: 78, rpm: 900 });
        assert.strictEqual(showing(s), false, 'no flicker back');
    }],
    ['takeover: setting off, another page, no temperatures, coolant only', () => {
        const s = fresh();
        run(s, 2000, { oil: 20, coolant: 25, rpm: 800 });
        assert.strictEqual(showing(s, { enabled: false }), false);
        assert.strictEqual(W.reason(s.st, false), 'setting off');
        assert.strictEqual(showing(s, { page: 'thermal' }), false);
        const n = fresh();
        run(n, 2000, { oil: null, coolant: undefined, rpm: 800 });
        assert.strictEqual(showing(n), false); assert.strictEqual(W.reason(n.st, true), 'no temperature');
        const c = fresh();
        run(c, 2000, { oil: null, coolant: 40, rpm: 800 });
        assert.strictEqual(showing(c), true, 'coolant only, cold');
    }],
    ['takeover: oil warm but coolant cold is still cold', () => {
        const s = fresh();
        run(s, 2000, { oil: 85, coolant: 60, rpm: 800 });
        assert.strictEqual(showing(s), true);
    }],
];
