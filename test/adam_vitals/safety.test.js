'use strict';
/* safety.js (Engine Vitals copy): guard, the 5-errors-in-10-s trip, kill file. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSafety } = require('../../apps/adam_vitals/safety');
// mirrors the inline safety config in apps/adam_vitals/main.js
const cfg = { safety: { errorLimit: 5, errorWindowMs: 10000, killFile: 'DISABLE' } };

function make() {
    const lines = [];
    let t = 0;
    const s = createSafety({ cfg, log: { error: (m) => lines.push(m), info: () => {}, warn: () => {} }, now: () => t });
    return { s, lines, at: (ms) => { t = ms; } };
}
const boom = () => { throw new Error('boom'); };

module.exports = [
    ['guard swallows a throw and returns undefined; passes values and this through', () => {
        const { s, lines } = make();
        assert.strictEqual(s.guard('x', boom)(), undefined);
        assert.strictEqual(lines.length, 1);
        assert.strictEqual(s.guard('y', (a, b) => a + b)(2, 3), 5);
        const o = { v: 7, f: s.guard('z', function () { return this.v; }) };
        assert.strictEqual(o.f(), 7);
    }],
    ['guard catches a rejected promise', () => {
        const { s, lines } = make();
        return s.guard('async', () => Promise.reject(new Error('later')))().then((v) => {
            assert.strictEqual(v, undefined);
            assert.ok(/error in async/.test(lines[0]));
        });
    }],
    ['4 errors in 10 s do not trip, 5 do; onTrip runs once; reset clears the trip and the error list', () => {
        const { s, at, lines } = make();
        let trips = 0;
        s.onTrip(() => { trips++; });
        s.onTrip(boom);                     // a throwing trip handler is contained
        const g = s.guard('x', boom);
        [0, 2000, 4000, 6000].forEach((t) => { at(t); g(); });
        assert.strictEqual(s.tripped(), false);
        at(9000); g();
        assert.strictEqual(s.tripped(), true);
        assert.strictEqual(trips, 1);
        at(9500); g(); g();
        assert.strictEqual(trips, 1);
        assert.strictEqual(lines.filter((l) => /^STOPPED/.test(l)).length, 1);
        s.reset();
        assert.strictEqual(s.tripped(), false);
        at(9600); g();                      // reset cleared the error list: 1 error, no trip
        assert.strictEqual(s.tripped(), false);
        [9700, 9800, 9900, 10000].forEach((t) => { at(t); g(); });
        assert.strictEqual(s.tripped(), true, '5 since the reset trip again');
        assert.strictEqual(trips, 2);
    }],
    ['5 errors spread over 11 s do not trip', () => {
        const { s, at } = make();
        const g = s.guard('x', boom);
        [0, 2750, 5500, 8250, 11000].forEach((t) => { at(t); g(); });
        assert.strictEqual(s.tripped(), false);
    }],
    ['log: at most one line per name per 10 s', () => {
        const { s, at, lines } = make();
        const g = s.guard('x', boom);
        at(0); g(); at(5000); g(); at(10001); g();
        assert.strictEqual(lines.filter((l) => /error in x/.test(l)).length, 2);
    }],
    ['a log that throws is contained', () => {
        const s = createSafety({ cfg, log: { error: boom }, now: () => 0 });
        assert.strictEqual(s.guard('x', boom)(), undefined);
    }],
    ['pollKill: true / false on a temp dir, true when the check itself fails', () => {
        const { s } = make();
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-kill-'));
        const p = s.killFile(dir);
        assert.strictEqual(path.basename(p), 'DISABLE');
        assert.strictEqual(s.pollKill(fs, p), false);
        fs.writeFileSync(p, '');
        assert.strictEqual(s.pollKill(fs, p), true);
        fs.unlinkSync(p);
        fs.rmdirSync(dir);
        assert.strictEqual(s.pollKill({ existsSync: boom }, p), true);
    }],
];
