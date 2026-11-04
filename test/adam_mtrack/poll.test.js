'use strict';
/* poll.js (apps/adam_shiftlights/rpmpoll.js with the field as a parameter; the Shift Lights test pointed at it, for the
 * speed): one getter in flight, none while notifications are fast, backoff on every kind of failure, nothing thrown,
 * idle when off. */
const assert = require('assert');
const { createPoll, pct } = require('../../apps/adam_mtrack/poll');
// the Shift Lights timings the test's numbers were written for (poll.js itself has no timing of its own)
const cfg = { rpm: require('../../apps/adam_shiftlights/config').rpm };
const FIELD = 'statusCarSpeed2';

/** A fake world: clock, timers (run by advance), immediates, a proxy whose getValue answers via `answer`. */
function world(opts) {
    const o = opts || {};
    let t = 0, timers = [], imms = [];
    const calls = [], warns = [], got = [];
    let inFlight = 0, maxInFlight = 0;
    const w = {
        now: () => t, calls, warns, got, enabled: true,
        answer: () => ({ speedVehicleCentreOfGravity: 3200 }),
        delay: o.delay === undefined ? 3 : o.delay,
        maxInFlight: () => maxInFlight,
    };
    const proxy = {
        getValue(field, timeout) {
            calls.push({ t, field, timeout });
            inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
            if (o.throws) { inFlight--; throw new Error('sync'); }
            return new Promise((res, rej) => {
                timers.push({ at: t + w.delay, fn: () => { inFlight--; const r = w.answer(); if (r instanceof Error) rej(r); else res(r); } });
            });
        },
    };
    w.poll = createPoll({
        field: FIELD, cfg: cfg.rpm, log: { warn: (m) => warns.push(m) }, enabled: () => w.enabled, now: w.now,
        setTimeout: (fn, ms) => { const x = { at: t + ms, fn }; timers.push(x); return x; },
        clearTimeout: (x) => { timers = timers.filter((y) => y !== x); },
        setImmediate: (fn) => imms.push(fn),
    });
    w.res = { available: true, proxy };
    w.handler = (v) => { if (o.handlerThrows) throw new Error('boom'); got.push(t); };
    w.poll.attach(w.res, w.handler);
    w.advance = async (ms) => {
        const end = t + ms;
        for (;;) {
            while (imms.length) imms.shift()();
            await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
            if (imms.length) continue;
            timers.sort((a, b) => a.at - b.at);
            const x = timers[0];
            if (!x || x.at > end) break;
            timers.shift();
            t = Math.max(t, x.at);
            x.fn();
        }
        t = end;
    };
    w.pending = () => timers.length;
    // wall clock jumps back (NTP/GPS); real timers are monotonic, so pending ones keep their delay
    w.back = (ms) => { t -= ms; timers.forEach((x) => { x.at -= ms; }); };
    return w;
}
const gaps = (list) => list.slice(1).map((x, i) => x - list[i]);

