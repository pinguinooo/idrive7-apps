'use strict';
/**
 * geom.js - where the cover is drawn on the 1920 x 720 panel: pure geometry, Node 8, no I/O.
 * The paths are the approved mockup's (iDrive-Apps docs/mockups/mtrack-cluster.html CONFIG.bars, .slots, .centre;
 * right-hand shapes, the left ones are their mirror about x 960) and its spline / arc-length helpers, with the
 * tach scale changed from 0-8 to 0-7: the 7 tick sits where the mockup's 8 tick was (tick8Y), 0 to 1,000 rpm keeps
 * its short first step, and the numerals 0..7 are re-placed along the bar at their ticks' heights.
 * tools/mtrack-art/art.html loads this file, so the art and the live fill agree.
 *
 *   fracOf(rpm, T)      0..1 along the scale (T: config tach)
 *   yOfRpm(rpm, T)      the height of the revs line on the bars (both bars: mirrored, same y)
 *   ticks(T), numerals(T)   every tick / numeral place on the right bar (x, y), mirrored for the left
 *   RECTS               every layer's rect; slotRect(side, half) the side panels' content boxes
 */
const BARS = {
    outer: [[1277, 626], [1287, 612], [1296.5, 585], [1311, 555], [1324.9, 525], [1337.5, 495], [1349.2, 465], [1360.2, 435], [1365.4, 410], [1367.5, 392], [1366.3, 375], [1363, 360], [1357.3, 345], [1348.9, 330], [1338.9, 315], [1328.6, 300], [1317.3, 285], [1305.8, 270], [1293.6, 255], [1280.8, 240], [1267.9, 225], [1253.9, 210], [1241, 197]],
    inner: [[1220, 626], [1231, 612], [1244.2, 585], [1255.5, 555], [1265.8, 525], [1275.3, 495], [1284.1, 465], [1292.5, 435], [1297.7, 405], [1298.1, 390], [1293.7, 360], [1281.7, 330], [1265.6, 300], [1253.6, 285], [1239.6, 255], [1229.8, 240], [1219.9, 225], [1213.5, 210], [1209.5, 198], [1205.5, 186], [1203, 177.5]],
    top: [[1241, 197], [1235, 187], [1225, 180], [1212, 177], [1203, 177.5]],
    tail: [[1203, 177.5], [1183, 175.5], [1163, 174.5], [1144, 174]],
    foot: [[1220, 626], [1194, 607], [1168, 588]],
    tick0Y: 614, tickTopY: 197,         // the 0 tick and the top (7,000 rpm) tick; the mockup's 0 and 8
    // the mockup's numeral centres for 0 2 4 6 8 on its 0-8 scale: how far in from the outer edge a numeral sits,
    // interpolated at each new tick's height
    nums8: [[1209, 610], [1240, 510], [1259, 394], [1233, 286], [1189, 197]],
    numH: 25, numW: 31, numSW: 6.5, tickMajor: 0.45, tickMinor: 0.25,
    capH: 12, glowH: 110, line: 5, gap: 3, line2: 2.4,
};
const MOCK_SCALE_MAX = 8000, MOCK_FIRST = 0.11;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mirrorPt = (p) => [1920 - p[0], p[1]];
const mirror = (pts) => pts.map(mirrorPt);

