'use strict';
/* output.js dead-man switch: u_alive is restarted every aliveResendMs while shown, and a backward wall-clock jump
 * (NTP/GPS on the head unit) must not stall it, or the renderer blanks the cover while its layers stay (KB-ANY-203). */
const assert = require('assert');
const zlib = require('zlib');
const { EventEmitter } = require('events');
const cfg = require('../../apps/adam_mtrack/config');
const { createOutput } = require('../../apps/adam_mtrack/output');

function rig() {
    const r = { restarts: 0 };
    let ref = 1;
    class CR extends EventEmitter {
        connect() {} asset() { return ref++; } pixels() { return true; } effect() { return ref++; } bind() {} uniform() {}
        animate() { return 1; } stop() {} drop() {} close() {}
        _send(m) { if (m.op === 'animate' && m.name === 'u_alive') r.restarts++; }
    }
    const items = ['lum', 'band', 'overR', 'overL', 'atlas', 'badge', 'cornerL', 'cornerR_us']
        .map((n) => ({ name: n, w: 1, h: 1, format: 'rgba8', data: zlib.deflateRawSync(Buffer.alloc(4)).toString('base64') }));
    r.out = createOutput({ ClusterRender: CR, log: { info() {}, warn() {}, error() {} }, cfg, guard: (n, f) => f, art: { items, atlas: { w: 1, h: 1 } } });
    r.out.arm('us');
    r.out.show({ yr: 700, quads: [], slats: { lit: 0, flashing: false }, badge: true, level: 1 });
    r.t = Date.now();
    return r;
}

module.exports = [
    ['dead-man: restarts after a backward clock jump', () => {
        const r = rig(), t = r.t, H = 3600e3;
        assert.strictEqual(r.out.tick(t + 300), true);
        const per = r.restarts;
        assert.ok(per > 0, 'one restart per layer');
        assert.strictEqual(r.out.tick(t + 400), false, 'inside the resend window');
        assert.strictEqual(r.out.tick(t + 600 - H), true, 'clock went back: restart at once');
        assert.strictEqual(r.restarts, 2 * per);
        assert.strictEqual(r.out.tick(t + 700 - H), false, 'cadence resumes from the new time');
        assert.strictEqual(r.out.tick(t + 900 - H), true);
        assert.strictEqual(r.out.status().shown, true);
    }],
    ['tick does nothing when not shown', () => {
        const r = rig();
        r.out.drop('x');
        const n = r.restarts;
        assert.strictEqual(r.out.tick(r.t + 10e3), false);
        assert.strictEqual(r.restarts, n);
    }],
];
