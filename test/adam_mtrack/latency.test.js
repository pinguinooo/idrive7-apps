'use strict';
/* The rpm path end to end (latency_trace.js: the real main.js and kit car.js, the fake cluster-render): at 10 Hz the
 * cover sends u_fill for the rpm within a few ms of each sample (A, our own delay), with no app error. Generous
 * margins: the VM's timers flake. */
const assert = require('assert');
const { runTrace } = require('./latency_trace');

module.exports = [
    ['latency: at 10 Hz every rpm reaches u_fill quickly (A p95 under 10 ms), the bar moves, no errors', async () => {
        const r = await runTrace({ hz: 10, pulls: 1 });
        assert.ok(r.fills > 0 && r.A.n > 0, 'u_fill count ' + r.fills);
        assert.ok(r.A.p95 < 10, 'A p95 ' + r.A.p95 + ' ms');
        assert.ok(r.B.n > 0, 'rising samples');
        assert.deepStrictEqual(r.errors, []);
    }],
];