/** Catmull-Rom through pts, n steps a segment, with the cumulative arc length (the mockup's spline). */
function spline(pts, n) {
    const k = n || 12, out = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
        for (let s = 0; s < k; s++) {
            const t = s / k, t2 = t * t, t3 = t2 * t;
            out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (p2[j] - p0[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * t3)));
        }
    }
    out.push(pts[pts.length - 1].slice());
    const cum = [0];
    for (let i = 1; i < out.length; i++) cum.push(cum[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]));
    return { pts: out, cum, len: cum[cum.length - 1] };
}
/** The point at share f of a path's length, with the unit normal (side 1: into the right bar's band). */
function at(tr, f, side) {
    const sd = side || 1, d = clamp(f, 0, 1) * tr.len;
    let i = 1;
    while (i < tr.cum.length - 1 && tr.cum[i] < d) i++;
    const a = tr.pts[i - 1], b = tr.pts[i], s = (d - tr.cum[i - 1]) / ((tr.cum[i] - tr.cum[i - 1]) || 1);
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return { x: a[0] + dx * s, y: a[1] + dy * s, nx: sd * dy / l, ny: -sd * dx / l };
}
/** x where a path first crosses height y, or null. */
function xAtY(tr, y) {
    for (let i = 1; i < tr.pts.length; i++) {
        const x0 = tr.pts[i - 1][0], y0 = tr.pts[i - 1][1], x1 = tr.pts[i][0], y1 = tr.pts[i][1];
        if ((y0 - y) * (y1 - y) <= 0 && y0 !== y1) return x0 + (x1 - x0) * (y - y0) / (y1 - y0);
    }
    return null;
}
/** Arc length where a path running up the screen reaches height y, clamped to its ends. */
function arcAtY(tr, y) {
    for (let i = 1; i < tr.pts.length; i++) {
        const y0 = tr.pts[i - 1][1], y1 = tr.pts[i][1];
        if ((y0 - y) * (y1 - y) <= 0 && y0 !== y1) return tr.cum[i - 1] + (tr.cum[i] - tr.cum[i - 1]) * (y - y0) / (y1 - y0);
    }
    return y < tr.pts[tr.pts.length - 1][1] ? tr.len : 0;
}

const OUTER = spline(BARS.outer), INNER = spline(BARS.inner);
const S0 = arcAtY(OUTER, BARS.tick0Y), STOP = arcAtY(OUTER, BARS.tickTopY);

/** Share of the scale at rpm: 0..firstStep for 0..1,000 rpm, the rest evenly to max; clamped. */
function fracOf(rpm, T) {
    const r = typeof rpm === 'number' && isFinite(rpm) ? rpm : 0;
    if (r <= 1000) return T.firstStep * clamp(r, 0, 1000) / 1000;
    return T.firstStep + (1 - T.firstStep) * (Math.min(r, T.max) - 1000) / (T.max - 1000);
}
/** The point on the right bar's outer edge at rpm (normal into the band). */
const rpmPoint = (rpm, T) => at(OUTER, (S0 + (STOP - S0) * fracOf(rpm, T)) / OUTER.len, 1);
const yOfRpm = (rpm, T) => rpmPoint(rpm, T).y;
const bandWidthAt = (y) => { const xo = xAtY(OUTER, y), xi = xAtY(INNER, y); return xo === null || xi === null ? 40 : Math.abs(xo - xi); };

/** Ticks every tickEvery rpm on the right bar: { rpm, x (outer edge), y, len, major }. */
function ticks(T) {
    const out = [];
    for (let r = 0; r <= T.max; r += T.tickEvery) {
        const p = rpmPoint(r, T), xo = xAtY(OUTER, p.y), major = r % 1000 === 0;
        out.push({ rpm: r, x: xo === null ? p.x : xo, y: p.y, len: bandWidthAt(p.y) * (major ? BARS.tickMajor : BARS.tickMinor), major });
    }
    return out;
}

// the mockup's numeral inset from the outer edge (px), at the heights of its 0 2 4 6 8 ticks
const mockY = (rpm) => at(OUTER, (S0 + (STOP - S0) * (rpm <= 1000 ? MOCK_FIRST * rpm / 1000 : MOCK_FIRST + (1 - MOCK_FIRST) * (rpm - 1000) / (MOCK_SCALE_MAX - 1000))) / OUTER.len, 1).y;
const INSET = BARS.nums8.map((p, k) => [mockY(2000 * k), xAtY(OUTER, mockY(2000 * k)) - p[0], p[1] - mockY(2000 * k)]);
function insetAt(y) {           // [x inset, y offset] interpolated in y (the list runs bottom to top)
    const L = INSET;
    if (y >= L[0][0]) return [L[0][1], L[0][2]];
    for (let i = 1; i < L.length; i++) {
        if (y >= L[i][0]) { const f = (y - L[i - 1][0]) / (L[i][0] - L[i - 1][0]); return [L[i - 1][1] + (L[i][1] - L[i - 1][1]) * f, L[i - 1][2] + (L[i][2] - L[i - 1][2]) * f]; }
    }
    return [L[L.length - 1][1], L[L.length - 1][2]];
}
/** Numerals 0..max/1000 on the right bar: { k, x, y } glyph centres. */
function numerals(T) {
    const out = [];
    for (let k = 0; k <= T.max / 1000; k++) {
        const y = yOfRpm(1000 * k, T), ins = insetAt(y);
        out.push({ k, x: Math.round((xAtY(OUTER, y) - ins[0]) * 10) / 10, y: Math.round((y + ins[1]) * 10) / 10 });
    }
    return out;
}

