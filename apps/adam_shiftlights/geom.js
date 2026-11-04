'use strict';
/**
 * geom.js - where every style is drawn: pure geometry, no I/O, Node 8 syntax.
 * Ported from docs/mockups/shiftlights-v4-oem.html (slatPoly, rowGap, barHull, stockBlocks) and
 * docs/mockups/hud-m-style.html (barGeom, PATH, at, strip). All points are in their target's pixels.
 *
 *   slatBar(st, scale, target)   a slat bar (config clusterStyles.* / hudStyles.bar) at size `scale`:
 *                                { rect, bar, polys: [{ i, pts }], hull, local: { cx, yb }, dims, style, fits }
 *   bracket(hud, style)          the HUD tach bracket for a HUD style: path, arc length, offsets, gear box, rect
 *   layersFor(cfg, display, sel, warn)   the layers a display mode and the two style selections want
 */
const TARGETS = { panel: [1920, 720], map: [1088, 480], hud: [800, 480] };   // idrive-apps PROTOCOL.md, iDrive 7
const ARC_PTS = 6;          // points inside the bracket's rounded knee (the path has 10 points: FS_BRACKET's u_path)
const PAD = 6;              // px round the bracket's art in its layer rect

const inside = (r, t) => !!TARGETS[t] && r.x >= 0 && r.y >= 0 && r.x + r.w <= TARGETS[t][0] && r.y + r.h <= TARGETS[t][1];

/** A rect of the box x0..x1, y0..y1 grown by pad, whole pixels, cut to the target. */
function rectOf(x0, y0, x1, y1, pad, target) {
    const T = TARGETS[target];
    const x = Math.max(0, Math.floor(x0 - pad)), y = Math.max(0, Math.floor(y0 - pad));
    return { target, x, y, w: Math.min(T[0], Math.ceil(x1 + pad)) - x, h: Math.min(T[1], Math.ceil(y1 + pad)) - y };
}

/**
 * A slat bar. scale multiplies every length about the bar's centre (cx, cy). Slat kk counts from the axis
 * (0 = innermost); its lighting index is kk outward, perSide-1-kk inward; a centre slat has index perSide.
 * fits: the bar itself (glow aside) lies inside the target.
 */
function slatBar(st, scale, target) {
    const k = scale || 1, n = st.perSide;
    const slat = st.slat * k, pitch = st.pitch * k, inner = st.inner * k, centre = (st.centre || 0) * k, h = st.h * k;
    const sh = st.lean === 'none' ? 0 : st.shear * k, same = st.lean === 'same';
    const cx = st.cx, yt = st.cy - h / 2, yb = st.cy + h / 2;
    const half = inner + (n - 1) * pitch + slat;              // axis to the outer edge at the base
    const bar = { x0: cx - half, y0: yt, x1: cx + half + (same ? sh : 0), y1: yb };
    const rect = rectOf(bar.x0, bar.y0, bar.x1, bar.y1, st.glow || 0, target);
    const polys = [];
    for (let kk = 0; kk < n; kk++) {
        const din = inner + kk * pitch, dout = din + slat, i = st.stage ? 0 : st.fill === 'outward' ? kk : n - 1 - kk;
        [-1, 1].forEach((side) => {
            if (same) {         // '/' on both sides: the top edge sits sh to the right
                const a = Math.min(cx + side * din, cx + side * dout), b = Math.max(cx + side * din, cx + side * dout);
                polys.push({ i, pts: [[a, yb], [b, yb], [b + sh, yt], [a + sh, yt]] });
            } else {            // mirrored: the top edge moves toward the axis ('/' left, '\' right)
                polys.push({ i, pts: [[cx + side * dout, yb], [cx + side * din, yb], [cx + side * (din - sh), yt], [cx + side * (dout - sh), yt]] });
            }
        });
    }
    if (centre > 0) polys.push({ i: n, pts: [[cx - centre, yb], [cx + centre, yb], [cx + centre + sh, yt], [cx - centre + sh, yt]] });
    const hull = same ? [[cx - half, yb], [cx + half, yb], [cx + half + sh, yt], [cx - half + sh, yt]]
        : [[cx - half, yb], [cx + half, yb], [cx + half - sh, yt], [cx - half + sh, yt]];
    return {
        rect, bar, polys, hull, style: st,
        local: { cx: cx - rect.x, yb: yb - rect.y },
        dims: { slat, pitch, inner, centre, h, shear: sh, perSide: n, half },
        fits: bar.x0 >= 0 && bar.y0 >= 0 && bar.x1 <= TARGETS[target][0] && bar.y1 <= TARGETS[target][1],
    };
}

