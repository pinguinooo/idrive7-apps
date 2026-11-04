'use strict';
/**
 * output.js - the cover on the cluster's `panel` target, through one cluster-render client named adam_mtrack.
 *
 *   const out = createOutput({ ClusterRender, socketPath, log, cfg, guard, art, fault });
 *   out.arm(units)     connect and upload every asset (the art for 'us' or 'metric', and the four live boxes):
 *                      once per arm, logged as "upload at arm: <bytes>"; true when it armed (false: already armed
 *                      for those units). Assets alone never make the target wanted.
 *   out.show(frame)    make the layers: the base (overlay, z cfg.zBase, exclusive: every layer below it, Shift
 *                      Lights' slats included, is suspended while it is drawn) and the glyphs, badge, slats,
 *                      side panels and corners above it. Nothing is uploaded.
 *   out.update(frame)  uniforms, only those that changed
 *   out.box(name, px)  a live box's new pixels (panelL, panelR, cornerL, cornerR): only the changed rows' box goes
 *   out.tick(now)      while shown: restarts every layer's u_alive animation each aliveResendMs (the dead-man
 *                      switch: the renderer blanks the cover 1.2 s after the last restart if the app hangs)
 *   out.drop(why)      cr.drop of every layer, in one call: removed, not hidden
 *   out.disarm(why)    drop, then close the connection (the service removes its assets with it)
 *   out.status()       { link, armed, shown, target, holder, uploaded }
 * frame = { yr, quads (geom.centreQuads), slats: { lit, flashing } | null, badge (bool), level (brightness 0..1) }
 * A refused message or a layer error goes to fault(text): main.js counts it as a safety error (the cover drops).
 */
const zlib = require('zlib');
const S = require('./shader');
const G = require('./geom');

const TINT = [0.97, 0.98, 1];
const PANEL = { target: 'panel' };