module.exports = [
    ['polls about every pollMs with no notifications, one getter in flight even with a 500 ms getter', async () => {
        const w = world();
        w.poll.start();
        await w.advance(1000);
        assert.ok(w.calls.length >= 20 && w.calls.length <= 26, String(w.calls.length));
        gaps(w.calls.map((c) => c.t)).forEach((g) => assert.ok(g >= cfg.rpm.pollMs, String(g)));
        assert.deepStrictEqual([w.calls[0].field, w.calls[0].timeout], [FIELD, cfg.rpm.pollTimeoutMs]);
        const slow = world({ delay: 500 });
        slow.poll.start();
        await slow.advance(3000);
        assert.strictEqual(slow.maxInFlight(), 1);
        assert.ok(slow.calls.length >= 5 && slow.calls.length <= 6, String(slow.calls.length));
        await slow.advance(100);                // a getter is out now
        slow.poll.stop(); slow.poll.start();    // a restart meanwhile does not send a second
        await slow.advance(1000);
        assert.strictEqual(slow.maxInFlight(), 1);
    }],
    ['no getter call while notifications come faster than pollMs; polling resumes when they stop', async () => {
        const w = world();
        const note = w.poll.wrap(() => {});
        w.poll.start();
        for (let i = 0; i < 50; i++) { note({}); await w.advance(20); }
        assert.strictEqual(w.calls.length, 0);
        await w.advance(500);
        assert.ok(w.calls.length >= 10, String(w.calls.length));
        const st = w.poll.stats();
        assert.ok(Math.abs(st.notified - 50 / 1.5) < 1, JSON.stringify(st));
        assert.deepStrictEqual([st.gapP50, st.gapP90], [20, 20]);
        assert.ok(st.polled > 5 && st.rttP50 === 3 && st.rttMax === 3 && st.fails === 0, JSON.stringify(st));
    }],
    ['backoff 40, 80, 160 ... 2000 on rejections, timeouts and sync throws; back to pollMs after one answer', async () => {
        const w = world();
        w.answer = () => new Error('timeout');
        w.poll.start();
        await w.advance(10000);
        const g = gaps(w.calls.map((c) => c.t)).map((x) => x - w.delay);
        assert.deepStrictEqual(g.slice(0, 7), [80, 160, 320, 640, 1280, 2000, 2000]);
        assert.strictEqual(w.warns.length, 1, 'one warning per 30 s');
        w.answer = () => ({ speedVehicleCentreOfGravity: 3200 });
        await w.advance(2100);
        const n = w.calls.length;
        await w.advance(400);
        assert.ok(w.calls.length - n >= 8, 'back to pollMs: ' + (w.calls.length - n));
        const th = world({ throws: true });
        th.poll.start();
        await th.advance(1000);
        assert.deepStrictEqual(gaps(th.calls.map((c) => c.t)).slice(0, 3), [80, 160, 320]);
    }],
    ['a non-object value or a throwing handler counts as a failure and never throws', async () => {
        const w = world();
        w.answer = () => 7;
        w.poll.start();
        await w.advance(500);
        assert.ok(w.poll.stats().fails >= 2);
        const h = world({ handlerThrows: true });
        h.poll.start();
        await h.advance(500);
        const st = h.poll.stats();
        assert.ok(st.fails >= 2 && st.polled === 0, JSON.stringify(st));
        assert.ok(/handler: Error: boom/.test(h.warns[0]), h.warns[0]);
    }],
    ['idle while disabled, unavailable or not attached; stop() clears the timer', async () => {
        const w = world();
        w.enabled = false;
        w.poll.start();
        await w.advance(3000);
        assert.strictEqual(w.calls.length, 0);
        w.enabled = true;
        w.res.available = false;
        await w.advance(3000);
        assert.strictEqual(w.calls.length, 0);
        w.res.available = true;
        await w.advance(1100);
        assert.ok(w.calls.length > 0);
        w.poll.stop();
        assert.strictEqual(w.pending(), 0);
        const n = w.calls.length;
        await w.advance(1000);
        assert.strictEqual(w.calls.length, n);
        const u = world();
        u.poll.attach(null, null);
        u.poll.start();
        await u.advance(2000);
        assert.strictEqual(u.calls.length, 0);
        const thrower = world();
        thrower.poll = createPoll({ field: FIELD, cfg: cfg.rpm, log: { warn() {} }, enabled: () => { throw new Error('x'); } });
        thrower.poll.start();       // real timers: a throwing enabled() is "not ready"
        thrower.poll.stop();
    }],
    ['a backward wall-clock jump does not stall the poll (negative age polls at once)', async () => {
        const w = world();
        const note = w.poll.wrap(() => {});
        w.poll.start();
        note({});                       // lastRpmAt = 0
        await w.advance(5);
        assert.strictEqual(w.calls.length, 0);
        w.back(3600e3);
        await w.advance(2 * cfg.rpm.pollMs);
        assert.ok(w.calls.length > 0, 'poll kept running: ' + w.calls.length);
    }],
    ['pct: nearest rank on a known series', () => {
        const s = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5];
        assert.deepStrictEqual([pct(s, 0.5), pct(s, 0.9), pct(s, 1), pct([], 0.5)], [5, 9, 10, null]);
    }],
];
