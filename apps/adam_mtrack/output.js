'use strict';
/**
 * output.js - the cover on the cluster's `panel` target, through one cluster-render client (adam_mtrack; the test
 * ladder makes its own, adam_mtrack-test, with deadman false).
 *
 *   const out = createOutput({ ClusterRender, socketPath, log, cfg, guard, art, fault, diag, name, label, deadman, layers });
 *   out.arm(units)     connect and upload the assets the chosen layers sample (all 10 for the cover: art for 'us' or
 *                      'metric' and the four live boxes), once per arm, logged as "upload at arm: <bytes>"; true when it
 *                      armed (false: already armed for those units). Assets alone never make the target wanted.
 *   out.show(frame)    make the layers (o.layers, default all 8): the base (overlay, z cfg.zBase, exclusive: every layer
 *                      below it, Shift Lights' slats included, is suspended while it is drawn) and the glyphs, badge,
 *                      slats, side panels and corners above it. Nothing is uploaded but the live boxes' changes.
 *   out.showTest(n)    test steps 1 to 3 (ladder.js): 1 two bars (amber plain, blue through the dead-man), 2 a
 *                      whole-panel tint, 3 a test card as an image layer and as an asset sampled by an effect
 *   out.update(frame)  uniforms, only those that changed
 *   out.box(name, px)  a live box's new pixels (panelL, panelR, cornerL, cornerR): only the changed rows' box goes
 *   out.tick(now)      while shown: restarts every layer's u_alive animation each aliveResendMs (the dead-man switch:
 *                      the renderer blanks the cover 1.2 s after the last restart if the app hangs); a release check's
 *                      deadline
 *   out.drop(why)      cr.drop of every layer, in one call: removed, not hidden. The release is then checked on this
 *                      connection: the panel must go idle within cfg.renderer.verifyMs and the status must list none
 *                      of our layers (logged, status().release)
 *   out.disarm(why)    drop, then close the connection (the service removes its assets with it); main.js checks that
 *                      release with a watcher (renderer.verifyRelease). Returns whether it was armed.
 *   out.requestStatus(why)  the service's status text, parsed into status().renderer (logged when why is given)
 *   out.status()       { link, armed, units, shown, target, holder, reason, rendering, uploaded, targets, cap, lastError,
 *                        layers ({ state: count }), busy, warm, others, release, renderer }
 * frame = { yr, quads (geom.centreQuads), slats: { lit, flashing } | null, badge (bool), level (brightness 0..1) }
 * A refused message or a layer error goes to fault(text): main.js counts it as a safety error (the cover drops).
 */
const zlib = require('zlib');
const S = require('./shader');
const G = require('./geom');
const RD = require('./renderer');

const TINT = [0.97, 0.98, 1];
const PANEL = { target: 'panel' };
const LAYERS = ['base', 'glyphs', 'badge', 'slats', 'panelL', 'panelR', 'cornerL', 'cornerR'];
const NEEDS = { base: ['lum', 'band', 'overR', 'overL'], glyphs: ['atlas'], badge: ['badge'], panelL: ['panelL'], panelR: ['panelR'], cornerL: ['cornerL'], cornerR: ['cornerR'] };
const BOX = ['panelL', 'panelR'];                // live boxes that start empty (the corners start from their art)
/** Test steps 1 and 2: plain effect rects, no asset. A bar with alive takes the cover's dead-man animation. */
const TEST_RECTS = {
    1: [{ x: 690, y: 236, w: 260, h: 44, color: [1, 0.66, 0.06, 1] }, { x: 970, y: 236, w: 260, h: 44, color: [0.15, 0.55, 1, 1], alive: true }],
    2: [{ x: 0, y: 0, w: 1920, h: 720, color: [0.1, 0.45, 1, 0.3] }],
};
const CARD = { w: 256, h: 128, y: 296, xImage: 684, xAsset: 980 };