/** The same layer on the map target (when both displays show): the rect moved by off, y at least off.minY. */
function toMap(rect, off) {
    return { target: 'map', x: rect.x - off.x, y: Math.max(off.minY, rect.y - off.y), w: rect.w, h: rect.h };
}

/** The bracket's path in u: tip, the knee rounded by a quadratic through ARC_PTS points, end (10 points). */
function pathU(B) {
    const a = B.path[0], k = B.path[1], e = B.path[2], r = B.round;
    const d1 = Math.hypot(k[0] - a[0], k[1] - a[1]), d2 = Math.hypot(e[0] - k[0], e[1] - k[1]);
    const p1 = [k[0] - (k[0] - a[0]) / d1 * r, k[1] - (k[1] - a[1]) / d1 * r], p2 = [k[0] + (e[0] - k[0]) / d2 * r, k[1] + (e[1] - k[1]) / d2 * r];
    const pts = [a, p1];
    for (let i = 1; i <= ARC_PTS; i++) {
        const t = i / (ARC_PTS + 1), q = 1 - t;
        pts.push([q * q * p1[0] + 2 * q * t * k[0] + t * t * p2[0], q * q * p1[1] + 2 * q * t * k[1] + t * t * p2[1]]);
    }
    return pts.concat([p2, e]);
}

/**
 * The HUD tach bracket (scene px) for a HUD style: the large style moves it down to clear the bar
 * (bar bottom + below), the others keep the mockup's origin. Never scaled by the size setting.
 */
function bracket(hud, style) {
    const B = hud.bracket, S = B.scale, bar = hud.bar;
    const ox = B.origin[0], oy = style === 'large' ? Math.max(B.origin[1], bar.cy + bar.h / 2 + B.below) : B.origin[1];
    const pts = pathU(B).map((p) => [ox + p[0] * S, oy + p[1] * S]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = cum[cum.length - 1];
    const sOf = (rpm) => Math.min(1, Math.max(0, rpm / B.scaleMax)) * L;
    /** The point s px along the path, with the unit normal toward the bar (below the rail). */
    const at = (s) => {
        const d = Math.min(L, Math.max(0, s));
        let i = 1;
        while (i < cum.length - 1 && cum[i] < d) i++;
        const a = pts[i - 1], b = pts[i], f = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
        const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        return { x: a[0] + dx * f, y: a[1] + dy * f, nx: -dy / l, ny: dx / l };
    };
    const rail = B.rail * S, o0 = (B.rail + B.gapRail) * S, o1 = o0 + B.bar * S;
    const pad = hud.cells.pad * S, numH = B.numH * S, numWd = B.numH / 1.6 * 1.15 * S, numSw = 2.6 * S;
    const nums = [];
    for (let k = 0; k <= B.scaleMax / 1000; k++) {
        const p = at(sOf(k * 1000)), off = (B.numOff + (k === 0 ? 4 : 0)) * S;
        nums.push({ k, x: p.x + p.nx * off + (k === 0 ? 6 : 4) * S, y: p.y + p.ny * off });
    }
    const G = B.gear, gu = G.h / 1.6, gwd = gu * 1.3, gsw = G.h * 0.23;
    const gearBox = { x: Math.floor(G.x - gwd / 2 - gsw - 2), y: Math.floor(G.y - G.h / 2 - gsw - 2) };
    gearBox.w = Math.ceil(G.x + gwd / 2 + gsw + 2) - gearBox.x;
    gearBox.h = Math.ceil(G.y + G.h / 2 + gsw + 2) - gearBox.y;
    // bounds of everything drawn: rail to the cells' outer edge, tick ends, numerals, gear, line, unit label
    const xs = [], ys = [];
    const add = (x, y) => { xs.push(x); ys.push(y); };
    pts.forEach((p, i) => {
        const q = at(cum[i]);
        add(p[0] - q.nx, p[1] - q.ny);
        add(p[0] + q.nx * (o1 + pad + 1), p[1] + q.ny * (o1 + pad + 1));
    });
    nums.forEach((m) => { add(m.x - numWd / 2 - numSw, m.y - numH / 2 - numSw); add(m.x + numWd / 2 + numSw, m.y + numH / 2 + numSw); });
    add(gearBox.x, gearBox.y); add(gearBox.x + gearBox.w, gearBox.y + gearBox.h);
    add(B.line.x0, B.line.y - 1); add(B.line.x1, B.line.y + 1);
    add(B.unitAt[0], B.unitAt[1] - 8 * S); add(B.unitAt[0] + 4.2 * S * B.unit.length, B.unitAt[1] + 4 * S);
    const rect = rectOf(Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys), PAD, 'hud');
    return {
        style, B, S, origin: [ox, oy], pts, cum, L, sOf, at, rail, o0, o1, cells: [o0 - pad, o1 + pad], nums,
        numH, numWd, numSw, gearBox, rect,
        fits: xs.every((x) => x >= 0 && x <= TARGETS.hud[0]) && ys.every((y) => y >= 0 && y <= TARGETS.hud[1]),
    };
}

