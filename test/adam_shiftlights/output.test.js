'use strict';
/* output.js with the real cluster_render_client.js against the fake service on a temp Unix socket.
 * The bracket image is drawn with the kit's own Canvas (the vendored kit, kit/runtime). */
const assert = require('assert');
const os = require('os');
const path = require('path');
const { ClusterRender } = require('../../apps/adam_shiftlights/cluster_render_client');
const { createOutput } = require('../../apps/adam_shiftlights/output');
const { createSafety } = require('../../apps/adam_shiftlights/safety');
const { createFake } = require('./fake_cluster_render');
const L = require('../../apps/adam_shiftlights/logic');
const G = require('../../apps/adam_shiftlights/geom');
const { Canvas } = require('../../kit/runtime/canvas.js');
const cfg = L.validateConfig(require('../../apps/adam_shiftlights/config')).cfg;

const wait = (ms) => new Promise((res) => setTimeout(res, ms));
async function until(fn, ms, what) {
    const end = Date.now() + (ms || 3000);
    while (Date.now() < end) { if (fn()) return; await wait(10); }
    throw new Error('timed out waiting for ' + what);
}
const S = (lit, flashing) => ({ cluster: { lit, flashing: !!flashing }, hud: { lit, flashing: !!flashing } });
const SEL = (c, h, more) => {
    const m = more || {};
    return { cluster: Object.assign({ style: c, size: 100, bright: 100, night: false }, m.cluster), hud: Object.assign({ style: h, size: 100, bright: 100, night: false }, m.hud) };
};
const TH = L.thresholds(cfg, cfg.modes.sportplus, 95);
/** apply() arguments: display, styles, states, rpm, gear */
const A = (display, c, h, st, extra) => Object.assign({ display, active: true, sel: SEL(c, h), states: st || S(0), rpm: 3000, th: TH, gear: 3 }, extra);

let seq = 0;
/** A fresh fake service + output; t.msgs = every message the fake got. */
function rig(logOverride) {
    const sock = path.join(os.tmpdir(), 'sl-out-' + process.pid + '-' + (++seq) + '.sock');
    const msgs = [], lines = [];
    const fake = createFake(sock, (m) => msgs.push(m));
    const log = logOverride || { info: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push('ERR ' + m) };
    const safety = createSafety({ cfg, log: { error: (m) => lines.push('ERR ' + m), info: () => {}, warn: () => {} } });
    const out = createOutput({ ClusterRender, socketPath: sock, log, cfg, guard: safety.guard, makeCanvas: (w, h) => new Canvas(w, h) });
    const ops = (op, from) => msgs.slice(from || 0).filter((m) => m.op === op);
    const done = () => new Promise((res) => { out.apply({ display: 'off', active: false }); fake.close(res); });
    return { sock, msgs, lines, fake, out, ops, done, safety };
}
const layerOf = (m) => ({ target: m.target, x: m.x, y: m.y, w: m.w, h: m.h, kind: m.kind, class: m.class });
const rectOf = (m) => [m.target, m.x, m.y, m.w, m.h, m.kind].join(' ');
const want = (spec) => [spec.target, spec.rect.x, spec.rect.y, spec.rect.w, spec.rect.h, spec.role === 'bracketImg' ? 'image' : 'effect'].join(' ');