/* ---------- rects (panel px) ---------- */
const SLOTS = { x0: 1440, x1: 1640, upper: [268, 398], lower: [404, 534] };
const CENTRE = { cx: 967.5, gearY: 394, gearH: 82, gearW: 101, gearSW: 18, lineY: 452, line: [153, 159, 211], speedY: 510, speedH: 52, speedW: 64, speedSW: 11.5,
    unitX: 1075, unitY: 495, stackX: 1047, stackY: 406, tagY: 568 };
const box = (x, y, w, h) => ({ target: 'panel', x, y, w, h });
const flipRect = (r) => box(1920 - r.x - r.w, r.y, r.w, r.h);
const RECTS = {
    tachs: box(0, 0, 1920, 720),               // the tachs layer: the whole panel, opaque (background, bars, fill, numerals)
    band: box(1196, 168, 180, 462),            // the right band (mask), mirrored for the left
    overR: box(1138, 160, 246, 474),           // the bars' edge lines, ticks, red and amber fields (right; mirrored for the left)
    centre: box(748, 220, 440, 376),           // the centre layer: gear, small gear digit, speed, unit, drive-mode tag,
                                               // the line, end caps and stack icon (CENTRE_CELL), the M badge
    badge: box(890, 222, 132, 56),             // the M badge (in the slats' place)
    panelR: box(1400, 262, 260, 278),          // a side panel's content (plates are in the background art)
    cornerL: box(150, 470, 450, 232),          // fuel gauge, range, clock
    cornerR: box(1420, 470, 340, 232),         // oil gauge, outside temperature (0.1.3: ends at 1760, KB-ANY-205's stray label gone)
};
RECTS.overL = flipRect(RECTS.overR);
RECTS.panelL = flipRect(RECTS.panelR);
RECTS.panels = box(150, 262, 1610, 440);       // the panels layer: both side panels and both corners
/** The centre's static line, end caps and stack icon, one atlas cell drawn at this panel rect (tools/mtrack-art/art.html). */
const CENTRE_CELL = { x: 748, y: 400, w: 440, h: 66 };

/** A side panel's content box in panel px. half: 'upper' | 'lower' | 'full'; side -1 left, 1 right. */
function slotRect(side, half) {
    const x0 = side > 0 ? SLOTS.x0 : 1920 - SLOTS.x1, x1 = side > 0 ? SLOTS.x1 : 1920 - SLOTS.x0;
    const ys = half === 'full' ? [SLOTS.upper[0], SLOTS.lower[1]] : SLOTS[half];
    return { side, x0, x1, y0: ys[0], y1: ys[1], cx: (x0 + x1) / 2, cy: (ys[0] + ys[1]) / 2, w: x1 - x0, h: ys[1] - ys[0] };
}

/** Shift Lights' geom.slatBar, for one bar on the panel: its rect (grown by the glow) and the shader dims. */
function slatBar(st) {
    const n = st.perSide, half = st.inner + (n - 1) * st.pitch + st.slat;
    const yt = st.cy - st.h / 2, yb = st.cy + st.h / 2, g = st.glow || 0;
    const x = Math.floor(st.cx - half - g), y = Math.floor(yt - g);
    const rect = box(x, y, Math.ceil(st.cx + half + g) - x, Math.ceil(yb + g) - y);
    return { rect, style: st, local: { cx: st.cx - rect.x, yb: yb - rect.y },
        dims: { slat: st.slat, pitch: st.pitch, inner: st.inner, centre: st.centre || 0, h: st.h, shear: st.shear, perSide: n, half } };
}

