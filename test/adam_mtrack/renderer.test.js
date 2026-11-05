'use strict';
/* renderer.js: the service's status text parsed (its server.cpp format: holder in brackets, a reason, the rendering
 * after "; ", "scene published", layers by app with class and z, assets with their writes), our uploads and the pixel
 * memory every app takes, whose the shared scene is (busyOf), the warm HUD scene, a release's
 * verdict, the diag tap (uniforms counted, the rest logged, raw events seen first), and the watcher against the fake
 * service: the panel idle (confirmed), another app keeping it (NOT confirmed, named), no service (not reachable). */
const assert = require('assert');
const os = require('os');
const path = require('path');
const RD = require('../../apps/adam_mtrack/renderer');
const cfg = require('../../apps/adam_mtrack/config');
const { ClusterRender } = require('../../apps/adam_mtrack/cluster_render_client');
const { createFake } = require('./fake_cluster_render');

const STATUS = [
    'upload: cap 5371 KB/s (ceiling 5500, floor 2000): lowered from 5500 KB/s: in 30 s, 1 x scene removed',
    'target map: slot 0x100 scene 0x10004f0 1088x480: idle',
    'target panel: slot 0x203 scene 0x1000400 1920x720: waiting scene id in use by another target',
    'target hud: slot 0x323 scene 0x1000400 800x480: shown (us); rendered: renderer 1a2b subscribed for 40 s',
    'target guide_auto: slot 0x105 scene 0x10004f1 16x16: parked (stock) parked behind stock',
    'renderer: 12 subscription lines read since start',
    'asset 4 r8 1920x720 of adam_mtrack on panel: 1 writes, 1350 KB, 0 failed',
    'layer 7 effect of adam_shiftlights on hud, overlay z 2: shown',
    '  1800 frames, 52000 KB',
    'layer 9 effect of adam_mtrack on panel, overlay z 900: waiting - target waiting',
    'layer 3 video of waze-on-cluster on map, content z 0, guide_hold 0: stalled - no frame yet',
].join('\n') + '\n';
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const C = Object.assign({}, cfg, { renderer: Object.assign({}, cfg.renderer, { verifyMs: 900 }) });
let seq = 0;
const sock = () => path.join(os.tmpdir(), 'mt-rd-' + process.pid + '-' + (++seq) + '.sock');
const quiet = { info: () => {}, warn: () => {}, error: () => {} };
const guard = (n, fn) => function () { try { return fn.apply(this, arguments); } catch (e) { return undefined; } };
const verify = (socketPath, why) => new Promise((res) => RD.verifyRelease({ ClusterRender, socketPath, log: quiet, diag: () => {}, guard, cfg: C }, why, res));

