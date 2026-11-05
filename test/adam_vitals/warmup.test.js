'use strict';
/* warmup.js: rev limit, warm-up estimate, and the takeover state machine (show, Hide, new drive, warm), with the
 * transmission, the settled rule and both clocks. Marks come from app.json's defaults (220 F oil and coolant, 160 F
 * transmission), never copied numbers. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..', '..', 'apps', 'adam_vitals');
const W = require(path.join(APP, 'warmup.js'));
const U = require(path.join(APP, 'units.js'));
const SPEC = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));
const def = (k) => SPEC.settings.filter((s) => s.key === k)[0].default;

const T = { warmOil: def('warmOil'), warmCoolant: def('warmCoolant'), warmTrans: def('warmTrans') };
const F = U.fToC;
/** run the takeover over ms in 1 s steps from s (both clocks advance unless o.asleep: then only the wall clock) */
function run(s, ms, inp, o) {
    let st = s.st;
    for (let t = 0; t < ms; t += 1000) {
        if (!(o && o.asleep)) s.now += 1000;
        s.wall += 1000;
        st = W.step(st, Object.assign({ now: s.now, wall: s.wall }, T, inp));
    }
    s.st = st;
    return st;
}
const fresh = () => ({ st: W.init(), now: 1000, wall: 1.7e12 });
const showing = (s, o) => W.show(s.st, Object.assign({ enabled: true, page: 'main' }, o));
const WARM = { oil: F(225), coolant: F(222), rpm: 2000 };

