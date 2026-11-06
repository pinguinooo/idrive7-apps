'use strict';
/* output.js against a scripted cluster-render client (every op recorded, every reply typed by the test): the staged
 * build in G's Dash's order (assets, the layer made hidden, confirmed by a status asked after it, lifted clear, bound
 * only once a status says every asset is written, then the next stage), shown with u_alive 1 (the client's own value:
 * the 0.1.1 cover's fault was 0), the opaque tachs shown last and dropped first; the dead-man re-armed new-first; a
 * refusal, a renderer that never writes and a full pixel memory stop the build at their stage; the 3.5 s hand-over
 * after another app's HUD; step 2's three bars (plain, 0.1.3's dead-man, exactly 0.1.1's). */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const cfg = require('../../apps/adam_mtrack/config');
const G = require('../../apps/adam_mtrack/geom');
const ST = require('../../apps/adam_mtrack/stages');
const { createOutput } = require('../../apps/adam_mtrack/output');

const ART = JSON.parse(fs.readFileSync(path.join(__dirname, '../../apps/adam_mtrack/art/art.json'), 'utf8'));
const FRAME = { yr: G.yOfRpm(800, cfg.tach), quads: [], slats: { lit: 0, flashing: false }, badge: true, level: 1 };

class FakeCR extends EventEmitter {
    constructor(app) { super(); this.app = app; this.ops = []; this.ready = false; this.backend = 'id7'; this.targets = 'panel:1920x720'; this.n = 0; this.anims = {}; FakeCR.last = this; }
    connect() {}
    close() { this.closed = true; }
    _send(m) { this.ops.push(m); }
    _event(ev) {
        if (ev.ev === 'hello') { this.ready = true; this.emit('ready'); } else if (ev.ev === 'status') this.emit('status', ev.text);
        else if (ev.ev === 'error') this.emit('refused', ev.op, ev.ref, ev.reason); else if (ev.ev === 'layer') this.emit('layer', ev.ref, ev.state, ev.reason);
        else if (ev.ev === 'target') this.emit('target', ev.target, ev.state, ev.holder, ev.reason);
    }
    status() { this._send({ op: 'status' }); }
    asset(o) { const ref = ++this.n; this._send(Object.assign({ op: 'asset', ref }, o)); return ref; }
    pixels(ref, rects, px) { this._send({ op: 'pixels', ref, rects, bytes: px.length }); return true; }
    effect(o) { const ref = ++this.n; this._send(Object.assign({ op: 'layer', kind: 'effect', ref }, o)); return ref; }
    image(o) { const ref = ++this.n; this._send(Object.assign({ op: 'layer', kind: 'image', ref }, o)); return ref; }
    set(ref, o) { this._send(Object.assign({ op: 'set', ref }, o)); }
    bind(ref, sampler, asset) { this._send({ op: 'bind', ref, sampler, asset }); }
    uniform(ref, name, v) { this._send({ op: 'uniform', ref, name, v: v.join(' ') }); }
    animate(ref, o) { const a = (this.anims[ref] || 0) + 1; this.anims[ref] = a; this._send({ op: 'animate', ref, anim: a, name: o.name, keys: o.keys }); return a; }
    stop(ref, anim) { this._send({ op: 'stop', ref, anim }); }
    drop(ref) { this._send({ op: 'drop', ref }); }
}

