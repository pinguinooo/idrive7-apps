// The cluster-render service's state, rebuilt from the fake service's records (fake_cluster_render.js), as the real
// service keeps it (idrive-apps PROTOCOL.md): layers and assets per connection (gone with it), uniforms, binds,
// set fields, animations (linear and step, looped or held), image and asset pixels (whole, then rects).
// layersAt(S, t) gives what a target draws at time t: class / z / creation order, everything under the top drawn
// exclusive layer suspended, animated uniforms evaluated at t. Used by composite.mjs (PNGs) and view.mjs (live).
export const TARGETS = { panel: [1920, 720], map: [1088, 480], hud: [800, 480] };
const CLASS = { ambient: 0, content: 1, overlay: 2, alert: 3 };

export function createState() { return { layers: new Map(), assets: new Map(), order: 0 }; }

/** Applies one record. pixelsOf(rec) -> Buffer of a frame record's pixels (or null when not kept). */
export function apply(S, m, pixelsOf) {
    const key = m.conn + ':' + m.ref;
    if (m.ev === 'close' || m.ev === 'restart') {
        for (const map of [S.layers, S.assets]) for (const k of Array.from(map.keys())) if (m.ev === 'restart' || k.split(':')[0] === String(m.conn)) map.delete(k);
        return;
    }
    if (m.op === 'layer') {
        const T = TARGETS[m.target] || [0, 0];
        S.layers.set(key, {
            key, conn: m.conn, ref: m.ref, kind: m.kind, target: m.target, x: m.x || 0, y: m.y || 0, w: m.w || T[0], h: m.h || T[1],
            z: m.z || 0, cls: CLASS[m.class] === undefined ? 1 : CLASS[m.class], order: S.order++, fs: m.fs, uniforms: {}, anims: {}, binds: {},
            exclusive: m.exclusive ? 1 : 0, visible: m.visible === undefined ? 1 : m.visible, opacity: m.opacity === undefined ? 1 : m.opacity,
            iw: m.iw || m.w, ih: m.ih || m.h, image: null, version: 0,
        });
    } else if (m.op === 'asset') {
        const bpp = m.format === 'r8' ? 1 : 4;
        S.assets.set(key, { key, conn: m.conn, ref: m.ref, target: m.target, format: m.format || 'rgba8', w: m.w, h: m.h, sampling: m.sampling || 'nearest', bpp, data: Buffer.alloc(m.w * m.h * bpp), version: 0 });
    } else if (m.op === 'drop') {
        if (S.layers.has(key)) S.layers.delete(key);
        else if (S.assets.has(key) && !Array.from(S.layers.values()).some((l) => Object.values(l.binds).indexOf(key) >= 0)) S.assets.delete(key);
    } else if (m.op === 'frame') {
        const as = S.assets.get(key), target = as || S.layers.get(key);
        const px = target && pixelsOf ? pixelsOf(m) : null;
        if (!px) return;
        const w = as ? as.w : target.iw, bpp = as ? as.bpp : 4;
        if (!target.data) target.data = Buffer.alloc(w * (as ? as.h : target.ih) * bpp);
        if (!m.rects.length) px.copy(target.data);
        else {
            let off = 0;
            for (const r of m.rects) for (let y = 0; y < r.h; y++) { px.copy(target.data, ((r.y + y) * w + r.x) * bpp, off, off + r.w * bpp); off += r.w * bpp; }
        }
        target.version++;
    } else {
        const l = S.layers.get(key);
        if (!l) return;
        if (m.op === 'uniform') l.uniforms[m.name] = { v: String(m.v).split(' ').map(Number), type: m.type };
        else if (m.op === 'bind') l.binds[m.sampler] = m.conn + ':' + m.asset;
        else if (m.op === 'set') ['x', 'y', 'w', 'h', 'z', 'opacity', 'visible', 'exclusive'].forEach((f) => { if (m[f] !== undefined) l[f] = m[f]; });
        else if (m.op === 'animate') l.anims[m.anim] = { t0: m.t, name: m.name, property: m.property, keys: m.keys, loop: m.loop, interp: m.interp || 'linear' };
        else if (m.op === 'stop') delete l.anims[m.anim];
    }
}

/** An animation's value at t (ms, the records' clock). */
export function animAt(a, t) {
    const keys = String(a.keys).split(' ').filter(Boolean).map((k) => { const i = k.indexOf(':'); return [Number(k.slice(0, i)), k.slice(i + 1).split(',').map(Number)]; });
    const span = keys[keys.length - 1][0];
    let dt = t - a.t0;
    if (a.loop && span > 0) dt = ((dt % span) + span) % span;
    if (dt <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
        if (dt < keys[i][0]) {
            if (a.interp === 'step') return keys[i - 1][1];
            const f = (dt - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
            return keys[i - 1][1].map((v, j) => v + (keys[i][1][j] - v) * f);
        }
    }
    return keys[keys.length - 1][1];
}

/**
 * What target draws at t: [{ key, kind, x, y, w, h, fs, opacity, uniforms: [[name, v, type]], binds: [[sampler, assetKey]] }].
 * opts.anims false: the renderer plays no animation (a KOMBI that ignores them, or runs its clock behind): every
 * uniform keeps the client's own value (what 0.1.1's cover drew on Adam's car: u_alive 0, nothing).
 */
export function layersAt(S, t, target, opts) {
    const anims = !opts || opts.anims !== false;
    let list = Array.from(S.layers.values()).filter((l) => l.target === (target || 'panel') && l.visible)
        .sort((a, b) => a.cls - b.cls || a.z - b.z || a.order - b.order);
    let top = -1;
    list.forEach((l, i) => { if (l.exclusive) top = i; });
    if (top > 0) list = list.slice(top);
    return list.map((l) => {
        const u = Object.assign({}, l.uniforms);
        if (anims) Object.values(l.anims).forEach((a) => { if (a.property === 'uniform') u[a.name] = { v: animAt(a, t), type: u[a.name] && u[a.name].type }; });
        return { key: l.key, kind: l.kind, x: l.x, y: l.y, w: l.w, h: l.h, fs: l.fs, opacity: l.opacity, iw: l.iw, ih: l.ih, version: l.version,
            uniforms: Object.entries(u).map(([n, x]) => [n, x.v, x.type]), binds: Object.entries(l.binds) };
    });
}

/** Every asset key the list samples. */
export const assetsOf = (list) => Array.from(new Set([].concat.apply([], list.map((l) => l.binds.map((b) => b[1])))));
