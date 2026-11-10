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
function rig(logOverride, more) {
    const sock = path.join(os.tmpdir(), 'sl-out-' + process.pid + '-' + (++seq) + '.sock');
    const msgs = [], lines = [], x = more || {};
    const fake = createFake(sock, (m) => msgs.push(m), null, { mode: x.mode });
    const log = logOverride || { info: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push('ERR ' + m) };
    const safety = createSafety({ cfg, log: { error: (m) => lines.push('ERR ' + m), info: () => {}, warn: () => {} } });
    const out = (x.createOutput || createOutput)(Object.assign({ ClusterRender, socketPath: sock, log, cfg: x.cfg || cfg, guard: safety.guard, makeCanvas: (w, h) => new Canvas(w, h) }, x.opts));
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
    ['every style makes its own layer set: cluster 1 each; HUD large 3, classic 3, bar 1, bracket 2; both off closes', async () => {
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
            assert.strictEqual(specs.length, { large: 3, classic: 3, bar: 1, bracket: 2 }[h]);
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
        assert.deepStrictEqual(st, { map: '0 0 1 0.2', hud: '0 0 1 ' + (-cfg.hudStyles.bar.dim) });
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
    ['flash, Renderer mode: one step animation of u_on at the flash rate per effect layer, stopped when the flash ends; the bracket style flashes its fill', async () => {
        const r = rig(), R = { flashMode: 'renderer' };
        r.out.apply(A('both', 'large', 'large', S(10), R));
        await until(() => r.out.status().link === 'ready', 3000, 'ready');
        const n0 = r.msgs.length;
        for (let i = 0; i < 5; i++) r.out.apply(A('both', 'large', 'large', S(10, true), R));
        await until(() => r.ops('animate', n0).length === 3, 3000, 'animate');
        await wait(100);
        const a = r.ops('animate', n0);
        assert.strictEqual(a.length, 3);              // cluster slats, HUD slats, HUD fill
        a.forEach((x) => assert.deepStrictEqual([x.property, x.name, x.keys, x.loop, x.interp], ['uniform', 'u_on', '0:1 125:0 250:1', 1, 'step']));
        const n1 = r.msgs.length;
        r.out.apply(A('both', 'large', 'large', S(10), R));
        await until(() => r.ops('stop', n1).length === 3, 3000, 'stop');
        assert.strictEqual(r.ops('uniform', n0).filter((m) => m.name === 'u_on').length, 0, 'Renderer: the app sends no u_on');
        const n2 = r.msgs.length;
        r.out.apply(A('hud', 'off', 'bracket', S(0, true), { rpm: 6800, flashMode: 'renderer' }));
        await until(() => r.ops('layer', n2).length === 2 && r.ops('animate', n2).length === 1, 3000, 'bracket flash');
        await wait(100);
        // 0.4.2: the fill turns red and flashes at the shift point in the bracket style too (u_st flash 1 on the fill)
        const fill = r.ops('layer', n2).filter((m) => /u_path/.test(m.fs))[0];
        assert.ok(fill && r.ops('animate', n2)[0].ref === fill.ref, 'the animation is the fill\'s');
        assert.strictEqual(r.ops('uniform', n2).filter((m) => m.ref === fill.ref && m.name === 'u_st').pop().v.split(' ')[1], '1');
        await r.done();
    }],
    ['active false (kill, demo, tripped) drops every layer and closes', async () => {
        const r = rig();
        r.out.apply(A('both', 'stock', 'classic', S(1)));
        await until(() => r.ops('layer').length === 4 && r.out.status().link === 'ready', 3000, 'layers');
        const n0 = r.msgs.length;
        r.out.apply(A('both', 'stock', 'classic', S(1), { active: false }));
        await until(() => r.msgs.slice(n0).some((m) => m.ev === 'close'), 3000, 'closed');
        assert.strictEqual(r.ops('drop', n0).length, 4);
        r.out.apply(A('both', 'stock', 'classic', S(1)));
        await until(() => r.ops('layer', n0).length === 4, 3000, 'layers back');
        await r.done();
    }],
    ['service restart: the client reconnects and replays every layer, the image whole and the last uniforms (Renderer: its animations)', async () => {
        const r = rig();
        r.out.apply(A('both', 'large', 'large', S(4), { flashMode: 'renderer' }));
        await until(() => r.out.status().link === 'ready' && r.ops('frame').length === 1, 3000, 'ready');
        r.out.apply(A('both', 'large', 'large', S(5, true), { gear: 2, flashMode: 'renderer' }));
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
    // ---- 0.4.4: the HUD check (read-back, rebuild) ----
    ['0.4.4 steady run: the same layer, uniform and pixel ops as 0.4.3\'s output.js (only status asks are new)', async () => {
        const quiet = { setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {} };
        const run = async (make, opts) => {
            const r = rig(null, { createOutput: make, opts });
            const flash = Object.assign({}, quiet);         // the App flash ticker: never advanced, only its first u_on 1 goes
            const steps = [
                A('hud', 'large', 'large'), A('hud', 'large', 'large', S(3), { rpm: 6100 }), A('hud', 'large', 'large', S(7), { rpm: 6500, gear: 4 }),
                A('hud', 'large', 'large', S(10, true), { rpm: 6900, gear: 4 }), A('hud', 'large', 'large', S(0), { rpm: 3000, gear: 'N' }),
                Object.assign(A('hud', 'large', 'large'), { sel: SEL('large', 'large', { hud: { bright: 60, night: true } }) }),
                A('hud', 'large', 'bar', S(5)), A('hud', 'large', 'bracket', S(2), { gear: 2 }), A('cluster', 'row', 'bracket', S(4)), A('both', 'large', 'classic', S(6)),
            ];
            r.out.apply(steps[0]);
            await until(() => r.out.status().link === 'ready', 3000, 'ready');
            for (const a of steps) { r.out.apply(a); await wait(30); }
            await wait(100);
            const seen = r.msgs.filter((m) => m.op && m.op !== 'status').map((m) => { const c = Object.assign({}, m); delete c.t; delete c.conn; delete c.file; return JSON.stringify(c); });
            const status = r.ops('status').length;
            await r.done();
            void flash;
            return { seen, status };
        };
        const old = await run(require('./output_0.4.3').createOutput, { timers: quiet });
        const now = await run(createOutput, { timers: quiet, checkTimers: quiet });
        assert.ok(old.seen.length > 60, 'the sequence sent ' + old.seen.length + ' ops');
        assert.deepStrictEqual(now.seen, old.seen);
        assert.strictEqual(now.status, 0, 'no status ask with the check timers held');
    }],
    ['0.4.4 rebuild: drops every layer and closes, makes nothing during the gap, then the same layers and uniforms again', async () => {
        const c2 = Object.assign({}, cfg, { hudCheck: Object.assign({}, cfg.hudCheck, { gapMs: 1500, verifyMs: 2000 }) });
        let due = 0;
        const r = rig(null, { cfg: c2, opts: { onRebuildDue: () => { due++; } } });
        r.out.apply(A('hud', 'large', 'large', S(3)));
        await until(() => Object.keys(r.out.status().layers).every((k) => r.out.status().layers[k] === 'shown') && r.ops('layer').length === 3, 3000, 'shown');
        const first = r.ops('layer').map(rectOf), u0 = r.ops('uniform').map((m) => m.name + ' ' + m.v).sort();
        const refs = r.ops('layer').map((m) => m.ref), n0 = r.msgs.length, t0 = Date.now();
        r.out.rebuild('test');
        assert.deepStrictEqual(r.out.status().layers, {}, 'every layer dropped');
        assert.strictEqual(r.out.status().link, 'none');
        // the socket is destroyed right after the drops (as 0.4.3's "nothing to show" close): the service releases a closed
        // connection's layers, so the drops may or may not arrive first
        await until(() => r.msgs.slice(n0).some((m) => m.ev === 'close'), 3000, 'closed');
        assert.ok(r.ops('drop', n0).every((m) => refs.indexOf(m.ref) >= 0));
        assert.strictEqual(r.out.status().proof.holding, true);
        assert.ok(r.lines.some((l) => /^hud check: rebuild \(test\): hud slats shown/.test(l)), r.lines.join('\n'));
        r.out.apply(A('hud', 'large', 'large', S(3)));
        await wait(300);
        assert.strictEqual(r.ops('layer', n0).length, 0, 'nothing made during the gap');
        await until(() => due === 1, 3000, 'onRebuildDue');
        assert.ok(Date.now() - t0 >= 1500 - 20, 'the gap is gapMs');
        const n1 = r.msgs.length;
        r.out.apply(A('hud', 'large', 'large', S(3)));
        await until(() => r.ops('layer', n1).length === 3, 3000, 'made again');
        assert.deepStrictEqual(r.ops('layer', n1).map(rectOf), first);
        assert.deepStrictEqual(r.ops('uniform', n1).map((m) => m.name + ' ' + m.v).sort(), u0);
        assert.strictEqual(r.out.status().proof.holding, false);
        await r.done();
    }],
    ['0.4.4 proof: lastSent and lastSentAt follow each u_st, opacity and gear; onChange on target, layer and status events', async () => {
        const T = [];
        const ct = { setTimeout: (fn, ms) => { const t = { fn, ms }; T.push(t); return t; }, clearTimeout: (t) => { const i = T.indexOf(t); if (i >= 0) T.splice(i, 1); },
            setInterval: (fn, ms) => { const t = { fn, ms, every: true }; T.push(t); return t; }, clearInterval: (t) => { const i = T.indexOf(t); if (i >= 0) T.splice(i, 1); } };
        const fire = (ms) => T.filter((t) => t.ms === ms).forEach((t) => { if (!t.every) T.splice(T.indexOf(t), 1); t.fn(); });
        let changes = 0;
        const r = rig(null, { opts: { checkTimers: ct, onChange: () => { changes++; } } });
        const t0 = Date.now();
        r.out.apply(A('hud', 'large', 'large', S(3), { rpm: 6100 }));
        assert.ok(T.some((t) => t.every && t.ms === cfg.hudCheck.statusMs), 'a status every statusMs while layers exist');
        await until(() => r.out.status().proof.link === 'ready' && r.out.status().proof.layers.every((l) => l.state === 'shown'), 3000, 'shown');
        assert.ok(changes >= 3, 'onChange on made, ready, target and layer events: ' + changes);
        assert.ok(T.some((t) => t.ms === cfg.hudCheck.verifyMs), 'verifyMs after ready');
        assert.ok(T.some((t) => t.ms === 500), '500 ms after a target or layer event');
        const p = r.out.status().proof, fill = p.layers.filter((l) => l.role === 'bracketFill')[0], img = p.layers.filter((l) => l.role === 'bracketImg')[0];
        assert.ok(/^u_st [\d.]+ 0 1 0$/.test(fill.lastSent) && fill.lastSentAt >= t0, JSON.stringify(fill));
        assert.strictEqual(img.lastSent, 'opacity 1, gear 3');
        await wait(5);
        r.out.apply(A('hud', 'large', 'large', S(3), { rpm: 6600, gear: 5 }));
        const q = r.out.status().proof;
        assert.notStrictEqual(q.layers.filter((l) => l.role === 'bracketFill')[0].lastSent, fill.lastSent);
        assert.ok(q.layers.filter((l) => l.role === 'bracketFill')[0].lastSentAt > fill.lastSentAt);
        assert.strictEqual(q.layers.filter((l) => l.role === 'bracketImg')[0].lastSent, 'opacity 1, gear 5');
        const c0 = changes, n0 = r.msgs.length;
        fire(500);
        await until(() => r.ops('status', n0).length === 1 && r.out.status().proof.status, 3000, 'the status read back');
        assert.ok(changes > c0, 'onChange on a status');
        const st = r.out.status().proof.status;
        assert.strictEqual(st.rendering.hud.kind, 'rendered');
        assert.deepStrictEqual(st.others, []);
        assert.ok(r.lines.some((l) => /^cluster-render status: target panel: .*idle \| target hud: .*rendered: renderer/.test(l)), r.lines.join('\n'));
        const n1 = r.msgs.length;
        fire(cfg.hudCheck.statusMs);
        r.out.requestStatus();
        await until(() => r.ops('status', n1).length === 2, 3000, 'interval and requestStatus asks');
        await r.done();
        assert.ok(!T.some((t) => t.every), 'the status interval stops with the layers');
    }],
    ['0.4.4 read-back in the fake\'s modes: unsubscribed, mtrack-on-panel (another app, hud waiting)', async () => {
        for (const mode of ['unsubscribed', 'mtrack-on-panel']) {
            const r = rig(null, { mode });
            r.out.apply(A('hud', 'large', 'bar', S(0)));
            await until(() => r.out.status().proof.link === 'ready' && r.ops('layer').length === 1, 3000, mode);
            r.out.requestStatus();
            await until(() => r.out.status().proof.status, 3000, mode + ' status');
            const p = r.out.status().proof;
            if (mode === 'unsubscribed') assert.strictEqual(p.status.rendering.hud.kind, 'unsubscribed');
            else {
                assert.deepStrictEqual(p.status.others, ['adam_mtrack on panel']);
                assert.strictEqual(p.targets.hud.state, 'waiting');
                assert.strictEqual(p.targets.hud.reason, 'scene id in use by another target');
            }
            await r.done();
        }
    }],
    ['0.4.5 guard-disabled: the guard line lands in proof.status.guard, logged once across identical statuses with one full dump', async () => {
        const r = rig(null, { mode: 'guard-disabled' });
        r.out.apply(A('hud', 'large', 'bar', S(0)));
        await until(() => r.out.status().proof.link === 'ready' && r.ops('layer').length === 1, 3000, 'ready');
        await until(() => r.out.status().proof.targets.hud && r.out.status().proof.layers[0].state === 'waiting', 3000, 'idle events');
        const p0 = r.out.status().proof;
        assert.deepStrictEqual([p0.targets.hud.state, p0.targets.hud.holder, p0.layers[0].reason], ['idle', '', 'target idle']);
        for (let i = 0; i < 3; i++) {
            const n = r.ops('status').length;
            r.out.requestStatus();
            await until(() => r.ops('status').length >= n + 1 && r.out.status().proof.status, 3000, 'status ' + i);
            await wait(30);
        }
        const st = r.out.status().proof.status;
        assert.deepStrictEqual(st.guard.hud, { mapping: 'hud 0x323 0x1000400 0', disabled: true, strikes: 2, line: 'guard: hud 0x323 0x1000400 0: disabled, 2 strikes' });
        assert.strictEqual(st.dcsm.up, true);
        const logged = r.lines.filter((l) => /^cluster-render status: /.test(l));
        assert.strictEqual(logged.length, 1, logged.join('\n'));
        assert.ok(/target hud: .*: idle \| guard: hud 0x323 0x1000400 0: disabled, 2 strikes \| dcsm: Dcsm2 available$/.test(logged[0]), logged[0]);
        const full = r.lines.filter((l) => /^cluster-render status \(full\): /.test(l));
        assert.strictEqual(full.length, 1, 'one full dump: the first status after the ready');
        assert.ok(/^cluster-render status \(full\): upload: .* \| guard: hud .*disabled, 2 strikes \| renderer: .* \| dcsm: Dcsm2 available for \d+ s; .* \| dcsm: since start: /.test(full[0]), full[0]);
        assert.ok(full[0].length <= 'cluster-render status (full): '.length + 1500);
        r.out.rebuild('test');
        assert.ok(r.lines.some((l) => /^hud check: rebuild \(test\): .*, guard hud disabled, 2 strikes$/.test(l)), r.lines.join('\n'));
        await r.done();
    }],
    ['0.4.5 the full dump: on each guard or Dcsm2 change, capped at 30 a start; asset and indented lines left out', async () => {
        const r = rig(null, { mode: 'idle' });
        r.out.apply(A('hud', 'large', 'bar', S(0)));
        await until(() => r.out.status().proof.link === 'ready' && r.ops('layer').length === 1, 3000, 'ready');
        for (let i = 0; i < 40; i++) {
            r.fake.mode(i % 2 ? 'idle' : 'guard-disabled');
            const n = r.ops('status').length;
            r.out.requestStatus();
            await until(() => r.ops('status').length >= n + 1, 3000, 'status ' + i);      // >=: the verifyMs ask may land too
            await wait(15);
        }
        await wait(50);
        assert.strictEqual(r.lines.filter((l) => /^cluster-render status \(full\): /.test(l)).length, 30, 'RAW_LOG_MAX');
        assert.ok(r.lines.filter((l) => /^cluster-render status: /.test(l)).length > 30, 'the short line keeps its own cap (200)');
        await r.done();
        const fs = require('fs'), src = fs.readFileSync(require.resolve('../../apps/adam_shiftlights/output.js'), 'utf8');
        assert.ok(/const RAW_LOG_MAX = 30;/.test(src) && /const RAW_MAX = 1500;/.test(src));
    }],
    ['0.4.5 restartedAt: set by a ready after the service dropped the link, never by our own rebuild', async () => {
        const c2 = Object.assign({}, cfg, { hudCheck: Object.assign({}, cfg.hudCheck, { gapMs: 1500, verifyMs: 2000 }) });
        let due = 0;
        const r = rig(null, { cfg: c2, opts: { onRebuildDue: () => { due++; } } });
        r.out.apply(A('hud', 'large', 'bar', S(0)));
        await until(() => r.out.status().proof.link === 'ready', 3000, 'ready');
        assert.strictEqual(r.out.status().proof.restartedAt, null);
        r.out.rebuild('test');
        await until(() => due === 1, 3000, 'gap over');
        r.out.apply(A('hud', 'large', 'bar', S(0)));
        await until(() => r.out.status().proof.link === 'ready', 3000, 'ready again');
        assert.strictEqual(r.out.status().proof.restartedAt, null, 'our own rebuild is not a service restart');
        const n0 = r.msgs.length;
        await new Promise((res) => r.fake.restart(res));
        await until(() => r.ops('hello', n0).length === 1 && r.out.status().proof.link === 'ready', 6000, 'reconnect');
        const p = r.out.status().proof;
        assert.ok(typeof p.restartedAt === 'number' && p.restartedAt === p.linkAt, JSON.stringify(p.restartedAt));
        assert.ok(r.lines.some((l) => /^cluster-render: connected \(id7, .*\): the service restarted$/.test(l)), r.lines.join('\n'));
        await r.done();
    }],
];