module.exports = [
    ['the marks: oil and coolant warm at 220 F, the transmission at 160 F (app.json defaults)', () => {
        assert.strictEqual(Math.round(U.cToF(T.warmOil)), 220);
        assert.strictEqual(Math.round(U.cToF(T.warmCoolant)), 220);
        assert.strictEqual(Math.round(U.cToF(T.warmTrans)), 160);
    }],
    ['the gauge marks in F (README "Temperature marks"): amber from 265 / 250 / 230, red from 275 (oil warning) / 260 / 250, warming 36 F under ready', () => {
        const f = (c) => Math.round(U.cToF(c));
        assert.deepStrictEqual([f(W.HOT.oil), f(W.HOT.coolant), f(W.HOT.trans)], [265, 250, 230]);
        assert.deepStrictEqual([f(W.CRIT.coolant), f(W.CRIT.trans)], [260, 250]);
        assert.strictEqual(f(def('oilWarn')), 275);
        assert.strictEqual(Math.round(U.dCToF(W.WARMING_C)), 36);
        assert.strictEqual(Math.round(U.dCToF(W.SETTLE_C)), 27);
        // every hot mark sits over the green band and its ready mark, every crit over its hot
        assert(W.HOT.oil > T.warmOil && W.HOT.coolant > T.warmCoolant && W.HOT.trans > T.warmTrans);
        assert(def('oilWarn') > W.HOT.oil && W.CRIT.coolant > W.HOT.coolant && W.CRIT.trans > W.HOT.trans);
    }],
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
    ['limit with the 220 F mark: the redline only from 220 F oil (0.1.0: from 176 F)', () => {
        assert.strictEqual(W.limit(F(176), T.warmOil, 7000, 3500), 5900, '176 F oil, 0.1.0 gave 7000 here');
        assert.strictEqual(W.limit(F(200), T.warmOil, 7000, 3500), 6500, '200 F');
        assert.strictEqual(W.limit(F(220), T.warmOil, 7000, 3500), 7000, '220 F');
        assert.strictEqual(W.limit(F(86), T.warmOil, 7000, 3500), 3500, '86 F (30 deg C)');
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
        const flat = []; for (let i = 0; i <= 36; i++) flat.push([i * 5000, 40, 50, 900, 0, 0, 30]);
        assert.strictEqual(W.eta('oil', 40, 80, { rpm: 900, speed: 0 }, flat).state, 'stalled');
        // 3 min measured at 2 deg C / min: that rate, no longer an estimate
        const up = []; for (let i = 0; i <= 36; i++) up.push([i * 5000, 34 + i * 5000 / 60000 * 2, 50, 900, 0, 0, 30]);
        const m = W.measured(up, 1);
        assert(Math.abs(m.rate - 2) < 1e-6, 'measured rate ' + m.rate);
        const e2 = W.eta('oil', 40, 80, { rpm: 900, speed: 0 }, up);
        assert.strictEqual(e2.est, false); assert(Math.abs(e2.min - 20) < 1e-6, 'min ' + e2.min);
    }],
    ['eta, transmission: its own column (6) and typical rates; ready at its mark in F', () => {
        assert.strictEqual(W.COL.trans, 6);
        const e = W.eta('trans', F(100), T.warmTrans, { rpm: 900, speed: 0 }, []);
        assert(Math.abs(e.min - (T.warmTrans - F(100)) / W.TYPICAL.trans.idle) < 1e-9, 'idle rate ' + e.min);
        assert.strictEqual(W.eta('trans', F(159), T.warmTrans, { rpm: 900 }, []).state, 'warming', '159 F');
        assert.strictEqual(W.eta('trans', F(161), T.warmTrans, { rpm: 900 }, []).state, 'ready', '161 F');
        // the oil column flat, the trans column rising 3 deg C / min: trans is measured from its own column
        const rows = []; for (let i = 0; i <= 36; i++) rows.push([i * 5000, 90, 95, 1500, 50, 0, 40 + i * 5000 / 60000 * 3]);
        assert(Math.abs(W.measured(rows, W.COL.trans).rate - 3) < 1e-6);
        assert.strictEqual(W.eta('trans', 49, T.warmTrans, { rpm: 1500, speed: 50 }, rows).est, false);
    }],
    ['oil and coolant in F: 219 F is not ready, 221 F is', () => {
        ['oil', 'coolant'].forEach((k) => {
            const mark = k === 'oil' ? T.warmOil : T.warmCoolant;
            assert.strictEqual(W.eta(k, F(219), mark, { rpm: 900 }, []).state, 'warming', k + ' 219 F');
            assert.strictEqual(W.eta(k, F(221), mark, { rpm: 900 }, []).state, 'ready', k + ' 221 F');
        });
        // the car sends whole deg C: 104 (219.2 F) cold, 105 (221 F) warm
        const s = fresh(); run(s, 2000, { oil: 104, coolant: 105, rpm: 800 });
        assert.strictEqual(showing(s), true, '104 deg C oil');
        run(s, 2000, { oil: 105, coolant: 105, rpm: 800 });
        assert.strictEqual(showing(s), false, '105 deg C both');
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
    ['takeover, head unit asleep (KB-ANY-203): 10 min off on the wall clock while the steady clock stood still is a new drive', () => {
        const s = fresh();
        run(s, 2000, { oil: 20, coolant: 25, rpm: 800 });
        s.st = W.dismiss(s.st);
        run(s, 2000, { oil: 20, coolant: 25, rpm: 0 });               // engine off, awake
        run(s, 600000, { oil: 20, coolant: 25, rpm: null }, { asleep: true });   // asleep: only the wall clock moves
        run(s, 2000, { oil: 20, coolant: 25, rpm: 800 });
        assert.strictEqual(showing(s), true, 'new drive after the sleep');
        // the control: the same stop asleep for 5 min is the same drive
        const c = fresh();
        run(c, 2000, { oil: 20, coolant: 25, rpm: 800 });
        c.st = W.dismiss(c.st);
        run(c, 2000, { oil: 20, coolant: 25, rpm: 0 });
        run(c, 300000, { oil: 20, coolant: 25, rpm: null }, { asleep: true });
        run(c, 2000, { oil: 20, coolant: 25, rpm: 800 });
        assert.strictEqual(showing(c), false, '5 min asleep: same drive');
    }],
    ['takeover, wall clock set back an hour during a stop (KB-ANY-204): no new drive, no throw; without wall it uses the steady clock', () => {
        const s = fresh();
        run(s, 2000, { oil: 20, coolant: 25, rpm: 800 });
        s.st = W.dismiss(s.st);
        run(s, 3000, { oil: 20, coolant: 25, rpm: 0 });
        s.wall -= 3600000;
        run(s, 3000, { oil: 20, coolant: 25, rpm: 0 });
        run(s, 2000, { oil: 20, coolant: 25, rpm: 800 });
        assert.strictEqual(showing(s), false, 'clock set back: same drive');
        // no wall clock at all (an older caller): the steady clock alone still makes a new drive
        let st = W.init();
        st = W.step(st, Object.assign({ now: 0, oil: 20, coolant: 25, rpm: 800 }, T));
        st = W.dismiss(st);
        st = W.step(st, Object.assign({ now: 1000, oil: 20, coolant: 25, rpm: 0 }, T));
        st = W.step(st, Object.assign({ now: 1000 + W.NEW_DRIVE_MS, oil: 20, coolant: 25, rpm: 800 }, T));
        assert.strictEqual(W.show(st, { enabled: true, page: 'main' }), true);
    }],
    ['takeover: warm hides it, a dip under the target the same drive stays hidden', () => {
        const s = fresh();
        run(s, 2000, { oil: 40, coolant: 50, rpm: 800 });
        assert.strictEqual(showing(s), true);
        run(s, 2000, WARM);
        assert.strictEqual(showing(s), false); assert.strictEqual(W.reason(s.st, true), 'warm');
        run(s, 5000, { oil: F(200), coolant: F(205), rpm: 900 });
        assert.strictEqual(showing(s), false, 'no flicker back');
    }],
    ['takeover: setting off, another page, no temperatures, coolant only', () => {
        const s = fresh();
        run(s, 2000, { oil: 20, coolant: 25, rpm: 800 });
        assert.strictEqual(showing(s, { enabled: false }), false);
        assert.strictEqual(W.reason(s.st, false), 'setting off');
        assert.strictEqual(showing(s, { page: 'thermal' }), false);
        const n = fresh();
        run(n, 2000, { oil: null, coolant: undefined, trans: null, rpm: 800 });
        assert.strictEqual(showing(n), false); assert.strictEqual(W.reason(n.st, true), 'no temperature');
        const c = fresh();
        run(c, 2000, { oil: null, coolant: 40, rpm: 800 });
        assert.strictEqual(showing(c), true, 'coolant only, cold');
    }],
    ['takeover: oil warm but coolant cold is still cold', () => {
        const s = fresh();
        run(s, 2000, { oil: F(225), coolant: F(180), rpm: 800 });
        assert.strictEqual(showing(s), true);
    }],
    ['takeover with the transmission: oil and coolant warm but trans cold stays shown; trans warm ends it', () => {
        const s = fresh();
        run(s, 2000, Object.assign({ trans: F(120) }, WARM));
        assert.strictEqual(showing(s), true, 'trans 120 F');
        run(s, 2000, Object.assign({ trans: F(159) }, WARM));
        assert.strictEqual(showing(s), true, 'trans 159 F');
        run(s, 2000, Object.assign({ trans: F(161) }, WARM));
        assert.strictEqual(showing(s), false, 'trans 161 F');
        assert.strictEqual(W.reason(s.st, true), 'warm');
    }],
    ['takeover without the transmission: null (no reading, or left out by its setting) neither blocks nor counts', () => {
        const s = fresh();
        run(s, 2000, Object.assign({ trans: null }, WARM));
        assert.strictEqual(showing(s), false, 'no trans reading: warm by oil and coolant');
        const t = fresh();
        run(t, 2000, { oil: null, coolant: null, trans: F(100), rpm: 800 });
        assert.strictEqual(showing(t), true, 'trans the only reading, cold');
        run(t, 2000, { oil: null, coolant: null, trans: F(165), rpm: 800 });
        assert.strictEqual(showing(t), false, 'trans the only reading, warm');
        // a trans reading that drops out mid warm-up: oil and coolant decide
        const d = fresh();
        run(d, 2000, Object.assign({ trans: F(120) }, WARM));
        assert.strictEqual(showing(d), true);
        run(d, 2000, Object.assign({ trans: undefined }, WARM));
        assert.strictEqual(showing(d), false);
    }],
    ['settled: coolant or trans stalled within SETTLE_C under the mark counts as warm; further under, or oil, does not', () => {
        assert.strictEqual(W.SETTLE_C, 15);
        const c = fresh();       // coolant held at 205 F (96 deg C, 8 under) by the heat management, oil warm
        run(c, 2000, { oil: F(225), coolant: F(205), rpm: 2500 });
        assert.strictEqual(showing(c), true, 'not settled yet');
        run(c, 2000, { oil: F(225), coolant: F(205), rpm: 2500, settled: { coolant: true } });
        assert.strictEqual(showing(c), false, 'coolant settled at 205 F');
        const far = fresh();     // settled at 185 F: 19 deg C under, outside SETTLE_C
        run(far, 2000, { oil: F(225), coolant: F(185), rpm: 2500, settled: { coolant: true } });
        assert.strictEqual(showing(far), true, 'settled too far under');
        const oil = fresh();     // oil never counts as settled (it sets the rev limit)
        run(oil, 2000, { oil: F(210), coolant: F(222), rpm: 900, settled: { oil: true, coolant: true } });
        assert.strictEqual(showing(oil), true, 'oil stalled at 210 F');
        const tr = fresh();      // trans held at 150 F
        run(tr, 2000, Object.assign({ trans: F(150), settled: { trans: true } }, WARM));
        assert.strictEqual(showing(tr), false, 'trans settled at 150 F');
        const no = fresh();      // settled must be exactly true
        run(no, 2000, Object.assign({ trans: F(150), settled: { trans: 'yes' } }, WARM));
        assert.strictEqual(showing(no), true);
    }],
];
