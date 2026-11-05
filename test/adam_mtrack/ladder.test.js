'use strict';
/* ladder.js (the Safety page's test pattern) with the real output.js and cluster-render client against the fake service,
 * steps shortened to 700 ms: each step draws on its own client (adam_mtrack-test) exactly what it says (layers, assets,
 * bytes, the dead-man only on step 1's blue bar), is removed after its time with the connection closed, and a watcher
 * that sends nothing but hello and status confirms the release; every step's upload stays under uploadBudgetBytes;
 * refusals (the cover on, not parked, another app on the shared scene, named) draw nothing; a moving car, STOP and a
 * replacing step remove it at once. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLadder } = require('../../apps/adam_mtrack/ladder');
const { createOutput } = require('../../apps/adam_mtrack/output');
const RD = require('../../apps/adam_mtrack/renderer');
const cfg = require('../../apps/adam_mtrack/config');
const G = require('../../apps/adam_mtrack/geom');
const { ClusterRender } = require('../../apps/adam_mtrack/cluster_render_client');
const { createFake } = require('./fake_cluster_render');

const ART = JSON.parse(fs.readFileSync(path.join(__dirname, '../../apps/adam_mtrack/art/art.json'), 'utf8'));
const C = Object.assign({}, cfg, { test: Object.assign({}, cfg.test, { stepMs: 700, statusAfterMs: 200 }), renderer: Object.assign({}, cfg.renderer, { verifyMs: 1500 }) });
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
async function until(fn, ms, what) {
    const end = Date.now() + (ms || 3000);
    while (Date.now() < end) { if (fn()) return; await wait(10); }
    throw new Error('timed out waiting for ' + what);
}
let seq = 0;

function rig() {
    const sock = path.join(os.tmpdir(), 'mt-lad-' + process.pid + '-' + (++seq) + '.sock'), msgs = [], lines = [];
    const fake = createFake(sock, (m) => msgs.push(m), null, { lingerMs: 150 });
    const log = { info: (m) => lines.push(m), warn: (m) => lines.push('WARN ' + m), error: (m) => lines.push('ERR ' + m) };
    const guard = (n, fn) => function () { try { return fn.apply(this, arguments); } catch (e) { lines.push('ERR ' + n + ': ' + e.stack); return undefined; } };
    let parked = true;
    const lad = createLadder({
        cfg: C, log, diag: () => {}, changed: () => {}, units: () => 'us',
        makeOutput: (opts) => createOutput(Object.assign({ ClusterRender, socketPath: sock, log, cfg: C, guard, art: ART, fault: (m) => lines.push('FAULT ' + m) }, opts)),
        verify: (why, done) => RD.verifyRelease({ ClusterRender, socketPath: sock, log, diag: () => {}, guard, cfg: C }, why, done),
        frame: () => ({ yr: G.yOfRpm(800, C.tach), quads: [], slats: { lit: 0, flashing: false }, badge: true, level: 1 }),
        drawBoxes: (out) => ['panelL', 'panelR', 'cornerL', 'cornerR'].forEach((n) => { const r = G.RECTS[n]; out.box(n, Buffer.alloc(r.w * r.h * 4, 200)); }),
    });
    const timer = setInterval(() => lad.tick(Date.now(), { parked }), 50);
    const app = (conn) => { const h = msgs.filter((m) => m.conn === conn && m.op === 'hello')[0]; return h ? h.app : ''; };
    const conns = (name) => msgs.filter((m) => m.ev === 'connect' && app(m.conn) === name).map((m) => m.conn);
    const of = (conn, pred) => msgs.filter((m) => m.conn === conn && pred(m));
    const closed = (conn) => msgs.some((m) => m.conn === conn && m.ev === 'close');
    return {
        lad, fake, msgs, lines, sock, app, conns, of, closed, setParked: (p) => { parked = p; },
        done: () => new Promise((res) => { clearInterval(timer); lad.stop('test end', true); setTimeout(() => fake.close(res), 50); }),
    };
}
/** Runs step n to its end; returns its connection's messages and when the first layer came and the connection closed. */
async function runStep(r, n) {
    const before = r.conns('adam_mtrack-test').length;
    assert.strictEqual(r.lad.start(n, { armed: false, parked: true }), '');
    await until(() => r.conns('adam_mtrack-test').length > before, 2000, 'step ' + n + ' connects');
    const conn = r.conns('adam_mtrack-test')[before];
    await until(() => r.of(conn, (m) => m.op === 'layer').length > 0, 3000, 'step ' + n + ' layers');
    await until(() => r.closed(conn), 3000, 'step ' + n + ' removed');
    const layers = r.of(conn, (m) => m.op === 'layer'), close = r.msgs.filter((m) => m.conn === conn && m.ev === 'close')[0];
    await until(() => { const s = r.lad.status(); return s && s.n === n && s.released !== null; }, 4000, 'step ' + n + ' release check');
    return { conn, layers, assets: r.of(conn, (m) => m.op === 'asset'), frames: r.of(conn, (m) => m.op === 'frame'), lasted: close.t - layers[0].t, status: r.lad.status() };
}