/** A w x h RGBA test card: 16 px checks of colours a and b inside a 4 px white border. */
function card(w, h, a, b) {
    const px = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const c = x < 4 || y < 4 || x >= w - 4 || y >= h - 4 ? [255, 255, 255] : ((x >> 4) + (y >> 4)) % 2 ? a : b, i = (y * w + x) * 4;
            px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
        }
    }
    return px;
}

function createOutput(o) {
    const cfg = o.cfg, log = o.log, guard = o.guard, fault = o.fault || (() => {}), diag = o.diag || (() => {});
    const name = o.name || 'adam_mtrack', label = o.label || 'cover', deadman = o.deadman !== false, RC = cfg.renderer;
    const want = (o.layers || LAYERS).filter((n) => LAYERS.indexOf(n) >= 0);
    const assetNames = [].concat.apply([], want.map((n) => NEEDS[n] || []));
    const slatGeom = G.slatBar(cfg.row);
    let cr = null, link = 'none', armedUnits = null, uploaded = 0, shown = false;
    let assets = {}, layers = {}, lastAlive = -Infinity, flash = -1, flashAnim = 0;
    let targets = {}, layerSt = {}, lastError = null, cap = null, renderer = null, statusWhy = '', check = null, release = null;
    let mineTill = 0;                   // after our own drop the panel's state is still ours until it says lingering or idle
    const boxes = { panelL: null, panelR: null, cornerL: null, cornerR: null }, sent = {};
    const decoded = {};

    const item = (n) => (o.art.items || []).filter((x) => x.name === n)[0];
    function pixelsOf(n) {
        if (!decoded[n]) {
            const it = item(n);
            if (!it) throw new Error('art.json has no ' + n);
            const px = zlib.inflateRawSync(Buffer.from(it.data, 'base64'));
            if (px.length !== it.w * it.h * (it.format === 'r8' ? 1 : 4)) throw new Error('art.json ' + n + ': ' + px.length + ' bytes');
            decoded[n] = px;
        }
        return decoded[n];
    }

    const summary = (st) => Object.keys(st.targets).filter((t) => t === 'panel' || t === 'hud').map((t) => t + ' ' + st.targets[t].state + (st.targets[t].reason ? ' (' + st.targets[t].reason + ')' : '') + (st.targets[t].rendering ? '; ' + st.targets[t].rendering : ''))
        .concat(st.layers.filter((l) => l.target === 'panel' || l.target === 'hud').map((l) => l.app + ' ' + l.kind + ' on ' + l.target + ' ' + l.state + (l.reason ? ' - ' + l.reason : ''))).join(', ');
    function finishCheck(v) {
        const c0 = check;
        check = null;
        v.ms = Date.now() - c0.at;
        const text = RD.verdictText(v, c0.why);
        if (v.ok) log.info(text); else log.warn(text);
        diag(text);
        release = Object.assign(v, { text, short: RD.verdictShort(v), why: c0.why, at: Date.now() });
    }
    function onEvent(ev) {
        if (ev.ev === 'target') {
            const was = targets[ev.target] || {}, t = { state: ev.state, holder: ev.holder || '', reason: ev.reason || '', rendering: ev.rendering || '' };
            targets[ev.target] = t;
            const changed = was.state !== t.state || was.holder !== t.holder || was.reason !== t.reason || was.rendering !== t.rendering;
            if ((ev.target === 'panel' || ev.target === 'hud') && changed) {
                log.info('cluster-render: target ' + ev.target + ' ' + t.state + (t.holder && t.holder !== 'none' ? ' holder ' + t.holder : '') + (t.reason ? ' (' + t.reason + ')' : '') +
                    (t.rendering && t.rendering !== 'none' ? ', rendering ' + t.rendering : ''));
            }
            if (ev.target === 'panel' && (t.state === 'idle' || t.state === 'lingering')) mineTill = 0;
            if (check && !check.asked && ev.target === 'panel' && (t.state === 'idle' || t.state === 'unavailable')) { check.asked = true; requestStatus('release check'); }
        } else if (ev.ev === 'layer') {
            layerSt[ev.ref] = { state: ev.state, reason: ev.reason || '' };
        } else if (ev.ev === 'budget') {
            if (cap !== ev.cap_kb_per_s) log.info('cluster-render: upload cap ' + ev.cap_kb_per_s + ' KB/s' + (ev.reason ? ' (' + ev.reason + ')' : ''));
            cap = ev.cap_kb_per_s;
        } else if (ev.ev === 'error') {
            lastError = { op: ev.op, ref: ev.ref, reason: ev.reason, at: Date.now() };
        } else if (ev.ev === 'status') {
            renderer = RD.parseStatus(ev.text);
            if (statusWhy) log.info('cluster-render status (' + statusWhy + '): ' + summary(renderer));
            statusWhy = '';
            if (check && check.asked) finishCheck(RD.verdictOf(renderer));
        }
    }

    function client() {
        const c = new o.ClusterRender(name, o.socketPath);
        link = 'connecting';
        RD.tap(c, diag, guard('cr event', (ev) => { if (cr === c) onEvent(ev); }));
        c.on('ready', guard('cr ready', () => {
            if (cr !== c) return;
            link = 'ready';
            log.info('cluster-render: connected (' + c.backend + ', ' + c.targets + ')' + (name === 'adam_mtrack' ? '' : ' as ' + name));
            requestStatus('connected');
        }));
        c.on('disconnected', guard('cr disconnected', () => { if (cr === c) { link = 'connecting'; targets = {}; log.warn('cluster-render: connection lost, reconnecting'); } }));
        c.on('layer', guard('cr layer', (ref, state, reason) => {
            if (cr !== c) return;
            if (state === 'error') fault('cluster-render: layer ' + ref + ' error' + (reason ? ' (' + reason + ')' : ''));
        }));
        c.on('refused', guard('cr refused', (op, ref, reason) => { if (cr === c) fault('cluster-render refused ' + op + ' ' + ref + ': ' + reason); }));
        c.connect();
        return c;
    }

    function asset(n, format, w, h, px, sampling) {
        const ref = cr.asset({ target: 'panel', format, w, h, sampling: sampling || 'nearest' });
        if (!ref) throw new Error('cluster-render client refused asset ' + n);
        if (!cr.pixels(ref, null, px)) throw new Error('cluster-render client refused the pixels of ' + n);
        assets[n] = ref;
        uploaded += px.length;
        diag('> pixels ' + n + ' (asset ' + ref + ', ' + format + ' ' + w + 'x' + h + '): ' + px.length + ' B');
    }

    function arm(units) {
        const variant = units === 'metric' ? 'metric' : 'us';
        if (cr && armedUnits === variant) return false;
        if (cr) disarm('units changed');
        cr = client();
        armedUnits = variant;
        uploaded = 0;
        release = null;
        assetNames.forEach((n) => {
            if (BOX.indexOf(n) >= 0) { const r = G.RECTS[n]; asset(n, 'rgba8', r.w, r.h, Buffer.alloc(r.w * r.h * 4)); return; }
            const it = item(n === 'cornerR' ? 'cornerR_' + variant : n);
            asset(n, it.format, it.w, it.h, pixelsOf(it.name), it.sampling);
        });
        Object.keys(boxes).forEach((n) => { sent[n] = null; if (boxes[n] && assets[n]) box(n, boxes[n]); });
        log.info((label === 'cover' ? '' : label + ': ') + 'upload at arm: ' + uploaded + ' bytes (' + variant + ', ' + assetNames.length + ' assets)');
        if (uploaded > cfg.uploadBudgetBytes) log.warn('upload at arm is over the budget of ' + cfg.uploadBudgetBytes + ' bytes');
        return true;
    }

    /** A live box's pixels: only the box of changed pixels since the last send goes (nothing when none). */
    function box(n, px) {
        boxes[n] = px;
        const ref = assets[n];
        if (!cr || !ref) return 0;
        const r = G.RECTS[n], w = r.w, last = sent[n];
        let x0 = w, y0 = r.h, x1 = -1, y1 = -1;
        if (!last) { x0 = 0; y0 = 0; x1 = w - 1; y1 = r.h - 1; } else {
            for (let y = 0; y < r.h; y++) {
                const row = y * w * 4;
                for (let x = 0; x < w; x++) {
                    const i = row + x * 4;
                    if (px[i] !== last[i] || px[i + 1] !== last[i + 1] || px[i + 2] !== last[i + 2] || px[i + 3] !== last[i + 3]) {
                        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
                    }
                }
            }
        }
        if (x1 < 0) return 0;
        const rect = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, out = Buffer.alloc(rect.w * rect.h * 4);
        for (let y = 0; y < rect.h; y++) Buffer.from(px.buffer, px.byteOffset + ((rect.y + y) * w + rect.x) * 4, rect.w * 4).copy(out, y * rect.w * 4);
        cr.pixels(ref, [rect], out);
        sent[n] = Buffer.from(px);
        return out.length;
    }

    function uni(l, n, v, opts) {
        const k = n + ':' + v.join(' ');
        if (l.u[n] === k) return;
        l.u[n] = k;
        cr.uniform(l.ref, n, v, opts);
    }
    /** An effect layer; alive: its u_alive runs the dead-man animation (else it is held at 1). */
    function effect(n, rect, z, fs, binds, alive, exclusive) {
        const ref = cr.effect(Object.assign({}, PANEL, { klass: 'overlay', x: rect.x, y: rect.y, w: rect.w, h: rect.h, z, fs }, exclusive ? { exclusive: true } : {}));
        if (!ref) throw new Error('cluster-render client refused layer ' + n);
        const l = layers[n] = { ref, u: {}, anim: 0, alive };
        Object.keys(binds || {}).forEach((smp) => cr.bind(ref, smp, assets[binds[smp]]));
        uni(l, 'u_alive', [alive ? 0 : 1]);
        if (alive) l.anim = cr.animate(ref, { property: 'uniform', name: 'u_alive', keys: cfg.safety.aliveKeys, loop: false, interp: 'linear' });
        return l;
    }
    const layer = (n, spec, fs, binds) => effect(n, spec.rect, spec.z, fs, binds, deadman, spec.exclusive);
    function begun() {
        check = null;                       // the panel is wanted again: an earlier drop's release check is moot
        shown = true;
        flash = -1; flashAnim = 0;
        lastAlive = Date.now();             // each layer's animation was just started in effect()
        log.info('cluster-render: layers ' + Object.keys(layers).map((n) => n + '#' + layers[n].ref).join(', '));
    }

    function show(frame) {
        if (!cr || shown) return;
        const R = G.RECTS, z = cfg.zBase, A = o.art.atlas, f = frame || {}, on = (n) => want.indexOf(n) >= 0;
        if (on('base')) {
            layer('base', { rect: R.base, z, exclusive: true }, S.FS_BASE, { u_lum: 'lum', u_band: 'band', u_overR: 'overR', u_overL: 'overL' });
            uni(layers.base, 'u_bandBox', [R.band.x, R.band.y, R.band.w, R.band.h]);
            uni(layers.base, 'u_overBox', [R.overR.x, R.overR.y, R.overR.w, R.overR.h]);
        }
        if (on('glyphs')) layer('glyphs', { rect: R.glyphs, z: z + 1 }, S.glyphFs(R.glyphs.w, R.glyphs.h, A.w, A.h), { u_atlas: 'atlas' });
        if (on('badge')) layer('badge', { rect: R.badge, z: z + 2 }, S.FS_TEX, { u_tex: 'badge' });
        if (on('slats') && f.slats) {
            layer('slats', { rect: slatGeom.rect, z: z + 3 }, S.FS_SLATS);
            S.slatUniforms(slatGeom, cfg.colors, f.level).forEach((x) => uni(layers.slats, x[0], x[1], x[2]));
        }
        ['panelL', 'panelR', 'cornerL', 'cornerR'].filter(on).forEach((n) => layer(n, { rect: R[n], z: z + 4 }, S.FS_TEX, { u_tex: n }));
        begun();
        update(f);
    }

    /** Test steps 1 to 3 (ladder.js): their own layers on this connection, u_alive held at 1 but for step 1's blue bar. */
    function showTest(n) {
        if (!cr || shown) return;
        const z = cfg.zBase;
        if (TEST_RECTS[n]) {
            TEST_RECTS[n].forEach((r, i) => { const l = effect('test' + n + '_' + i, r, z + i, S.FS_SOLID, null, !!r.alive, false); uni(l, 'u_color', r.color); });
        } else if (n === 3) {
            const ref = cr.image({ target: 'panel', klass: 'overlay', z, x: CARD.xImage, y: CARD.y, w: CARD.w, h: CARD.h });
            if (!ref) throw new Error('cluster-render client refused the test image layer');
            layers.test3_image = { ref, u: {}, anim: 0 };
            const px = card(CARD.w, CARD.h, [40, 110, 255], [230, 236, 255]);
            cr.pixels(ref, null, px);
            uploaded += px.length;
            diag('> pixels test card (image ' + ref + ', rgba8 ' + CARD.w + 'x' + CARD.h + '): ' + px.length + ' B');
            asset('card', 'rgba8', CARD.w, CARD.h, card(CARD.w, CARD.h, [255, 140, 20], [255, 236, 214]));
            const l = effect('test3_asset', { x: CARD.xAsset, y: CARD.y, w: CARD.w, h: CARD.h }, z + 1, S.FS_TEX, { u_tex: 'card' }, false, false);
            uni(l, 'u_tint', [1, 1, 1, 1]); uni(l, 'u_bright', [1]);
        } else return;
        begun();
    }

    function update(frame) {
        if (!cr || !shown) return;
        const f = frame || {}, lv = typeof f.level === 'number' ? f.level : 1;
        if (layers.base) {
            uni(layers.base, 'u_tint', TINT.concat([lv]));
            uni(layers.base, 'u_fill', [Math.round((typeof f.yr === 'number' ? f.yr : 720) * 10) / 10, G.BARS.capH / 2, G.BARS.glowH, 0]);
        }
        if (layers.glyphs) {
            const q = (f.quads || []).slice(0, S.QUADS), dst = [], src = [];
            for (let i = 0; i < S.QUADS; i++) { const x = q[i]; Array.prototype.push.apply(dst, x ? x.dst : [0, 0, 0, 0]); Array.prototype.push.apply(src, x ? x.src : [0, 0, 0, 0]); }
            uni(layers.glyphs, 'u_dst', dst, { type: 'vec4' });
            uni(layers.glyphs, 'u_src', src, { type: 'vec4' });
            uni(layers.glyphs, 'u_bright', [lv]);
        }
        if (layers.badge) { uni(layers.badge, 'u_tint', [1, 1, 1, f.badge ? 1 : 0]); uni(layers.badge, 'u_bright', [lv]); }
        ['panelL', 'panelR', 'cornerL', 'cornerR'].filter((n) => layers[n]).forEach((n) => { uni(layers[n], 'u_tint', [1, 1, 1, 1]); uni(layers[n], 'u_bright', [lv]); });
        const sl = layers.slats;
        if (sl && f.slats) {
            const fl = f.slats.flashing ? 1 : 0;
            uni(sl, 'u_st', [f.slats.lit, fl, lv, S.unlitAlpha(cfg.row)]);
            if (fl !== flash) {
                flash = fl;
                if (flashAnim) { cr.stop(sl.ref, flashAnim); flashAnim = 0; }
                if (fl) { const half = Math.round(500 / cfg.flashHz); flashAnim = cr.animate(sl.ref, { property: 'uniform', name: 'u_on', keys: '0:1 ' + half + ':0 ' + (2 * half) + ':1', loop: true, interp: 'step' }); }
            }
        }
    }

    /** Restart one layer's u_alive animation under the same number (PROTOCOL.md: "sending it again replaces it"). */
    function restart(l) {
        const m = { op: 'animate', ref: l.ref, anim: l.anim, property: 'uniform', name: 'u_alive', keys: cfg.safety.aliveKeys, loop: 0, interp: 'linear' };
        if (typeof cr._send === 'function') cr._send(m);      // the pinned client has no public "animate again"
        else { cr.stop(l.ref, l.anim); l.anim = cr.animate(l.ref, { property: 'uniform', name: 'u_alive', keys: cfg.safety.aliveKeys, loop: false, interp: 'linear' }); }
    }
    function tick(now) {
        if (check && !check.asked && (now - check.at >= RC.verifyMs || now < check.at)) { check.asked = true; check.at2 = now; requestStatus('release check after ' + RC.verifyMs / 1000 + ' s'); }
        if (check && check.asked && check.at2 && now - check.at2 >= 2000) finishCheck({ ok: false, ours: 0, panel: 'no status reply', others: [] });
        if (!cr || !shown || (now >= lastAlive && now - lastAlive < cfg.safety.aliveResendMs)) return false;   // a backward clock jump restarts at once (KB-ANY-203)
        lastAlive = now;
        const alive = Object.keys(layers).filter((n) => layers[n].alive);
        alive.forEach((n) => restart(layers[n]));
        return alive.length > 0;
    }

    function drop(why) {
        const names = Object.keys(layers);
        if (cr) names.forEach((n) => cr.drop(layers[n].ref));
        layers = {};
        flashAnim = 0;
        if (shown) log.info(label + ': dropped (' + why + ')');
        shown = false;
        if (cr && names.length) { check = { why, at: Date.now(), asked: false }; mineTill = Date.now() + RC.lingerMs + 6000; }
    }

    function disarm(why) {
        const was = !!cr;
        drop(why);
        check = null;                       // the connection goes with it: main.js checks this release with a watcher
        if (cr) { cr.close(); log.info('cluster-render: closed (' + why + ')' + (name === 'adam_mtrack' ? '' : ' as ' + name)); }
        cr = null; link = 'none'; armedUnits = null; assets = {}; targets = {}; layerSt = {}; renderer = null; mineTill = 0;
        Object.keys(sent).forEach((n) => { sent[n] = null; });
        return was;
    }

    function requestStatus(why) {
        if (!cr || !cr.ready) return false;
        if (why) statusWhy = why;
        cr.status();
        return true;
    }

    function layerCounts() {
        const out = {};
        Object.keys(layers).forEach((n) => { const s = layerSt[layers[n].ref], k = s ? s.state + (s.reason ? ' (' + s.reason + ')' : '') : 'sent'; out[k] = (out[k] || 0) + 1; });
        return out;
    }

    return {
        arm, disarm, show, showTest, update, drop, tick, box, requestStatus,
        status: () => {
            const p = targets.panel || {};
            return {
                link, armed: !!cr, units: armedUnits, shown, target: p.state || null, holder: p.holder || null, reason: p.reason || '', rendering: p.rendering || '',
                uploaded, targets, cap, lastError, layers: layerCounts(), busy: cr ? RD.busyOf(targets, shown || Date.now() < mineTill) : '', warm: RD.warmOf(renderer),
                others: RD.othersOn(renderer, ['panel', 'hud']), release, renderer,
            };
        },
    };
}

module.exports = { createOutput, LAYERS, NEEDS, TEST_RECTS, CARD };