/**
 * The centre block's glyph quads (the mockup's gearBlock), in the glyph layer's rect: [{ dst: [x, y, w, h], src: [x, y,
 * intensity, 0] }], at most 7. atlas: art.json's atlas table. f: { gear ('P' 'R' 'N' 'D', else none), gearNo (the
 * small digit beside D, 1-8), speed (whole number shown, or null: a dash), unit ('mph' | 'km/h'), tag (a drive-mode tag) }.
 */
function centreQuads(atlas, f) {
    const R = RECTS.centre, X = CENTRE.cx, out = [];
    const put = (cell, x, y, k) => { if (cell) out.push({ dst: [Math.round(x - R.x), Math.round(y - R.y), cell.w, cell.h], src: [cell.x, cell.y, k, 0] }); };
    const gs = atlas.styles.gear, ss = atlas.styles.small, sp = atlas.styles.speed;
    const g = typeof f.gear === 'string' && gs.glyphs[f.gear] ? f.gear : '-';
    const gc = gs.glyphs[g], gw = gc.adv + gs.sw;
    put(gc, X - gc.adv / 2 - gc.ox, CENTRE.gearY - gc.h / 2, 1);
    if (g === 'D' && typeof f.gearNo === 'number' && f.gearNo >= 1 && f.gearNo <= 8 && Math.floor(f.gearNo) === f.gearNo) {
        const c = ss.glyphs[String(f.gearNo)], yc = CENTRE.gearY + CENTRE.gearH * 0.22;
        put(c, X - gw / 2 - 18 - c.adv - ss.sw / 2 - c.ox, yc - c.h / 2, 0.92);
    }
    const s = typeof f.speed === 'number' && isFinite(f.speed) ? String(Math.max(0, Math.min(999, Math.round(f.speed)))) : '-';
    const cells = s.split('').map((ch) => sp.glyphs[ch]);
    let x = X - (cells.reduce((a, c) => a + c.adv + sp.gap, -sp.gap)) / 2;
    cells.forEach((c) => { put(c, x - c.ox, CENTRE.speedY - c.h / 2, 1); x += c.adv + sp.gap; });
    const u = atlas.labels[f.unit] || atlas.labels.mph;
    put(u, CENTRE.unitX - u.ox, CENTRE.unitY - u.h / 2, 0.92);
    const t = atlas.tags[f.tag];
    if (t) put(t, X - t.w / 2, CENTRE.tagY - t.h / 2, 0.92);   // 0.1.5: near-white, as BMW's (was a grey 0.6)
    return out;
}

/**
 * The tachs' numerals 0..7 on both bars, from the atlas's bar style: [{ dst: [x, y, w, h] (panel px, whole), src: [x, y]
 * (atlas px) }], the right bar's 8 then the left's (placed at the mirror of each centre, the glyph itself not mirrored).
 */
function barNumeralQuads(atlas, T) {
    const st = atlas.styles.bar, out = [];
    [1, -1].forEach((side) => numerals(T).forEach((n) => {
        const c = st.glyphs[String(n.k)], cx = side > 0 ? n.x : 1920 - n.x;
        out.push({ dst: [Math.round(cx - c.adv / 2 - c.ox), Math.round(n.y - c.h / 2), c.w, c.h], src: [c.x, c.y] });
    }));
    return out;
}

module.exports = {
    centreQuads, barNumeralQuads, CENTRE_CELL,
    BARS, CENTRE, SLOTS, RECTS, spline, at, xAtY, arcAtY, mirror, mirrorPt, fracOf, rpmPoint, yOfRpm, ticks, numerals,
    bandWidthAt, slotRect, slatBar, flipRect, OUTER, INNER,
};