module.exports = [
    ['step 1: two bars on its own client, no asset; the blue one runs the dead-man, the amber holds u_alive 1; removed after its time; release confirmed by a watcher', async () => {
        const r = rig();
        try {
            const s = await runStep(r, 1);
            assert.deepStrictEqual(s.layers.map((l) => [l.kind, l.target, l.x, l.y, l.w, l.h, l.class]), [['effect', 'panel', 690, 236, 260, 44, 'overlay'], ['effect', 'panel', 970, 236, 260, 44, 'overlay']]);
            assert.strictEqual(s.assets.length, 0, 'no asset');
            const [amber, blue] = s.layers.map((l) => l.ref), alive = (ref) => r.of(s.conn, (m) => m.ref === ref && m.name === 'u_alive');
            assert.deepStrictEqual(alive(amber).map((m) => [m.op, m.v]), [['uniform', '1']], 'amber: u_alive 1, no animation');
            const ba = alive(blue);
            assert.ok(ba[0].op === 'uniform' && ba[0].v === '0' && ba.filter((m) => m.op === 'animate' && m.keys === C.safety.aliveKeys).length >= 2, 'blue: the cover\'s dead-man, restarted: ' + JSON.stringify(ba));
            assert.ok(s.lasted >= 650 && s.lasted < 1300, 'shown for ' + s.lasted + ' ms');
            assert.strictEqual(s.status.released, true, JSON.stringify(s.status));
            assert.ok(/^Released: panel idle/.test(s.status.lines[4]) && /^Step 1 BAR done: released$/.test(s.status.line), JSON.stringify(s.status));
            const watch = r.conns('adam_mtrack-watch');
            assert.ok(watch.length === 1 && r.of(watch[0], (m) => m.op).every((m) => m.op === 'hello' || m.op === 'status'), 'the watcher only says hello and asks for the status');
            assert.ok(r.lines.some((l) => /^release confirmed \(test step 1\): panel idle/.test(l)), r.lines.join('\n'));
            assert.ok(r.lines.some((l) => /^test: step 1 BAR: showing for 0\.7 s/.test(l)) && r.lines.some((l) => /^test: step 1 BAR: removed after 0\.7 s; panel shown/.test(l)), r.lines.join('\n'));
        } finally { await r.done(); }
    }],
    ['steps 2 to 5 draw what they say (layers, assets, bytes), each is removed and released; every upload stays under uploadBudgetBytes', async () => {
        const r = rig();
        try {
            const s2 = await runStep(r, 2);
            assert.deepStrictEqual(s2.layers.map((l) => [l.kind, l.x, l.y, l.w, l.h]), [['effect', 0, 0, 1920, 720]]);
            assert.strictEqual(s2.assets.length, 0);
            const s3 = await runStep(r, 3);
            assert.deepStrictEqual(s3.layers.map((l) => [l.kind, l.x, l.y, l.w, l.h]), [['image', 684, 296, 256, 128], ['effect', 980, 296, 256, 128]]);
            assert.deepStrictEqual(s3.assets.map((a) => [a.format, a.w, a.h]), [['rgba8', 256, 128]]);
            assert.ok(r.of(s3.conn, (m) => m.op === 'bind' && m.ref === s3.layers[1].ref && m.asset === s3.assets[0].ref).length === 1, 'the effect samples the asset');
            assert.deepStrictEqual(s3.frames.map((f) => f.bytes), [131072, 131072], 'the image and the asset, whole');
            const s4 = await runStep(r, 4);
            assert.deepStrictEqual(s4.layers.map((l) => [l.kind, l.x, l.y, l.w, l.h, l.exclusive, l.z]), [['effect', 0, 0, 1920, 720, 1, C.zBase]]);
            assert.deepStrictEqual(s4.assets.map((a) => [a.format, a.w, a.h]), [['r8', 1920, 720], ['r8', 180, 462], ['rgba8', 246, 474], ['rgba8', 246, 474]]);
            const s5 = await runStep(r, 5);
            assert.strictEqual(s5.layers.length, 8);
            assert.strictEqual(s5.assets.length, 10);
            [s2, s3, s4, s5].forEach((s, i) => {
                const bytes = s.frames.reduce((a, f) => a + f.bytes, 0);
                assert.ok(bytes <= C.uploadBudgetBytes, 'step ' + (i + 2) + ' uploaded ' + bytes);
                assert.ok(s.status.released === true, 'step ' + (i + 2) + ' released: ' + JSON.stringify(s.status.lines));
            });
            assert.strictEqual(s4.frames.reduce((a, f) => a + f.bytes, 0), 2398392, 'the tachs: lum, band, overR, overL');
            assert.ok(s5.frames.reduce((a, f) => a + f.bytes, 0) >= 4287608, 'the whole cover');
            [s4, s5].forEach((s) => assert.ok(r.of(s.conn, (m) => m.name === 'u_alive').every((m) => m.op === 'uniform' && m.v === '1'), 'no dead-man in steps 4 and 5'));
        } finally { await r.done(); }
    }],
    ['refusals draw nothing: the cover armed, not parked, another app on the shared scene (named from the status)', async () => {
        const r = rig();
        try {
            assert.strictEqual(r.lad.start(1, { armed: true, parked: true }), 'turn Cover the cluster off first');
            assert.strictEqual(r.lad.start(1, { armed: false, parked: false }), 'parked only (under 3 km/h or in P)');
            assert.ok(/^Step 1 BAR refused: parked only$/.test(r.lad.status().line), r.lad.status().line);
            await wait(200);
            assert.ok(!r.msgs.some((m) => m.ev === 'connect'), 'no connection for a refused step');
            const other = new ClusterRender('adam_shiftlights', r.sock);
            other.on('ready', () => other.effect({ target: 'hud', x: 0, y: 0, w: 10, h: 10, fs: 'void main(){}' }));
            other.connect();
            await until(() => r.fake.state('hud').state === 'shown', 2000, 'Shift Lights on the HUD');
            assert.strictEqual(r.lad.start(2, { armed: false, parked: true }), '');
            await until(() => r.lad.status() && r.lad.status().state === 'refused', 3000, 'refused for the HUD');
            const conn = r.conns('adam_mtrack-test')[0];
            await until(() => r.closed(conn), 1000, 'closed');
            assert.strictEqual(r.of(conn, (m) => m.op === 'layer').length, 0, 'no layer made');
            assert.ok(/another app is using the cluster \(adam_shiftlights on hud\)/.test(r.lad.status().lines[0]), JSON.stringify(r.lad.status()));
            assert.strictEqual(r.lad.status().released, null, 'nothing drawn: no release check');
            other.close();
        } finally { await r.done(); }
    }],
    ['a moving car stops a step at once; STOP stops it; a new step replaces a running one (its layers gone, no release check for it)', async () => {
        const r = rig();
        try {
            const C2 = r.conns.bind(null, 'adam_mtrack-test');
            r.lad.start(2, { armed: false, parked: true });
            await until(() => C2().length === 1 && r.of(C2()[0], (m) => m.op === 'layer').length === 1, 2000, 'step 2 shown');
            const t = Date.now();
            r.setParked(false);
            await until(() => r.closed(C2()[0]), 1000, 'stopped when moving');
            assert.ok(Date.now() - t < 400, 'stopped after ' + (Date.now() - t) + ' ms');
            assert.ok(/stopped: the car moved/.test(r.lad.status().lines[0]), JSON.stringify(r.lad.status()));
            r.setParked(true);
            r.lad.start(1, { armed: false, parked: true });
            await until(() => C2().length === 2 && r.of(C2()[1], (m) => m.op === 'layer').length === 2, 2000, 'step 1 shown');
            r.lad.stop('stop button');
            await until(() => r.closed(C2()[1]), 1000, 'STOP');
            r.lad.start(1, { armed: false, parked: true });
            await until(() => C2().length === 3 && r.of(C2()[2], (m) => m.op === 'layer').length === 2, 2000, 'step 1 again');
            r.lad.start(3, { armed: false, parked: true });
            await until(() => r.closed(C2()[2]), 1000, 'replaced');
            await until(() => C2().length === 4 && r.of(C2()[3], (m) => m.op === 'layer').length === 2, 2000, 'step 3 shown');
            assert.ok(r.lad.running() && r.lad.status().n === 3);
            assert.ok(!r.lines.some((l) => /release .*\(test step 1\)/.test(l) && /replaced/.test(l)), 'no release check of a replaced step');
        } finally { await r.done(); }
    }],
];