/** The output on a FakeCR, hello'd; r.reply(written, extra) answers the oldest status ask with the service's status text. */
function rig(opts) {
    const o = opts || {}, lines = [], faults = [];
    const C = Object.assign({}, cfg, o.cfg || {});
    const out = createOutput(Object.assign({ ClusterRender: FakeCR, log: { info: (m) => lines.push(m), warn: (m) => lines.push('WARN ' + m), error: (m) => lines.push('ERR ' + m) },
        cfg: C, guard: (n, f) => f, art: ART, fault: (m) => faults.push(m) }, o.out || {}));
    out.arm('us');
    const c = FakeCR.last, app = (o.out && o.out.name) || 'adam_mtrack';
    c._event({ ev: 'hello' });
    const r = {
        out, c, lines, faults,
        ops: (op) => c.ops.filter((m) => m.op === op),
        /** A status text: every asset made so far (writes 1 when written), every live layer (hidden until lifted), extra lines. */
        statusText(written, extra) {
            const dropped = c.ops.filter((m) => m.op === 'drop').map((m) => m.ref);
            const lines2 = ['upload: cap 5500 KB/s (ceiling 5500, floor 2000): the ceiling', 'target panel: slot 0x203 scene 0x1000400 1920x720: ' + (o.panel || 'idle'),
                'target hud: slot 0x323 scene 0x1000400 800x480: idle'];
            c.ops.filter((m) => m.op === 'asset' && dropped.indexOf(m.ref) < 0).forEach((a) => lines2.push('asset ' + (100 + a.ref) + ' ' + (a.format || 'rgba8') + ' ' + a.w + 'x' + a.h + ' of ' + app + ' on panel: ' + (written ? 1 : 0) + ' writes, 1 KB, 0 failed'));
            c.ops.filter((m) => m.op === 'layer' && dropped.indexOf(m.ref) < 0).forEach((l) => lines2.push('layer ' + (100 + l.ref) + ' effect of ' + app + ' on panel, content z ' + l.z + ': hidden'));
            return lines2.concat(extra || []).join('\n') + '\n';
        },
        reply(written, extra) { c._event({ ev: 'status', text: r.statusText(written, extra) }); },
        /** Answers asks until the build is shown (each stage: confirm, then written). */
        buildAll() { for (let i = 0; i < 20 && !out.status().shown; i++) r.reply(true); },
    };
    return r;
}
const layerOps = (r) => r.ops('layer');
const stageRef = (r, z) => layerOps(r).filter((l) => l.z === z)[0].ref;