module.exports = [
    ['cluster large: one effect layer at 711,103 498x144 on the panel with the slat uniforms', async () => {
        const r = rig();
        r.out.apply(A('cluster', 'large', 'large'));
        await until(() => r.ops('layer').length === 1 && r.out.status().link === 'ready', 3000, 'layer + ready');
        const m = r.ops('layer')[0];
        assert.deepStrictEqual(layerOf(m), { target: 'panel', x: 711, y: 103, w: 498, h: 144, kind: 'effect', class: 'overlay' });
        assert.ok(/u_geo2/.test(m.fs) && /gl_FragColor/.test(m.fs));
        const u = {};
        r.ops('uniform').forEach((x) => { u[x.name] = x; });
        assert.deepStrictEqual(Object.keys(u).sort(), ['u_colors', 'u_geo', 'u_geo2', 'u_mode', 'u_on', 'u_rect', 'u_st']);
        assert.strictEqual(u.u_colors.type, 'vec4');
        assert.strictEqual(u.u_colors.v.split(' ').length, 40);
        assert.deepStrictEqual([u.u_rect.v, u.u_geo.v, u.u_geo2.v, u.u_mode.v, u.u_st.v], ['498 144 249 113.4', '15.6 18.6 36 10', '29.81 0 82.8 30', '1 0 0 1', '0 0 1 0.2']);
        await until(() => r.out.status().layers['panel slats'] === 'shown', 3000, 'layer shown');
        await r.done();
    }],
    ['every style makes its own layer set: cluster 1 each; HUD large 3, classic 2, bar 1, bracket 2; both off closes', async () => {
        const r = rig();
        for (const c of L.CLUSTER_STYLES) {
            const n0 = r.msgs.length;
            r.out.apply(A('cluster', c, 'large'));
            const specs = G.layersFor(cfg, 'cluster', SEL(c, 'large'));
            assert.strictEqual(specs.length, 1);
            await until(() => r.ops('layer', n0).length === 1, 3000, c);
            assert.deepStrictEqual(r.ops('layer', n0).map(rectOf), specs.map(want), c);
        }
        for (const h of L.HUD_STYLES) {
            const n0 = r.msgs.length, specs = G.layersFor(cfg, 'hud', SEL('large', h));
            r.out.apply(A('hud', 'large', h));
            assert.strictEqual(specs.length, { large: 3, classic: 2, bar: 1, bracket: 2 }[h]);
            await until(() => r.ops('layer', n0).length === specs.length, 3000, h);
            assert.deepStrictEqual(r.ops('layer', n0).map(rectOf).sort(), specs.map(want).sort(), h);
            if (h !== 'bar') await until(() => r.ops('frame', n0).length === 1, 3000, h + ' image');
        }
        const n1 = r.msgs.length;
        r.out.apply(A('off', 'large', 'large'));
        await until(() => r.msgs.slice(n1).some((m) => m.ev === 'close'), 3000, 'closed');
        await r.done();
    }],
    ['the two on/off settings: HUD alone, cluster alone, both x "When both are on", both off', async () => {
        const r = rig();
        const cases = [
            [{ hudOn: true }, ['hud slats', 'hud bracketImg', 'hud bracketFill']],
            [{ clusterOn: true }, ['panel slats']],
            [{ hudOn: true, clusterOn: true }, ['hud slats', 'hud bracketImg', 'hud bracketFill']],       // the default: the HUD wins
            [{ hudOn: true, clusterOn: true, bothMode: 'map' }, ['map slats', 'hud slats', 'hud bracketImg', 'hud bracketFill']],
            [{ hudOn: true, clusterOn: true, bothMode: 'hud' }, ['hud slats', 'hud bracketImg', 'hud bracketFill']],
            [{ hudOn: true, clusterOn: true, bothMode: 'cluster' }, ['panel slats']],
        ];
        for (const c of cases) {
            const n0 = r.msgs.length, display = L.readDisplays((k) => c[0][k]).display;
            r.out.apply(A(display, 'large', 'large'));
            await until(() => r.ops('layer', n0).length === c[1].length, 3000, JSON.stringify(c[0]));
            assert.deepStrictEqual(Object.keys(r.out.status().layers).sort(), c[1].slice().sort(), JSON.stringify(c[0]));
        }
        await until(() => r.out.status().targets.panel === 'shown', 3000, 'target state from the service');
        // both on, switching the winner: the old target's layers are dropped and the new made in the same tick, on
        // the same connection (no reconnect, no moment with both scenes)
        for (const [from, to, want] of [['hud', 'cluster', ['panel']], ['cluster', 'hud', ['hud', 'hud', 'hud']]]) {
            r.out.apply(A(from, 'large', 'large'));
            await wait(150);
            const n0 = r.msgs.length;
            r.out.apply(A(to, 'large', 'large'));
            await until(() => r.ops('layer', n0).length === want.length, 3000, from + ' -> ' + to);
            const ops = r.msgs.slice(n0).filter((m) => m.op === 'drop' || m.op === 'layer');
            const firstLayer = ops.findIndex((m) => m.op === 'layer');
            assert.ok(firstLayer > 0 && ops.slice(0, firstLayer).every((m) => m.op === 'drop') && ops.slice(firstLayer).every((m) => m.op === 'layer'), from + ' -> ' + to + ': drops then layers');
            assert.ok(r.ops('layer', n0)[0].t - ops[firstLayer - 1].t < 50, 'made within 50 ms of the drop');
            assert.ok(r.msgs.slice(n0).every((m) => m.op !== 'hello' && m.ev !== 'close'), 'same connection');
            assert.deepStrictEqual(r.ops('layer', n0).map((m) => m.target), want);
        }
        r.out.apply(A(L.readDisplays(() => false).display, 'large', 'large'));
        assert.deepStrictEqual([r.out.status().layers, r.out.status().targets, r.out.status().link], [{}, {}, 'none']);
        await r.done();
    }],
    ['the HUD bar shows its unlit slats at idle (u_st.w < 0); the cluster bars only once lit (w > 0)', async () => {
        const r = rig();
        r.out.apply(A('both', 'large', 'bar', S(0), { rpm: 800 }));
        await until(() => r.ops('layer').length === 2 && r.ops('uniform').filter((m) => m.name === 'u_st').length === 2, 3000, 'layers');
        const st = {};
        r.ops('uniform').filter((m) => m.name === 'u_st').forEach((m) => { st[r.ops('layer').filter((l) => l.ref === m.ref)[0].target] = m.v; });
        assert.deepStrictEqual(st, { map: '0 0 1 0.2', hud: '0 0 1 -0.16' });
        await r.done();
    }],
    ['a live style change drops the old layers and makes the new ones on the same connection', async () => {
        const r = rig();
        r.out.apply(A('both', 'large', 'large'));
        await until(() => r.ops('layer').length === 4 && r.out.status().link === 'ready', 3000, '4 layers');
        const refs = r.ops('layer').map((m) => m.ref), conn = r.ops('layer')[0].conn, n0 = r.msgs.length;
        r.out.apply(A('both', 'classic', 'bar'));
        await until(() => r.ops('layer', n0).length === 2, 3000, 'new layers');
        assert.deepStrictEqual(r.ops('drop', n0).map((m) => m.ref).sort(), refs.sort());
        assert.ok(r.msgs.slice(n0).every((m) => m.ev !== 'close' && m.op !== 'hello'), 'no reconnect');
        assert.ok(r.ops('layer', n0).every((m) => m.conn === conn));
        assert.deepStrictEqual(r.ops('layer', n0).map(rectOf), G.layersFor(cfg, 'both', SEL('classic', 'bar')).map(want));
        // HUD off: the cluster goes back to the panel
        const n1 = r.msgs.length;
        r.out.apply(A('cluster', 'classic', 'bar'));
        await until(() => r.ops('layer', n1).length === 1, 3000, 'panel layer');
        assert.deepStrictEqual(r.ops('layer', n1).map(rectOf), ['panel 753 152 414 46 effect']);
        await r.done();
    }],
    ['a brightness or night change sends only u_st to the effects and opacity to the image', async () => {
        const r = rig();
        r.out.apply(A('both', 'large', 'large'));
        await until(() => r.ops('layer').length === 4 && r.ops('frame').length === 1, 3000, 'layers');
        await wait(50);
        const n0 = r.msgs.length;
        r.out.apply(A('both', 'large', 'large', S(0), { sel: SEL('large', 'large', { cluster: { bright: 40 }, hud: { night: true } }) }));
        await until(() => r.ops('set', n0).length === 1 && r.ops('uniform', n0).length === 3, 3000, 'brightness');
        await wait(100);
        const sent = r.msgs.slice(n0).filter((m) => m.op);
        assert.deepStrictEqual(sent.map((m) => m.op + ' ' + (m.name || '')).sort(), ['set ', 'uniform u_st', 'uniform u_st', 'uniform u_st']);
        assert.strictEqual(r.ops('set', n0)[0].opacity, 0.35);
        assert.deepStrictEqual(r.ops('uniform', n0).map((m) => m.v.split(' ')[2]).sort(), ['0.35', '0.35', '0.4']);
        await r.done();
    }],
    ['a gear change sends exactly one frame with one rect (the digit box); the same gear sends nothing', async () => {
        const r = rig();
        r.out.apply(A('hud', 'off', 'bracket'));
        await until(() => r.ops('frame').length === 1, 3000, 'image');
        const whole = r.ops('frame')[0], spec = G.layersFor(cfg, 'hud', SEL('off', 'bracket'))[0];
        assert.deepStrictEqual([whole.rects, whole.bytes], [[], spec.rect.w * spec.rect.h * 4]);
        const n0 = r.msgs.length;
        r.out.apply(A('hud', 'off', 'bracket', S(0), { gear: 4 }));
        r.out.apply(A('hud', 'off', 'bracket', S(0), { gear: 4 }));
        await until(() => r.ops('frame', n0).length === 1, 3000, 'gear frame');
        await wait(100);
        const f = r.ops('frame', n0);
        assert.strictEqual(f.length, 1);
        const gb = spec.geom.gearBox;
        assert.deepStrictEqual(f[0].rects, [{ x: gb.x - spec.rect.x, y: gb.y - spec.rect.y, w: gb.w, h: gb.h }]);
        assert.strictEqual(f[0].bytes, gb.w * gb.h * 4);
        assert.strictEqual(r.msgs.slice(n0).filter((m) => m.op && m.op !== 'frame').length, 0);   // rpm unchanged: no uniform
        await r.done();
    }],
    ['an rpm change sends only the fill uniform; a lit change one u_st; the same state 10 times nothing', async () => {
        const r = rig();
        r.out.apply(A('both', 'large', 'large', S(2)));
        await until(() => r.out.status().link === 'ready' && r.ops('frame').length === 1, 3000, 'ready');
        await wait(50);
        const n0 = r.msgs.length;
        for (let i = 0; i < 10; i++) r.out.apply(A('both', 'large', 'large', S(2)));
        await wait(100);
        assert.strictEqual(r.msgs.length, n0);
        r.out.apply(A('both', 'large', 'large', S(2), { rpm: 4500 }));
        await until(() => r.ops('uniform', n0).length === 1, 3000, 'fill');
        await wait(50);
        const u = r.ops('uniform', n0)[0], fill = G.layersFor(cfg, 'both', SEL('large', 'large'))[3];
        assert.strictEqual(u.name, 'u_st');
        assert.strictEqual(Number(u.v.split(' ')[0]), Math.round(fill.geom.sOf(4500) * 100) / 100);
        const n1 = r.msgs.length;
        r.out.apply(A('both', 'large', 'large', S(3), { rpm: 4500 }));
        await until(() => r.ops('uniform', n1).length === 2, 3000, 'u_st x2');
        await wait(50);
        assert.deepStrictEqual(r.ops('uniform', n1).map((m) => [m.name, m.v.split(' ')[0]]), [['u_st', '3'], ['u_st', '3']]);
        await r.done();
    }],
    ['flash: one step animation of u_on at the flash rate per lit layer, stopped when the flash ends; the bracket style never flashes', async () => {
        const r = rig();
        r.out.apply(A('both', 'large', 'large', S(10)));
        await until(() => r.out.status().link === 'ready', 3000, 'ready');
        const n0 = r.msgs.length;
        for (let i = 0; i < 5; i++) r.out.apply(A('both', 'large', 'large', S(10, true)));
        await until(() => r.ops('animate', n0).length === 3, 3000, 'animate');
        await wait(100);
        const a = r.ops('animate', n0);
        assert.strictEqual(a.length, 3);              // cluster slats, HUD slats, HUD fill
        a.forEach((x) => assert.deepStrictEqual([x.property, x.name, x.keys, x.loop, x.interp], ['uniform', 'u_on', '0:1 125:0 250:1', 1, 'step']));
        const n1 = r.msgs.length;
        r.out.apply(A('both', 'large', 'large', S(10)));
        await until(() => r.ops('stop', n1).length === 3, 3000, 'stop');
        const n2 = r.msgs.length;
        r.out.apply(A('hud', 'off', 'bracket', S(0, true)));
        await until(() => r.ops('layer', n2).length === 2, 3000, 'bracket');
        await wait(100);
        assert.strictEqual(r.ops('animate', n2).length, 0);
        await r.done();
    }],
    ['active false (kill, demo, tripped) drops every layer and closes', async () => {
        const r = rig();
        r.out.apply(A('both', 'stock', 'classic', S(1)));
        await until(() => r.ops('layer').length === 3 && r.out.status().link === 'ready', 3000, 'layers');
        const n0 = r.msgs.length;
        r.out.apply(A('both', 'stock', 'classic', S(1), { active: false }));
        await until(() => r.msgs.slice(n0).some((m) => m.ev === 'close'), 3000, 'closed');
        assert.strictEqual(r.ops('drop', n0).length, 3);
        r.out.apply(A('both', 'stock', 'classic', S(1)));
        await until(() => r.ops('layer', n0).length === 3, 3000, 'layers back');
        await r.done();
    }],
    ['service restart: the client reconnects and replays every layer, the image whole and the last uniforms', async () => {
        const r = rig();
        r.out.apply(A('both', 'large', 'large', S(4)));
        await until(() => r.out.status().link === 'ready' && r.ops('frame').length === 1, 3000, 'ready');
        r.out.apply(A('both', 'large', 'large', S(5, true), { gear: 2 }));
        await wait(50);
        const n0 = r.msgs.length;
        await new Promise((res) => r.fake.restart(res));
        await until(() => r.ops('hello', n0).length === 1 && r.out.status().link === 'ready', 6000, 'reconnect');
        await wait(150);
        const conn = r.ops('hello', n0)[0].conn;
        const again = r.msgs.slice(n0).filter((m) => m.conn === conn);
        assert.deepStrictEqual(again.filter((m) => m.op === 'layer').map(rectOf).sort(), G.layersFor(cfg, 'both', SEL('large', 'large')).map(want).sort());
        const img = again.filter((m) => m.op === 'frame');
        const spec = G.layersFor(cfg, 'both', SEL('large', 'large'))[2];
        assert.deepStrictEqual(img.map((f) => [f.rects.length, f.bytes]), [[0, spec.rect.w * spec.rect.h * 4]]);
        const st = again.filter((m) => m.op === 'uniform' && m.name === 'u_st').map((m) => m.v.split(' ').slice(0, 2).join(' '));
        assert.ok(st.indexOf('5 1') >= 0, JSON.stringify(st));
        assert.strictEqual(again.filter((m) => m.op === 'animate').length, 3);
        assert.ok(r.lines.some((l) => /connection lost/.test(l)));
        await r.done();
    }],
    ['a handler that throws inside cr.on is caught by the guard', async () => {
        const errors = [];
        const r = rig({ info: (m) => { if (/connected/.test(m)) throw new Error('log broke'); }, warn: () => {}, error: (m) => errors.push(m) });
        r.out.apply(A('cluster', 'large', 'large'));
        await until(() => r.ops('layer').length === 1 && r.lines.some((l) => /error in cr ready/.test(l)), 3000, 'guarded throw');
        assert.strictEqual(r.safety.tripped(), false);
        await r.done();
    }],
];
