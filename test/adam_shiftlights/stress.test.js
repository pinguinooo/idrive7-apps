'use strict';
/* Noisy rpm against the real logic.step + logic.makeLead (config defaults): no flicker on a steady rpm near any
 * boundary, no light lost on a rising ramp, and (runTrace) a 50 Hz noisy feed with the software preview on that
 * never starves the loop. Pass bars from the planner's simulation (job 11041744 lead-sim.js). */
const assert = require('assert');
const L = require('../../apps/adam_shiftlights/logic');
const { runTrace } = require('./latency_trace');
const cfg = L.validateConfig(require('../../apps/adam_shiftlights/config')).cfg;

const th = L.thresholds(cfg, { start: 6000, shift: 6800 }, 95);
const st = cfg.clusterStyles.large, n = st.palette.length;

/** Feed gen(t) +- noise at hz for ms through lead + step: { trans, drops } (lit changes after the first, lit losses). */
function feed(gen, ms, hz, leadMs, noise, seed0) {
    let seed = seed0;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const lead = L.makeLead(cfg.rpm);
    let s = null, prev = -1, trans = -1, drops = 0;
    for (let t = 0; t < ms; t += 1000 / hz) {
        const rpm = Math.round((gen(t) + (rnd() * 2 - 1) * noise) * 4) / 4;     // the car's 0.25 rpm steps
        const p = lead(rpm, t, leadMs);
        s = L.step(s, p.rpm, th, n, cfg, t, st.reds, p.add);
        if (s.lit !== prev) { trans++; if (prev >= 0 && s.lit < prev) drops++; prev = s.lit; }
    }
    return { trans, drops };
}

module.exports = [
    ['(a) steady rpm 5990 to 6900 (+-25 noise, 10 s) at 10/20/50 Hz, lead 0/60/150: at most one lit change', () => {
        [10, 20, 50].forEach((hz) => [0, 60, 150].forEach((lead) => {
            for (let b = 5990; b <= 6900; b += 5) {
                const r = feed(() => b, 10000, hz, lead, 25, b);
                assert.ok(r.trans <= 1, b + ' rpm ' + hz + ' Hz lead ' + lead + ': ' + r.trans + ' changes');
            }
        }));
    }],
    ['(b) noisy ramps 0.5 to 12 rpm/ms: no light lost on the way up (lead 100/150 at 50 Hz: at most 8 in all)', () => {
        [10, 20, 50].forEach((hz) => [0, 60, 100, 150].forEach((lead) => {
            let drops = 0;
            [0.5, 0.75, 1, 1.5, 2, 3, 6, 12].forEach((rate) => {
                for (let k = 0; k < 20; k++) drops += feed((t) => 5500 + rate * t, Math.min(4000, 1500 / rate), hz, lead, 25, k + 1).drops;
            });
            // 50 Hz with a long lead: a few drops in 640 noisy ramps (measured 2026-11-04: lead 100 = 3, lead 150 = 7)
            if (lead >= 100 && hz === 50) assert.ok(drops <= 8, 'lead ' + lead + ' at 50 Hz: ' + drops);
            else assert.strictEqual(drops, 0, hz + ' Hz lead ' + lead);
        }));
    }],
    ['(c) 50 Hz noisy rpm with the software preview: every notification refreshed, loop lag bounded, no ERR, no trip, lead early', async () => {
        const r = await runTrace({ hz: 50, noise: 25, preview: 'software', pulls: 2, lead: 60 });
        assert.strictEqual(r.refreshes >= r.notifications, true, r.refreshes + ' refreshes for ' + r.notifications + ' notifications');
        // event-loop lag max: Mac Node 26 ~60 ms with the 10 fps preview (a 1600x520 png per frame); 0.3.0's 30 fps
        // preview measured in latency-before-after.md. Bar: 3 x the after value on claudius-vm Node 8 (see README)
        assert.ok(r.lag.max < 250, 'lag max ' + r.lag.max);
        assert.deepStrictEqual(r.errors, [], 'no ERR line (a caught error or the safety trip logs one)');
        assert.strictEqual(r.riseDrops, 0);
        assert.ok(r.B.p50 < 0, 'lead 60 lights early at 3000 rpm/s: B p50 ' + r.B.p50);
        assert.strictEqual(r.ust, r.changes, 'a u_st only when lit or flash changes');
    }],
];