module.exports = [
    ['the build, stage 1: assets and pixels, the layer made hidden, then a status; nothing before the first status answer', () => {
        const r = rig();
        r.out.show(FRAME);
        assert.strictEqual(layerOps(r).length, 0, 'nothing before the first status answer');
        r.reply(false);
        const ops = r.c.ops.map((m) => m.op), first = ops.indexOf('layer');
        assert.deepStrictEqual(r.ops('asset').map((a) => [a.format, a.w, a.h, a.sampling]), [['r8', 480, 360, 'bilinear'], ['r8', 492, 474, 'nearest'], ['rgba8', 16, 1, 'nearest'], ['r8', 180, 462, 'nearest'], ['r8', 1024, ART.atlas.h, 'nearest']]);
        assert.strictEqual(r.ops('pixels').length, 5, 'every asset\'s pixels whole');
        assert.ok(ops.lastIndexOf('pixels') < first, 'pixels before the layer');
        const l = layerOps(r)[0];
        assert.deepStrictEqual([l.target, l.klass, l.z, l.exclusive, l.contend, l.visible, l.x, l.y, l.w, l.h], ['panel', 'content', 90, false, false, false, 0, 0, 1920, 720]);
        assert.strictEqual(ops[ops.length - 1], 'status', 'a status asked after the make');
        assert.deepStrictEqual(r.ops('bind').length + r.ops('set').length + r.ops('animate').length, 0, 'no bind, lift or animation before the renderer confirms');
        assert.strictEqual(r.out.status().build.state, 'confirming');
    }],
    ['confirmed only by the answer to a status asked after the make; lifted clear (u_alive 0, visible); bound only once every asset is written', () => {
        const r = rig();
        r.out.requestStatus('a second ask, before the make');
        r.out.show(FRAME);
        r.reply(false);                             // the answer to the connect ask: stage 1 made
        const tachs = stageRef(r, 90);
        assert.strictEqual(r.ops('set').length, 0, 'the ask before the make does not confirm it');
        r.reply(false);                             // the answer to the other ask sent before the make: still not confirmed
        assert.strictEqual(r.ops('set').length, 0, 'a status asked before the make (it cannot show a refusal of it) does not confirm it');
        r.reply(false);                             // the answer to the ask after the make: confirmed, lifted
        const lift = r.c.ops.filter((m) => m.ref === tachs && (m.op === 'set' || m.name === 'u_alive'));
        assert.deepStrictEqual(lift.map((m) => [m.op, m.v === undefined ? m.visible : m.v]), [['uniform', '0'], ['set', true]], 'clear, then visible');
        assert.strictEqual(r.out.status().build.state, 'writing');
        r.reply(false); r.reply(false);             // the assets not written yet: never bound, never shown
        assert.strictEqual(r.ops('bind').length, 0, 'bound before the renderer wrote the art');
        assert.strictEqual(r.out.status().shown, false);
        r.reply(true);
        assert.deepStrictEqual(r.ops('bind').filter((b) => b.ref === tachs).map((b) => b.sampler), ['u_bg', 'u_over', 'u_opal', 'u_band', 'u_atlas']);
        assert.ok(layerOps(r).some((l) => l.z === 91 && l.visible === false), 'stage 2 made (hidden) only after stage 1 was bound');
        assert.deepStrictEqual(r.out.status().build.n, 2);
    }],
    ['all four stages in order (tachs, panels, centre, slats), each confirmed and written before the next; shown with u_alive 1, the tachs last; under the memory budget', () => {
        const r = rig();
        r.out.show(FRAME);
        r.buildAll();
        assert.strictEqual(r.out.status().shown, true);
        assert.deepStrictEqual(layerOps(r).map((l) => l.z), [90, 91, 92, 93], 'the stages\' layers, one at a time');
        layerOps(r).forEach((l, i) => {
            const made = r.c.ops.indexOf(l), next = layerOps(r)[i + 1];
            const bound = r.c.ops.findIndex((m, k) => k > made && m.ref === l.ref && (m.op === 'bind' || (m.op === 'uniform' && m.name === 'u_rect')));
            if (next) assert.ok(bound >= 0 && bound < r.c.ops.indexOf(next), 'stage ' + (i + 1) + ' bound before stage ' + (i + 2) + ' made');
        });
        const alive1 = r.c.ops.filter((m) => m.op === 'uniform' && m.name === 'u_alive' && m.v === '1');
        assert.deepStrictEqual(alive1.map((m) => m.ref), [93, 92, 91, 90].map((z) => stageRef(r, z)), 'u_alive 1 on every layer, the opaque tachs last');
        r.ops('animate').forEach((a) => assert.strictEqual(a.keys, cfg.safety.aliveKeys));
        assert.strictEqual(r.ops('animate').length, 4, 'one dead-man animation a layer');
        const mem = r.ops('asset').reduce((b, a) => b + a.w * a.h * (a.format === 'r8' ? 1 : 4) * 2, 0);
        assert.strictEqual(r.ops('asset').length, 11);
        assert.ok(mem <= cfg.memoryBudgetBytes, 'renderer memory ' + mem);
        assert.strictEqual(mem, ST.memoryOf(ART));
        assert.ok(r.lines.some((l) => /^cover: shown \(4 layers, 11 assets, 3\.0 MiB of renderer memory, built in \d+ ms\)$/.test(l)), r.lines.join('\n'));
        assert.deepStrictEqual(r.out.status().build, { state: 'shown', n: 4, of: 4, name: '', word: 'shown', why: '', stop: null });
    }],
    ['the dead-man: a new animation first, then the previous one stopped, every aliveRearmMs while shown; a backward clock jump re-arms at once; none after the drop', () => {
        const r = rig();
        r.out.show(FRAME);
        r.buildAll();
        const t = Date.now(), H = 3600e3, n0 = r.c.ops.length;
        assert.strictEqual(r.out.pump(t + 10), false, 'inside the re-arm period');
        assert.strictEqual(r.out.pump(t + cfg.safety.aliveRearmMs + 5), true);
        const ops = r.c.ops.slice(n0);
        layerOps(r).forEach((l) => {
            const a = ops.filter((m) => m.ref === l.ref && (m.op === 'animate' || m.op === 'stop'));
            assert.deepStrictEqual(a.map((m) => [m.op, m.anim]), [['animate', 2], ['stop', 1]], 'new first, then the old one: z ' + l.z);
        });
        assert.ok(!ops.some((m) => m.name === 'u_alive' && m.op === 'uniform'), 'the client\'s value stays 1 (no uniform sent)');
        assert.strictEqual(r.out.pump(t - H), true, 'the clock went back an hour: re-armed at once');
        assert.strictEqual(r.out.pump(t - H + 10), false, 'the period runs from the new time');
        r.out.drop('test');
        assert.strictEqual(r.ops('drop')[0].ref, stageRef(r, 90), 'the opaque tachs dropped first');
        assert.strictEqual(r.out.pump(t + 10 * H), false, 'nothing after the drop');
    }],
    ['0.1.6 wireStats: counts pump ticks and the ones that found the socket blocked, then resets; reading it sends nothing', () => {
        const r = rig();
        r.out.show(FRAME);
        r.buildAll();
        const t = Date.now();
        r.out.wireStats();
        r.out.pump(t + 1);
        r.c.blocked = true; r.out.pump(t + 2); r.out.pump(t + 3);
        r.c.blocked = false;
        const n0 = r.c.ops.length;
        assert.deepStrictEqual(r.out.wireStats(), { blocked: 2, ticks: 3 });
        assert.deepStrictEqual(r.out.wireStats(), { blocked: 0, ticks: 0 }, 'reset');
        assert.strictEqual(r.c.ops.length, n0, 'nothing sent');
        r.out.disarm('test');
        r.out.pump(t + 4);
        assert.deepStrictEqual(r.out.wireStats(), { blocked: 0, ticks: 0 }, 'no connection: not counted');
    }],
    ['a refusal at a stage stops the build there: its layers dropped, one fault, status().build names the stage and the reason', () => {
        const r = rig();
        r.out.show(FRAME);
        r.reply(false); r.reply(false); r.reply(true);     // stage 1 bound, stage 2 made
        const panels = stageRef(r, 91);
        r.c._event({ ev: 'error', op: 'layer', ref: panels, reason: 'the shader did not compile' });
        assert.strictEqual(r.faults.length, 1, r.faults.join('\n'));
        assert.ok(/^cluster-render refused layer \d+: the shader did not compile \(stage 2 PANELS\)$/.test(r.faults[0]), r.faults[0]);
        const b = r.out.status().build;
        assert.deepStrictEqual([b.state, b.n, b.of, b.name], ['stopped', 2, 4, 'PANELS']);
        assert.ok(/the shader did not compile/.test(b.why), b.why);
        assert.deepStrictEqual(r.ops('drop').map((d) => d.ref), [stageRef(r, 90), panels], 'every made layer dropped, the tachs first');
        assert.ok(r.lines.some((l) => /^WARN cover: build stopped at stage 2 of 4 PANELS: refused: layer: the shader did not compile$/.test(l)), r.lines.join('\n'));
        r.out.show(FRAME);
        assert.strictEqual(layerOps(r).filter((l) => l.z === 90).length, 2, 'the next show builds again from stage 1');
    }],
    ['a renderer that never writes: the stage stops after stuckMs (an error), naming the unwritten assets; never shown', () => {
        const r = rig();
        r.out.show(FRAME);
        r.reply(false); r.reply(false); r.reply(false);
        assert.strictEqual(r.out.status().build.state, 'writing');
        r.out.tick(Date.now() + cfg.build.stuckMs - 100);
        assert.strictEqual(r.faults.length, 0, 'not before stuckMs');
        r.out.tick(Date.now() + cfg.build.stuckMs + 10);
        assert.strictEqual(r.faults.length, 1);
        assert.ok(/^cluster-render: cover stage 1 TACHS its art not written \(5 of 5 assets unwritten, 0 failed writes\) after 10 s; panel /.test(r.faults[0]), r.faults[0]);
        assert.strictEqual(r.out.status().shown, false);
        assert.strictEqual(r.out.status().build.state, 'stopped');
    }],
    ['the renderer\'s pixel memory: a stage whose assets would not fit is not sent; stopped, naming who holds it', () => {
        const r = rig();
        r.out.show(FRAME);
        const waze = ['asset 1 rgba8 1920x720 of robertn_waze_cluster on map: 1 writes, 5400 KB, 0 failed', 'asset 2 rgba8 1088x480 of robertn_waze_cluster on map: 1 writes, 2040 KB, 0 failed'];
        r.reply(false, waze);
        assert.strictEqual(r.ops('asset').length, 0, 'nothing sent');
        assert.strictEqual(layerOps(r).length, 0);
        assert.strictEqual(r.faults.length, 1);
        assert.ok(/stage 1 TACHS not sent: the renderer's pixel memory is full \(14\.5 MiB in use: robertn_waze_cluster 14\.5 MiB, 1\.7 MiB needed\)/.test(r.faults[0]), r.faults[0]);
    }],
    ['another app\'s HUD let go of the shared scene: the build waits cfg.build.handoverMs (3.5 s) before making anything', () => {
        const r = rig();
        r.c._event({ ev: 'target', target: 'hud', state: 'shown', holder: 'none', reason: '' });
        assert.ok(/the HUD is shown/.test(r.out.status().busy), 'busy while their HUD shows');
        r.c._event({ ev: 'target', target: 'hud', state: 'lingering', holder: 'none', reason: '' });
        const t0 = Date.now();
        r.reply(false);
        r.out.show(FRAME);
        assert.strictEqual(r.out.status().build.state, 'handover');
        r.out.tick(t0 + cfg.build.handoverMs - 200);
        assert.strictEqual(layerOps(r).length, 0, 'nothing inside the hand-over');
        r.out.tick(t0 + cfg.build.handoverMs + 50);
        assert.strictEqual(layerOps(r).length, 1, 'stage 1 made after it');
        assert.ok(r.lines.some((l) => /^cover: waiting 3\.\d s for the HUD to let go of the shared scene$/.test(l)), r.lines.join('\n'));
        const r2 = rig();                           // connected while their HUD lingers (its release seen, not its use)
        r2.c._event({ ev: 'target', target: 'hud', state: 'lingering', holder: 'none', reason: '' });
        r2.reply(false);
        r2.out.show(FRAME);
        assert.deepStrictEqual([r2.out.status().build.state, layerOps(r2).length], ['handover', 0], 'a lingering HUD starts the hand-over too');
    }],
    ['live boxes go as coverage + palette index in two rects, only the changed box; a box drawn before stage 2 is its first pixels', () => {
        const r = rig();
        const R = G.RECTS.panelR, px = Buffer.alloc(R.w * R.h * 4);
        for (let i = 0; i < 10; i++) { const k = ((5 + i) * R.w + 7) * 4; px[k] = 0xe2; px[k + 1] = 0x26; px[k + 2] = 0x2a; px[k + 3] = 255; }
        r.out.box('panelR', px);
        r.out.show(FRAME);
        r.buildAll();
        const a = r.ops('asset').filter((x) => x.w === 2 * R.w && x.h === R.h);
        assert.strictEqual(a.length, 2, 'panelL and panelR, twice as wide');
        const first = r.ops('pixels').filter((p) => p.ref === a[1].ref);
        assert.deepStrictEqual(first.map((p) => [p.rects, p.bytes]), [[null, 2 * R.w * R.h]], 'the drawn box whole as its first pixels');
        const px2 = Buffer.from(px);
        px2[((20 * R.w) + 30) * 4 + 3] = 255; px2[((20 * R.w) + 30) * 4] = 0xf2;
        r.out.box('panelR', px2);
        const upd = r.ops('pixels').filter((p) => p.ref === a[1].ref).slice(1);
        assert.deepStrictEqual(upd.map((p) => [p.rects, p.bytes]), [[[{ x: 30, y: 20, w: 1, h: 1 }, { x: R.w + 30, y: 20, w: 1, h: 1 }], 2]], 'one changed pixel: its coverage and its index');
        assert.strictEqual(r.out.box('panelR', px2), 0, 'nothing changed: nothing sent');
        const enc = ST.encodeBox(px, R.w, { x: 7, y: 5, w: 1, h: 1 });
        assert.deepStrictEqual([enc[0], enc[1]], [255, 6 * 17], 'red #e2262a: full coverage, palette index 6');
    }],
    ['step 2\'s three bars: amber u_alive 1 (no animation); green u_alive 1 re-armed new-first; blue exactly 0.1.1\'s (u_alive 0, the same number sent again every 250 ms)', () => {
        const r = rig({ out: { name: 'adam_mtrack-test', label: 'test' } });
        r.out.showTest(2);
        const [amber, green, blue] = layerOps(r).map((l) => l.ref);
        assert.deepStrictEqual(layerOps(r).map((l) => [l.x, l.y, l.w, l.h, l.klass]), [[590, 236, 240, 44, 'content'], [840, 236, 240, 44, 'content'], [1090, 236, 240, 44, 'content']]);
        const of = (ref) => r.c.ops.filter((m) => m.ref === ref && (m.name === 'u_alive' || m.op === 'stop'));
        assert.deepStrictEqual(of(amber).map((m) => [m.op, m.v]), [['uniform', '1']]);
        assert.deepStrictEqual(of(green).map((m) => [m.op, m.v || m.keys]), [['uniform', '1'], ['animate', cfg.safety.aliveKeys]]);
        assert.deepStrictEqual(of(blue).map((m) => [m.op, m.v || m.keys]), [['uniform', '0'], ['animate', cfg.test.oldAliveKeys]]);
        const t = Date.now();
        r.out.pump(t + 300);
        assert.deepStrictEqual(of(green).slice(2).map((m) => [m.op, m.anim]), [['animate', 2], ['stop', 1]], 'green: new first');
        assert.deepStrictEqual(of(blue).slice(2).map((m) => [m.op, m.anim, m.keys]), [['animate', 1, cfg.test.oldAliveKeys]], 'blue: the same number again, no stop');
        assert.deepStrictEqual(of(amber).length, 1, 'amber: nothing more');
    }],
];