module.exports = [
    ['parseStatus: targets with holder, reason and rendering; a published scene; layers by app with their state and reason', () => {
        const st = RD.parseStatus(STATUS);
        assert.strictEqual(st.cap, 5371);
        assert.deepStrictEqual(st.targets.panel, { state: 'waiting', holder: '', reason: 'scene id in use by another target', rendering: '', published: false });
        assert.deepStrictEqual(st.targets.hud, { state: 'shown', holder: 'us', reason: '', rendering: 'rendered: renderer 1a2b subscribed for 40 s', published: false });
        assert.deepStrictEqual(st.targets.guide_auto, { state: 'parked', holder: 'stock', reason: 'parked behind stock', rendering: '', published: false });
        assert.strictEqual(RD.parseStatus('target hud: slot 0x323 scene 0x1000400 800x480: idle; scene published').targets.hud.published, true);
        assert.deepStrictEqual(st.layers.map((l) => [l.id, l.kind, l.app, l.target, l.klass, l.z, l.state, l.reason]),
            [[7, 'effect', 'adam_shiftlights', 'hud', 'overlay', 2, 'shown', ''], [9, 'effect', 'adam_mtrack', 'panel', 'overlay', 900, 'waiting', 'target waiting'],
                [3, 'video', 'waze-on-cluster', 'map', 'content', 0, 'stalled', 'no frame yet']]);
        assert.deepStrictEqual(st.assets, [{ id: 4, format: 'r8', w: 1920, h: 720, app: 'adam_mtrack', target: 'panel', writes: 1, failed: 0 }]);
        assert.deepStrictEqual(RD.othersOn(st, ['panel', 'hud']), ['adam_shiftlights on hud']);
        assert.deepStrictEqual(RD.parseStatus(''), { cap: null, targets: {}, layers: [], assets: [] });
        assert.deepStrictEqual(RD.parseStatus(undefined).layers, []);
    }],
    ['uploadsOf, memoryOf, layerOf: our assets\' writes on a target, every app\'s pixel memory (assets twice), our layer by its z', () => {
        const st = RD.parseStatus(['asset 1 r8 480x360 of adam_mtrack on panel: 2 writes, 337 KB, 1 failed', 'asset 2 rgba8 16x1 of adam_mtrack on panel: 0 writes, 0 KB, 0 failed',
            'asset 3 rgba8 1088x480 of robertn_waze_cluster on map: 1 writes, 2040 KB, 0 failed', 'asset 5 r8 10x10 of adam_mtrack-test on panel: 0 writes, 0 KB, 0 failed',
            'layer 9 effect of adam_mtrack on panel, content z 91: hidden', 'layer 10 effect of adam_mtrack on panel, content z 90, guide_hold 0: shown'].join('\n'));
        assert.deepStrictEqual(RD.uploadsOf(st, 'adam_mtrack', 'panel'), { listed: 2, unwritten: 1, failed: 1 });
        assert.deepStrictEqual(RD.uploadsOf(st, 'adam_mtrack', 'hud'), { listed: 0, unwritten: 0, failed: 0 });
        const m = RD.memoryOf(st, 'adam_mtrack');
        assert.deepStrictEqual([m.mine, m.all], [480 * 360 * 2 + 16 * 4 * 2, 480 * 360 * 2 + 16 * 4 * 2 + 1088 * 480 * 4 * 2 + 100 * 2]);
        assert.deepStrictEqual(m.others, ['robertn_waze_cluster 4.0 MiB', 'adam_mtrack-test 0.0 MiB']);
        assert.deepStrictEqual([RD.layerOf(st, 'adam_mtrack', 'panel', 91).state, RD.layerOf(st, 'adam_mtrack', 'panel', 90).state, RD.layerOf(st, 'adam_mtrack', 'panel', 92)], ['hidden', 'shown', null]);
        assert.deepStrictEqual(RD.memoryOf(null, 'x'), { all: 0, mine: 0, others: [] });
    }],
    ['busyOf: the HUD wanted by anyone, the panel wanted by another app (not ours), waiting on the shared scene id, a foreign holder; BMW is not busy', () => {
        const B = RD.busyOf;
        assert.strictEqual(B({ panel: { state: 'waiting', reason: 'scene id in use by another target' } }, true), 'the panel waits: its scene id is in use');
        ['acquiring', 'shown', 'parked', 'waiting', 'unavailable'].forEach((s) => assert.strictEqual(B({ hud: { state: s } }, false), 'the HUD is ' + s, s));
        ['idle', 'lingering', undefined].forEach((s) => assert.strictEqual(B({ hud: { state: s } }, false), '', String(s)));
        assert.strictEqual(B({ panel: { state: 'shown' } }, false), 'the panel is shown for another app');
        assert.strictEqual(B({ panel: { state: 'shown' } }, true), '', 'our own layers on it');
        assert.strictEqual(B({ panel: { state: 'lingering' } }, false), '', 'nobody wants a lingering panel');
        assert.strictEqual(B({ panel: { state: 'parked', holder: 'foreign' } }, true), 'another app\'s content holds slot 0x203');
        assert.strictEqual(B({ panel: { state: 'waiting', holder: 'stock', reason: 'held by stock content' } }, true), '', 'BMW holding it is "held", not busy');
        assert.strictEqual(B({}, false), '');
    }],
    ['warmOf and verdictOf: the HUD scene published and unwanted; a release is ok only with none of our layers and the panel idle or lingering', () => {
        assert.strictEqual(RD.warmOf(RD.parseStatus('target hud: slot 0x323 scene 0x1000400 800x480: idle; scene published')), true);
        assert.strictEqual(RD.warmOf(RD.parseStatus(STATUS)), false);
        assert.strictEqual(RD.warmOf(null), false);
        const bad = RD.verdictOf(RD.parseStatus(STATUS));
        assert.deepStrictEqual([bad.ok, bad.ours, bad.panel, bad.others], [false, 1, 'waiting', ['adam_shiftlights on hud']]);
        const ok = RD.verdictOf(RD.parseStatus('target panel: slot 0x203 scene 0x1000400 1920x720: idle\nasset 4 r8 1920x720 of adam_mtrack on panel: 1 writes, 1350 KB, 0 failed'));
        assert.deepStrictEqual([ok.ok, ok.ours, ok.panel], [true, 0, 'idle'], 'our assets do not count, only layers');
        const held = RD.verdictOf(RD.parseStatus('target panel: slot 0x203 scene 0x1000400 1920x720: shown (us)\nlayer 2 effect of adam_shiftlights on panel, overlay z 0: shown'));
        assert.deepStrictEqual([held.ok, held.ours, held.others], [false, 0, ['adam_shiftlights on panel']]);
        held.ms = 6000;
        assert.ok(/^NOT released: panel shown, adam_shiftlights on panel \(6\.0 s\)$/.test(RD.verdictShort(held)), RD.verdictShort(held));
        assert.ok(/^release NOT confirmed \(cover off\): our layers gone, panel shown, adam_shiftlights on panel after 6\.0 s$/.test(RD.verdictText(held, 'cover off')), RD.verdictText(held, 'cover off'));
    }],
    ['tap: every op but uniforms, alive re-arms and stops goes to the diag log (shaders as their length), events too (a repeated status counted), onEvent sees each first', () => {
        const lines = [], seen = [], sent = [];
        const c = { app: 'adam_mtrack', _send(m) { sent.push(m); }, _event(ev) { seen.push('client ' + ev.ev); } };
        RD.tap(c, (l) => lines.push(l), (ev) => seen.push('tap ' + ev.ev));
        c._send({ op: 'layer', ref: 3, fs: 'x'.repeat(2100) });
        c._send({ op: 'uniform', ref: 3, name: 'u_fill', v: '1' });
        c._send({ op: 'animate', ref: 3, anim: 1, name: 'u_alive' });
        c._send({ op: 'stop', ref: 3, anim: 1 });
        c._send({ op: 'animate', ref: 3, anim: 2, name: 'u_on' });
        c._event({ ev: 'target', target: 'panel', state: 'shown' });
        c._event({ ev: 'status', text: 'a\nb' });
        c._event({ ev: 'status', text: 'a\nb' });
        c._event({ ev: 'status', text: 'a\nb' });
        c._event({ ev: 'status', text: 'c' });
        assert.strictEqual(sent.length, 5, 'everything still sent');
        assert.deepStrictEqual(lines, ['> {"op":"layer","ref":3,"fs":"2100 chars"}', '> {"op":"animate","ref":3,"anim":2,"name":"u_on"}',
            '< {"ev":"target","target":"panel","state":"shown"}', '< status: a\nb', '< status: the same again, 2 times', '< status: c']);
        assert.deepStrictEqual(seen, ['tap target', 'client target', 'tap status', 'client status', 'tap status', 'client status', 'tap status', 'client status', 'tap status', 'client status']);
    }],
    ['the fake service writes an asset only while its target is asked for (a visible layer), as cluster-render does; hidden layers say so', async () => {
        const s1 = sock(), fake = createFake(s1, () => {}, null, { lingerMs: 100 });
        const c = new ClusterRender('adam_mtrack', s1), texts = [];
        try {
            c.on('status', (t) => texts.push(t));
            await new Promise((res) => { c.on('ready', res); c.connect(); });
            const a = c.asset({ target: 'panel', format: 'r8', w: 4, h: 4 });
            c.pixels(a, null, Buffer.alloc(16, 9));
            const l = c.effect({ target: 'panel', x: 0, y: 0, w: 4, h: 4, visible: false, fs: 'void main(){}' });
            await wait(150); c.status(); await wait(150);
            let st = RD.parseStatus(texts[texts.length - 1]);
            assert.deepStrictEqual([st.assets[0].writes, st.layers[0].state, st.targets.panel.state], [0, 'hidden', 'idle'], 'hidden: nothing asks for the panel, nothing written');
            c.set(l, { visible: true });
            await wait(200); c.status(); await wait(150);
            st = RD.parseStatus(texts[texts.length - 1]);
            assert.deepStrictEqual([st.assets[0].writes, st.targets.panel.state], [1, 'shown'], 'visible: the panel asked for, the asset written');
        } finally { c.close(); await new Promise((res) => fake.close(res)); }
    }],
    ['verifyRelease against the fake service: panel idle: confirmed; another app keeping the panel: NOT confirmed and named; no service: not reachable', async () => {
        const s1 = sock(), fake = createFake(s1, () => {}, null, { lingerMs: 200 });
        try {
            const a = await verify(s1, 'cover off');
            assert.ok(a.ok && a.panel === 'idle' && /^release confirmed \(cover off\): panel idle/.test(a.text), JSON.stringify(a));
            const other = new ClusterRender('adam_shiftlights', s1);
            other.on('ready', () => other.effect({ target: 'panel', x: 0, y: 0, w: 10, h: 10, fs: 'void main(){}' }));
            other.connect();
            await wait(300);
            const b = await verify(s1, 'test step 1');
            other.close();
            assert.ok(!b.ok && b.panel === 'shown' && b.others.indexOf('adam_shiftlights on panel') >= 0 && b.ms >= 850, JSON.stringify(b));
            assert.ok(/^NOT released: panel shown, adam_shiftlights on panel/.test(b.short), b.short);
        } finally { await new Promise((res) => fake.close(res)); }
        const c = await verify(sock(), 'exit');
        assert.ok(c.unreachable && /not reachable/.test(c.short), JSON.stringify(c));
    }],
];