/**
 * The layer specs for a display mode and the two style selections (logic.readStyle results):
 * [{ key, which, role: 'slats' | 'bracketImg' | 'bracketFill', target, rect, z, geom, style, cells, flash }].
 * Shown on a display: "Show on" includes it and its style is not 'off'. With both shown the cluster goes on
 * the map target (panel and hud share one scene), on the panel when the HUD style is 'off'. A size whose bar
 * does not fit its target falls back to 100 % and calls warn(text).
 */
function layersFor(cfg, display, sel, warn) {
    const out = [], say = typeof warn === 'function' ? warn : () => {};
    const showCl = display === 'cluster' || display === 'both', showHud = display === 'hud' || display === 'both';
    const hudOn = showHud && sel.hud.style !== 'off';
    const sized = (which, st, size, target, map) => {
        const fit = (g) => g.fits && (!map || inside(toMap(g.rect, map), 'map'));
        let g = slatBar(st, size / 100, target);
        if (!fit(g)) { say(which + ' size ' + size + ' % does not fit the ' + (map ? 'map' : target) + ': using 100 %'); g = slatBar(st, 1, target); }
        if (map) g.rect = toMap(g.rect, map);
        return g;
    };
    if (showCl && sel.cluster.style !== 'off' && cfg.clusterStyles[sel.cluster.style]) {
        const map = display === 'both' && hudOn ? cfg.mapOffset : null;
        const g = sized('cluster', cfg.clusterStyles[sel.cluster.style], sel.cluster.size, 'panel', map);
        out.push({ key: 'cluster:slats', which: 'cluster', role: 'slats', target: g.rect.target, rect: g.rect, z: 0, geom: g, style: sel.cluster.style });
    }
    if (hudOn) {
        const hs = sel.hud.style;
        if (hs === 'large' || hs === 'bar') {
            const g = sized('hud', cfg.hudStyles.bar, sel.hud.size, 'hud', null);
            out.push({ key: 'hud:slats', which: 'hud', role: 'slats', target: 'hud', rect: g.rect, z: 2, geom: g, style: hs });
        }
        if (hs === 'large' || hs === 'classic' || hs === 'bracket') {
            const b = bracket(cfg.hudStyles, hs);
            out.push({ key: 'hud:bracketImg', which: 'hud', role: 'bracketImg', target: 'hud', rect: b.rect, z: 0, geom: b, style: hs });
            out.push({ key: 'hud:bracketFill', which: 'hud', role: 'bracketFill', target: 'hud', rect: b.rect, z: 1, geom: b, style: hs,
                cells: hs === 'classic', flash: hs !== 'bracket' });
        }
    }
    return out;
}

module.exports = { TARGETS, slatBar, toMap, bracket, layersFor, inside };
