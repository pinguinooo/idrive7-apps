'use strict';
/* cooldown.js: hard use builds a cool-down, gentle running counts it down, clocks and inputs can't break it. */
const assert = require('assert');
const path = require('path');
const Cd = require(path.join(__dirname, '..', '..', 'apps', 'adam_vitals', 'cooldown.js'));

/** s seconds of input in 0.25 s steps on the steady clock */
function run(c, s, inp) {
    for (let i = 0; i < s * 4; i++) { c.m += 250; c.st = Cd.step(c.st, inp, 0.25, c.m); }
    return c.st;
}
const fresh = () => ({ st: Cd.init(), m: 1000 });
const HARD = { rpm: 5000, kw: 150, boost: 1.2, speed: 100 };
const GENTLE = { rpm: 1500, kw: 20, boost: -0.3, speed: 40 };
const IDLE = { rpm: 750, kw: 3, boost: -0.6, speed: 0 };

module.exports = [
    ['5 s hard asks for nothing (under HARD_START_S)', () => {
        const c = fresh(); run(c, 5, { rpm: 5000, kw: 30, speed: 80 });
        assert.strictEqual(c.st.needS, 0);
        assert.strictEqual(Cd.advice(c.st, GENTLE).state, 'none');
    }],
    ['20 s hard by rpm asks 90 s, 60 s asks 180 (capped)', () => {
        const a = fresh(); run(a, 20, { rpm: 5000, kw: 30, speed: 80 });
        assert.strictEqual(a.st.needS, 90);
        const b = fresh(); run(b, 60, { rpm: 5000, kw: 30, speed: 80 });
        assert.strictEqual(b.st.needS, 180);
    }],
    ['boost alone counts as hard over 0.8 bar', () => {
        const a = fresh(); run(a, 20, { rpm: 2000, kw: 30, boost: 1.0, speed: 50 });
        assert.strictEqual(a.st.needS, 90);
        const b = fresh(); run(b, 20, { rpm: 2000, kw: 30, boost: 0.7, speed: 50 });
        assert.strictEqual(b.st.needS, 0);
    }],
    ['90 s gentle after 20 s hard: done, then all clear 20 s on', () => {
        const c = fresh(); run(c, 20, HARD);
        run(c, 89, GENTLE);
        assert.strictEqual(Cd.advice(c.st, GENTLE).state, 'drive');
        run(c, 1, GENTLE);
        assert.strictEqual(Cd.advice(c.st, GENTLE).state, 'done');
        assert.strictEqual(Cd.message(Cd.advice(c.st, IDLE)), 'COOLED - OK TO SHUT OFF');
        run(c, 20.25, GENTLE);
        assert.deepStrictEqual(c.st, Cd.init());
        assert.strictEqual(Cd.message(Cd.advice(c.st, IDLE)), 'OK TO SHUT OFF');
        assert.strictEqual(Cd.message(Cd.advice(c.st, GENTLE)), 'NO COOL-DOWN NEEDED');
    }],
    ['hard driving during the countdown starts it again', () => {
        const c = fresh(); run(c, 20, HARD); run(c, 50, GENTLE);
        assert.strictEqual(c.st.cool, 50);
        run(c, 1, HARD);
        assert.strictEqual(c.st.cool, 0);
        assert(c.st.needS >= 90);
    }],
    ['advice: paused over gentle, idle stopped, drive moving, gentle with no speed, off with time left', () => {
        const c = fresh(); run(c, 20, HARD);
        assert.strictEqual(Cd.advice(c.st, { rpm: 3000, kw: 20, speed: 50 }).state, 'paused');
        assert.strictEqual(Cd.advice(c.st, { rpm: 1500, kw: 60, speed: 50 }).state, 'paused');
        assert.strictEqual(Cd.advice(c.st, IDLE).state, 'idle');
        assert.strictEqual(Cd.message(Cd.advice(c.st, IDLE)), 'IDLE ~90 s BEFORE SWITCHING OFF');
        assert.strictEqual(Cd.advice(c.st, { rpm: 1500, kw: 20, speed: 30 }).state, 'drive');
        assert.strictEqual(Cd.message(Cd.advice(c.st, GENTLE)), 'KEEP DRIVING GENTLY ~90 s');
        assert.strictEqual(Cd.advice(c.st, { rpm: 1500, kw: 20 }).state, 'gentle');
        assert.strictEqual(Cd.advice(c.st, { rpm: 0, kw: 0, speed: 0 }).state, 'off');
        assert.strictEqual(Cd.advice(c.st, {}).state, 'off');
    }],
    ['engine off does not count as cooling; 15 min off clears it', () => {
        const c = fresh(); run(c, 20, HARD);
        run(c, 60, { rpm: 0, kw: 0, speed: 0 });
        assert.strictEqual(c.st.cool, 0); assert.strictEqual(c.st.needS, 90);
        run(c, 839, { rpm: 0, kw: 0, speed: 0 });
        assert.strictEqual(c.st.needS, 90, 'just under 15 min off');
        run(c, 1, { rpm: 0, kw: 0, speed: 0 });
        assert.strictEqual(c.st.needS, 0); assert.strictEqual(Cd.advice(c.st, IDLE).state, 'none');
    }],
    ['a negative, huge or missing dt counts as at most 0.25 s, never backwards', () => {
        const c = fresh(); run(c, 20, HARD); run(c, 10, GENTLE);
        const before = c.st.cool;
        const a = Cd.step(c.st, GENTLE, -5, c.m);
        assert.strictEqual(a.cool, before);
        const b = Cd.step(c.st, GENTLE, 3 * 3600, c.m);                // the clock jumped ahead
        assert.strictEqual(b.cool, before + 0.25);
        assert.strictEqual(Cd.step(c.st, GENTLE, NaN, c.m).cool, before);
        assert.strictEqual(Cd.step(c.st, GENTLE, undefined, c.m).cool, before);
    }],
    ['no rpm changes nothing; the input state is never mutated', () => {
        const c = fresh(); run(c, 20, HARD);
        const snap = JSON.stringify(c.st);
        const n = Cd.step(c.st, { rpm: null, kw: 200 }, 0.25, c.m + 250);
        assert.strictEqual(JSON.stringify(n), snap);
        Cd.step(c.st, HARD, 0.25, c.m + 250); Cd.step(c.st, GENTLE, 0.25, c.m + 250); Cd.step(c.st, { rpm: 0 }, 0.25, c.m + 250);
        assert.strictEqual(JSON.stringify(c.st), snap, 'input not mutated');
        assert.notStrictEqual(n, c.st);
    }],
    ['"cooled" holds 20 s on the steady clock', () => {
        const c = fresh(); run(c, 20, HARD); run(c, 90, GENTLE);
        assert.strictEqual(Cd.advice(c.st, GENTLE).state, 'done');
        run(c, 19.75, GENTLE);
        assert.strictEqual(Cd.advice(c.st, GENTLE).state, 'done', 'still within 20 s');
    }],
    ['"cooled" clears after 20 s with the rpm signal gone too (KB-ANY-203: it stayed for good)', () => {
        const c = fresh(); run(c, 20, HARD); run(c, 90, GENTLE);
        assert.strictEqual(Cd.advice(c.st, GENTLE).state, 'done');
        run(c, 19, { rpm: null });
        assert.strictEqual(Cd.advice(c.st, IDLE).state, 'done', 'within its 20 s');
        run(c, 1.5, { rpm: undefined });
        assert.deepStrictEqual(c.st, Cd.init(), 'cleared without rpm');
        assert.strictEqual(Cd.message(Cd.advice(c.st, { speed: 0 })), 'OK TO SHUT OFF');
    }],
    ['moderate load (neither hard nor gentle) pauses the countdown: cool, need and hard time unchanged', () => {
        const c = fresh(); run(c, 20, HARD); run(c, 10, GENTLE);
        const before = Object.assign({}, c.st);            // cool 10, needS 90
        run(c, 10, { rpm: 3200, kw: 60, boost: 0.3, speed: 60 });
        assert.strictEqual(c.st.cool, before.cool);
        assert.strictEqual(c.st.needS, before.needS);
        assert.strictEqual(c.st.hardS, before.hardS);
        run(c, 5, { rpm: 2800, kw: 20, speed: 40 });       // GENTLE_RPM itself is not gentle (strict <)
        run(c, 5, { rpm: 1500, kw: 40, speed: 40 });       // nor is GENTLE_KW
        assert.strictEqual(c.st.cool, before.cool);
        assert.strictEqual(Cd.advice(c.st, { rpm: 3200, kw: 60, speed: 60 }).state, 'paused');
    }],
];