function createOutput(o) {
    const cfg = o.cfg, log = o.log, guard = o.guard, fault = o.fault || (() => {});
    const slatGeom = G.slatBar(cfg.row);
    let cr = null, link = 'none', armedUnits = null, uploaded = 0, shown = false, target = null, holder = null;
    let assets = {}, layers = {}, lastAlive = -Infinity, flash = -1, flashAnim = 0;
    const boxes = { panelL: null, panelR: null, cornerL: null, cornerR: null }, sent = {};
    const decoded = {};

    const item = (name) => (o.art.items || []).filter((x) => x.name === name)[0];
    function pixelsOf(name) {
        if (!decoded[name]) {
            const it = item(name);
            if (!it) throw new Error('art.json has no ' + name);
            const px = zlib.inflateRawSync(Buffer.from(it.data, 'base64'));
            if (px.length !== it.w * it.h * (it.format === 'r8' ? 1 : 4)) throw new Error('art.json ' + name + ': ' + px.length + ' bytes');
            decoded[name] = px;
        }
        return decoded[name];
    }

    function client() {
        const c = new o.ClusterRender('adam_mtrack', o.socketPath);
        link = 'connecting';
        c.on('ready', guard('cr ready', () => { if (cr === c) { link = 'ready'; log.info('cluster-render: connected (' + c.backend + ', ' + c.targets + ')'); } }));
        c.on('disconnected', guard('cr disconnected', () => { if (cr === c) { link = 'connecting'; target = null; log.warn('cluster-render: connection lost, reconnecting'); } }));
        c.on('target', guard('cr target', (name, state, h) => {
            if (cr !== c || name !== 'panel') return;
            if (state !== target || (h || null) !== holder) log.info('cluster-render: target panel ' + state + (h ? ' holder ' + h : ''));
            target = state; holder = h || null;
        }));
        c.on('layer', guard('cr layer', (ref, state, reason) => {
            if (cr !== c) return;
            if (state === 'error') fault('cluster-render: layer ' + ref + ' error' + (reason ? ' (' + reason + ')' : ''));
        }));
        c.on('refused', guard('cr refused', (op, ref, reason) => { if (cr === c) fault('cluster-render refused ' + op + ' ' + ref + ': ' + reason); }));
        c.connect();
        return c;
    }

    function asset(name, format, w, h, px, sampling) {
        const ref = cr.asset({ target: 'panel', format, w, h, sampling: sampling || 'nearest' });
        if (!ref) throw new Error('cluster-render client refused asset ' + name);
        if (!cr.pixels(ref, null, px)) throw new Error('cluster-render client refused the pixels of ' + name);
        assets[name] = ref;
        uploaded += px.length;
    }

    function arm(units) {
        const variant = units === 'metric' ? 'metric' : 'us';
        if (cr && armedUnits === variant) return false;
        if (cr) disarm('units changed');
        cr = client();
        armedUnits = variant;
        uploaded = 0;
        ['lum', 'band', 'overR', 'overL', 'atlas', 'badge', 'cornerL'].forEach((n) => { const it = item(n); asset(n, it.format, it.w, it.h, pixelsOf(n), it.sampling); });
        const cv = item('cornerR_' + variant);
        asset('cornerR', 'rgba8', cv.w, cv.h, pixelsOf('cornerR_' + variant));
        ['panelL', 'panelR'].forEach((n) => { const r = G.RECTS[n]; asset(n, 'rgba8', r.w, r.h, Buffer.alloc(r.w * r.h * 4)); });
        Object.keys(boxes).forEach((n) => { sent[n] = null; if (boxes[n]) box(n, boxes[n]); });
        log.info('upload at arm: ' + uploaded + ' bytes (' + variant + ')');
        if (uploaded > cfg.uploadBudgetBytes) log.warn('upload at arm is over the budget of ' + cfg.uploadBudgetBytes + ' bytes');
        return true;
    }

    /** A live box's pixels: only the box of changed pixels since the last send goes (nothing when none). */
    function box(name, px) {
        boxes[name] = px;
        const ref = assets[name];
        if (!cr || !ref) return 0;
        const r = G.RECTS[name], w = r.w, last = sent[name];
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
        sent[name] = Buffer.from(px);
        return out.length;
    }

    function uni(l, name, v, opts) {
        const k = name + ':' + v.join(' ');
        if (l.u[name] === k) return;
        l.u[name] = k;
        cr.uniform(l.ref, name, v, opts);
    }
    function layer(name, spec, fs, binds) {
        const ref = cr.effect(Object.assign({}, PANEL, { klass: 'overlay', x: spec.rect.x, y: spec.rect.y, w: spec.rect.w, h: spec.rect.h, z: spec.z, fs }, spec.exclusive ? { exclusive: true } : {}));
        if (!ref) throw new Error('cluster-render client refused layer ' + name);
        const l = layers[name] = { ref, u: {}, anim: 0 };
        Object.keys(binds || {}).forEach((smp) => cr.bind(ref, smp, assets[binds[smp]]));
        uni(l, 'u_alive', [0]);
        l.anim = cr.animate(ref, { property: 'uniform', name: 'u_alive', keys: cfg.safety.aliveKeys, loop: false, interp: 'linear' });
        return l;
    }

    function show(frame) {
        if (!cr || shown) return;
        const R = G.RECTS, z = cfg.zBase, A = o.art.atlas, f = frame || {};
        layer('base', { rect: R.base, z, exclusive: true }, S.FS_BASE, { u_lum: 'lum', u_band: 'band', u_overR: 'overR', u_overL: 'overL' });
        uni(layers.base, 'u_bandBox', [R.band.x, R.band.y, R.band.w, R.band.h]);
        uni(layers.base, 'u_overBox', [R.overR.x, R.overR.y, R.overR.w, R.overR.h]);
        layer('glyphs', { rect: R.glyphs, z: z + 1 }, S.glyphFs(R.glyphs.w, R.glyphs.h, A.w, A.h), { u_atlas: 'atlas' });
        layer('badge', { rect: R.badge, z: z + 2 }, S.FS_TEX, { u_tex: 'badge' });
        if (f.slats) {
            layer('slats', { rect: slatGeom.rect, z: z + 3 }, S.FS_SLATS);
            S.slatUniforms(slatGeom, cfg.colors, f.level).forEach((x) => uni(layers.slats, x[0], x[1], x[2]));
        }
        ['panelL', 'panelR', 'cornerL', 'cornerR'].forEach((n) => layer(n, { rect: R[n], z: z + 4 }, S.FS_TEX, { u_tex: n }));
        shown = true;
        flash = -1; flashAnim = 0;
        lastAlive = Date.now();             // each layer's animation was just started in layer()
        update(f);
        log.info('cluster-render: layers ' + Object.keys(layers).map((n) => n + '#' + layers[n].ref).join(', '));
    }

    function update(frame) {
        if (!cr || !shown) return;
        const f = frame || {}, lv = typeof f.level === 'number' ? f.level : 1;
        uni(layers.base, 'u_tint', TINT.concat([lv]));
        uni(layers.base, 'u_fill', [Math.round((typeof f.yr === 'number' ? f.yr : 720) * 10) / 10, G.BARS.capH / 2, G.BARS.glowH, 0]);
        const q = (f.quads || []).slice(0, S.QUADS), dst = [], src = [];
        for (let i = 0; i < S.QUADS; i++) { const x = q[i]; Array.prototype.push.apply(dst, x ? x.dst : [0, 0, 0, 0]); Array.prototype.push.apply(src, x ? x.src : [0, 0, 0, 0]); }
        uni(layers.glyphs, 'u_dst', dst, { type: 'vec4' });
        uni(layers.glyphs, 'u_src', src, { type: 'vec4' });
        uni(layers.glyphs, 'u_bright', [lv]);
        uni(layers.badge, 'u_tint', [1, 1, 1, f.badge ? 1 : 0]);
        uni(layers.badge, 'u_bright', [lv]);
        ['panelL', 'panelR', 'cornerL', 'cornerR'].forEach((n) => { uni(layers[n], 'u_tint', [1, 1, 1, 1]); uni(layers[n], 'u_bright', [lv]); });
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
        if (!cr || !shown || (now >= lastAlive && now - lastAlive < cfg.safety.aliveResendMs)) return false;   // a backward clock jump restarts at once (KB-ANY-203)
        lastAlive = now;
        Object.keys(layers).forEach((n) => restart(layers[n]));
        return true;
    }

    function drop(why) {
        const names = Object.keys(layers);
        if (cr) names.forEach((n) => cr.drop(layers[n].ref));
        layers = {};
        flashAnim = 0;
        if (shown) log.info('cover: dropped (' + why + ')');
        shown = false;
    }

    function disarm(why) {
        drop(why);
        if (cr) { cr.close(); log.info('cluster-render: closed (' + why + ')'); }
        cr = null; link = 'none'; armedUnits = null; assets = {}; target = null; holder = null;
        Object.keys(sent).forEach((n) => { sent[n] = null; });
    }

    return {
        arm, disarm, show, update, drop, tick, box,
        status: () => ({ link, armed: !!cr, units: armedUnits, shown, target, holder, uploaded }),
    };
}

module.exports = { createOutput };
