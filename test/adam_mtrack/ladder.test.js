'use strict';
/* ladder.js (the Safety page's test pattern) with the real output.js and cluster-render client against the fake service,
 * steps shortened to 700 ms: each step draws on its own client (adam_mtrack-test) exactly what it says (layers, assets,
 * bytes; KNOWN, TACHS and COVER built stage by stage, made hidden, confirmed and written before they show, their
 * dead-man held at 1), is removed after its time with the connection closed, and a watcher that sends nothing but
 * hello and status confirms the release; every step stays under the memory budget; a build the renderer refuses is
 * stopped at its stage and says why; refusals (the cover on, not parked, another app on the shared scene, named)
 * draw nothing; a moving car, STOP and a replacing step remove it at once. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLadder } = require('../../apps/adam_mtrack/ladder');
const { createOutput } = require('../../apps/adam_mtrack/output');
const RD = require('../../apps/adam_mtrack/renderer');
const ST = require('../../apps/adam_mtrack/stages');
const { Canvas } = require('../../kit/runtime/canvas');
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
        cfg: C, log, diag: () => {}, changed: () => {}, units: () => 'us', art: ART, knownCard: () => ST.knownCard(Canvas, '0.1.3'),
        makeOutput: (opts) => createOutput(Object.assign({ ClusterRender, socketPath: sock, log, cfg: C, guard, art: ART, fault: (m) => lines.push('FAULT ' + m) }, opts)),
        verify: (why, done) => RD.verifyRelease({ ClusterRender, socketPath: sock, log, diag: () => {}, guard, cfg: C }, why, done),
        frame: () => ({ yr: G.yOfRpm(800, C.tach), quads: [], slats: { lit: 0, flashing: false }, level: 1, mph: 0, rpm: 800 }),
        drawBoxes: (out) => ['panelL', 'panelR', 'cornerL', 'cornerR'].forEach((n) => { const r = G.RECTS[n]; out.box(n, Buffer.alloc(r.w * r.h * 4, 200)); }),
    });
    const timer = setInterval(() => { lad.tick(Date.now(), { parked }); lad.pump(Date.now()); }, 30);
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
    await until(() => r.closed(conn), 4000, 'step ' + n + ' removed');
    const layers = r.of(conn, (m) => m.op === 'layer'), close = r.msgs.filter((m) => m.conn === conn && m.ev === 'close')[0];
    await until(() => { const s = r.lad.status(); return s && s.n === n && s.released !== null; }, 4000, 'step ' + n + ' release check');
    const shown = r.of(conn, (m) => (m.op === 'uniform' && m.name === 'u_alive' && m.v === '1') || (m.op === 'layer' && m.visible === undefined))[0] || layers[0];
    return { conn, layers, assets: r.of(conn, (m) => m.op === 'asset'), frames: r.of(conn, (m) => m.op === 'frame'), lasted: close.t - shown.t, status: r.lad.status() };
}

module.exports = [
    ['step 1 KNOWN card (0.1.4): 1024 x 576 r8, its four text lines drawn, the last two say the dials are ours and the layer is the whole panel', () => {
        const px = ST.knownCard(Canvas, '0.1.4'), W = 1024;
        assert.strictEqual(px.length, W * 576);
        const lit = (y0, y1) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = 40; x < W - 40; x++) if (px[y * W + x] > 128) n++; return n; };
        [[125, 190], [255, 300], [385, 410], [465, 490]].forEach((b) => assert.ok(lit(b[0], b[1]) > 500, 'text in rows ' + b + ': ' + lit(b[0], b[1])));
        const src = fs.readFileSync(path.join(__dirname, '../../apps/adam_mtrack/stages.js'), 'utf8');
        assert.ok(/THE DIALS AND THIS CARD ARE BOTH M TRACK/.test(src) && /ONE LAYER COVERS THE WHOLE 1920 x 720 PANEL/.test(src));
    }],
    ['step 1 KNOWN: G\'s Dash\'s full-screen test shape on its own client: one hidden layer over the panel, one r8 1024 x 576 bilinear asset, lifted, written, bound, shown with u_alive 1 re-armed; removed; released', async () => {
        const r = rig();
        try {
            const s = await runStep(r, 1);
            assert.deepStrictEqual(s.layers.map((l) => [l.kind, l.target, l.x, l.y, l.w, l.h, l.class, l.z, l.visible, l.exclusive, l.contend]),
                [['effect', 'panel', 0, 0, 1920, 720, 'content', 90, 0, 0, 0]]);
            assert.deepStrictEqual(s.assets.map((a) => [a.format, a.w, a.h, a.sampling]), [['r8', 1024, 576, 'bilinear']]);
            assert.deepStrictEqual(s.frames.map((f) => f.bytes), [589824]);
            const ref = s.layers[0].ref, ops = r.of(s.conn, (m) => m.ref === ref && (m.op === 'set' || m.op === 'bind' || m.name === 'u_alive'));
            assert.deepStrictEqual(ops.slice(0, 4).map((m) => [m.op, m.visible !== undefined ? m.visible : m.v || m.sampler]),
                [['uniform', '0'], ['set', 1], ['bind', 'u_lab'], ['uniform', '1']], 'lifted clear, bound once written, then u_alive 1');
            const an = ops.filter((m) => m.op === 'animate');
            assert.ok(an.length >= 5 && an.every((m, i) => m.anim === i + 1 && m.keys === C.safety.aliveKeys), 'the dead-man re-armed with new numbers: ' + an.length);
            assert.ok(r.of(s.conn, (m) => m.op === 'stop' && m.ref === ref).length >= 4, 'each old animation stopped');
            assert.ok(s.lasted >= 650 && s.lasted < 1400, 'shown for ' + s.lasted + ' ms');
            assert.strictEqual(s.status.released, true, JSON.stringify(s.status));
            assert.ok(/^Step 1 KNOWN done: released$/.test(s.status.line) && /^Released: panel idle/.test(s.status.lines[4]), JSON.stringify(s.status));
            assert.ok(r.lines.some((l) => /^test: shown \(1 layers, 1 assets, 1\.1 MiB of renderer memory, built in \d+ ms\)$/.test(l)), r.lines.join('\n'));
            const watch = r.conns('adam_mtrack-watch');
            assert.ok(watch.length === 1 && r.of(watch[0], (m) => m.op).every((m) => m.op === 'hello' || m.op === 'status'), 'the watcher only says hello and asks for the status');
        } finally { await r.done(); }
    }],
    ['step 2 BAR: amber u_alive 1, green 0.1.3\'s dead-man (re-armed new-first), blue exactly 0.1.1\'s (u_alive 0, the same number every 250 ms); no asset', async () => {
        const r = rig();
        try {
            const s = await runStep(r, 2);
            assert.deepStrictEqual(s.layers.map((l) => [l.kind, l.x, l.y, l.w, l.h, l.class]), [['effect', 590, 236, 240, 44, 'content'], ['effect', 840, 236, 240, 44, 'content'], ['effect', 1090, 236, 240, 44, 'content']]);
            assert.strictEqual(s.assets.length, 0);
            const [amber, green, blue] = s.layers.map((l) => l.ref), alive = (ref) => r.of(s.conn, (m) => m.ref === ref && m.name === 'u_alive');
            assert.deepStrictEqual(alive(amber).map((m) => [m.op, m.v]), [['uniform', '1']]);
            const g = alive(green), b = alive(blue);
            assert.ok(g[0].v === '1' && g.filter((m) => m.op === 'animate').every((m, i) => m.anim === i + 1) && g.length >= 6, 'green: ' + JSON.stringify(g.slice(0, 4)));
            assert.ok(b[0].v === '0' && b.filter((m) => m.op === 'animate').length >= 3 && b.filter((m) => m.op === 'animate').every((m) => m.anim === 1 && m.keys === C.test.oldAliveKeys), 'blue: ' + JSON.stringify(b.slice(0, 4)));
            assert.strictEqual(s.status.released, true);
        } finally { await r.done(); }
    }],
    ['steps 3 to 6 draw what they say (layers, assets, bytes), each is removed and released; TACHS and COVER are the cover\'s own stages, under the memory budget', async () => {
        const r = rig();
        try {
            const s3 = await runStep(r, 3);
            assert.deepStrictEqual(s3.layers.map((l) => [l.kind, l.x, l.y, l.w, l.h]), [['effect', 0, 0, 1920, 720]]);
            assert.strictEqual(s3.assets.length, 0);
            const s4 = await runStep(r, 4);
            assert.deepStrictEqual(s4.layers.map((l) => [l.kind, l.x, l.y, l.w, l.h]), [['image', 684, 296, 256, 128], ['effect', 980, 296, 256, 128]]);
            assert.deepStrictEqual(s4.assets.map((a) => [a.format, a.w, a.h]), [['rgba8', 256, 128]]);
            assert.ok(r.of(s4.conn, (m) => m.op === 'bind' && m.ref === s4.layers[1].ref && m.asset === s4.assets[0].ref).length === 1, 'the effect samples the asset');
            assert.deepStrictEqual(s4.frames.map((f) => f.bytes), [131072, 131072], 'the image and the asset, whole');
            const s5 = await runStep(r, 5);
            assert.deepStrictEqual(s5.layers.map((l) => [l.kind, l.x, l.y, l.w, l.h, l.exclusive, l.z, l.visible]), [['effect', 0, 0, 1920, 720, 0, C.build.z, 0]]);
            assert.deepStrictEqual(s5.assets.map((a) => [a.format, a.w, a.h]), [['r8', 480, 360], ['r8', 2 * G.RECTS.overR.w, G.RECTS.overR.h], ['rgba8', 16, 1], ['r8', G.RECTS.band.w, G.RECTS.band.h], ['r8', 1024, ART.atlas.h]]);
            const s6 = await runStep(r, 6);
            assert.deepStrictEqual(s6.layers.map((l) => l.z), [90, 91, 92, 93]);
            assert.strictEqual(s6.assets.length, 10);
            [s5, s6].forEach((s, i) => {
                const mem = s.assets.reduce((b, a) => b + a.w * a.h * (a.format === 'r8' ? 1 : 4) * 2, 0);
                assert.ok(mem <= C.memoryBudgetBytes, 'step ' + (i + 5) + ' memory ' + mem);
                assert.ok(r.of(s.conn, (m) => m.name === 'u_alive' && m.op === 'uniform' && m.v === '1').length === s.layers.length, 'u_alive 1 on every layer once shown');
                assert.deepStrictEqual([s.status.build.state, s.status.build.of], ['shown', i === 0 ? 1 : 4], 'step ' + (i + 5) + ' build');
            });
            [s3, s4, s5, s6].forEach((s, i) => assert.ok(s.status.released === true, 'step ' + (i + 3) + ' released: ' + JSON.stringify(s.status.lines)));
            assert.strictEqual(ST.memoryOf(ART), s6.assets.reduce((b, a) => b + a.w * a.h * (a.format === 'r8' ? 1 : 4) * 2, 0), 'the cover step uploads exactly the cover');
        } finally { await r.done(); }
    }],
    ['a step whose build the renderer refuses stops at that stage, says which and why, and is released', async () => {
        const r = rig();
        try {
            const before = r.conns('adam_mtrack-test').length;
            r.lad.start(6, { armed: false, parked: true });
            await until(() => r.conns('adam_mtrack-test').length > before, 2000, 'connects');
            const conn = r.conns('adam_mtrack-test')[before];
            await until(() => r.of(conn, (m) => m.op === 'layer' && m.z === 91).length === 1, 4000, 'stage 2 made');
            const ref = r.of(conn, (m) => m.op === 'layer' && m.z === 91)[0].ref;
            r.fake.error('layer', ref, 'test refusal');
            await until(() => r.closed(conn), 2000, 'the step ends');
            await until(() => { const s = r.lad.status(); return s && s.state === 'stopped'; }, 2000, 'stopped');
            const s = r.lad.status();
            assert.ok(/^Step 6 COVER stopped at stage 2 of 4 PANELS: refused: layer: test refusal$/.test(s.line), s.line);
            await until(() => r.lad.status().released !== null, 4000, 'the release check');
        } finally { await r.done(); }
    }],
    ['refusals draw nothing: the cover armed, not parked, another app on the shared scene (named from the status)', async () => {
        const r = rig();
        try {
            assert.strictEqual(r.lad.start(2, { armed: true, parked: true }), 'turn Cover the cluster off first');
            assert.strictEqual(r.lad.start(2, { armed: false, parked: false }), 'parked only (in P or barely moving)');
            assert.ok(/^Step 2 BAR refused: parked only$/.test(r.lad.status().line), r.lad.status().line);
            await wait(200);
            assert.ok(!r.msgs.some((m) => m.ev === 'connect'), 'no connection for a refused step');
            const other = new ClusterRender('adam_shiftlights', r.sock);
            other.on('ready', () => other.effect({ target: 'hud', x: 0, y: 0, w: 10, h: 10, fs: 'void main(){}' }));
            other.connect();
            await until(() => r.fake.state('hud').state === 'shown', 2000, 'Shift Lights on the HUD');
            assert.strictEqual(r.lad.start(3, { armed: false, parked: true }), '');
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
            r.lad.start(3, { armed: false, parked: true });
            await until(() => C2().length === 1 && r.of(C2()[0], (m) => m.op === 'layer').length === 1, 2000, 'step 3 shown');
            const t = Date.now();
            r.setParked(false);
            await until(() => r.closed(C2()[0]), 1000, 'stopped when moving');
            assert.ok(Date.now() - t < 400, 'stopped after ' + (Date.now() - t) + ' ms');
            assert.ok(/stopped: the car moved/.test(r.lad.status().lines[0]), JSON.stringify(r.lad.status()));
            r.setParked(true);
            r.lad.start(2, { armed: false, parked: true });
            await until(() => C2().length === 2 && r.of(C2()[1], (m) => m.op === 'layer').length === 3, 2000, 'step 2 shown');
            r.lad.stop('stop button');
            await until(() => r.closed(C2()[1]), 1000, 'STOP');
            r.lad.start(2, { armed: false, parked: true });
            await until(() => C2().length === 3 && r.of(C2()[2], (m) => m.op === 'layer').length === 3, 2000, 'step 2 again');
            r.lad.start(4, { armed: false, parked: true });
            await until(() => r.closed(C2()[2]), 1000, 'replaced');
            await until(() => C2().length === 4 && r.of(C2()[3], (m) => m.op === 'layer').length === 2, 2000, 'step 4 shown');
            assert.ok(r.lad.running() && r.lad.status().n === 4);
            assert.ok(!r.lines.some((l) => /release .*\(test step 2\)/.test(l) && /replaced/.test(l)), 'no release check of a replaced step');
        } finally { await r.done(); }
    }],
];
