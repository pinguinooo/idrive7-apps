'use strict';
/**
 * widgets.js - the cover's live boxes, drawn in software into the kit's Canvas (kit/canvas) and sent as asset
 * updates (only the changed rows, output.js): the two side panels and the two corner gauges with the bottom row.
 * Ported from the approved mockup's barWidget, rowsWidget, tyres, gmeter, modeColumn, corner and bottomRow, at the
 * same panel coordinates (each box draws with its rect's origin taken off). The plates, the gauges' scales and
 * their labels are static art (art/art.json); here: values, bars, needles, texts.
 * Values stay in the car's units (C, bar, Nm, kW, km, km/h, l/100km) and are converted only here (units.js).
 * Text is the kit's label face (Ubuntu Sans, width 85, weight 400): measured the closest open face to BMW's cluster
 * text (0.1.5, iDrive-Apps docs/emulator/mtrack-0.1.5/font-pick.md). A degree sign is drawn as a small ring: it
 * measured closer to BMW's bold degree sign than the face's own glyph (0.1.5, fidelity.md).
 *
 *   drawPanel(cv, rect, side, lay, v, u, avail)   lay: logic.layoutOf's side; avail(id): the widget has a signal
 *   drawCorner(cv, rect, side, base, v, u, cfg)   base: the corner's static art (rgba), copied in first
 *   panelKey(lay, v, u, avail) / cornerKey(side, v, u, cfg)   what the box shows, rounded: redraw only on a change
 */
const U = require('./units');
const G = require('./geom');
const C = require('./catalogue');

const SCALES = {
    coolant: { F: [160, 210, 270], C: [70, 100, 130], zone: [0.86, 1] },
    oil: { F: [120, 210, 300], C: [50, 100, 150], zone: [0.86, 1] },
    boost: { psi: [0, 10, 20], bar: [0, 1, 2] },
    torque: { 'lb-ft': [0, 400, 800], Nm: [0, 500, 1000] },
    power: { hp: [0, 200, 400], kW: [0, 150, 300] },
};
const FUEL_ARC = [[182, 488], [175, 518], [176, 552], [189, 588], [214, 617], [250, 636], [298, 645], [330, 646]];
const FUEL_TR = G.spline(FUEL_ARC.slice().reverse()), OIL_TR = G.spline(G.mirror(FUEL_ARC).reverse());
const BOTTOM = { y: 673, rangeX: 300, clockX: 452, tempX: 1450 };
const WHITE = '#f2f5f8', LABEL = '#aeb6c0';
const isNum = U.isNum;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round = (v, d) => (isNum(v) ? Number(v.toFixed(d || 0)) : null);

/** Drawing in panel coordinates on a box's canvas. */
function pen(cv, rect) {
    const X = (x) => x - rect.x, Y = (y) => y - rect.y;
    const g = {
        // y = the text's middle (the mockup's textBaseline 'middle'); the kit draws from the baseline
        text(s, x, y, size, c, align, font) { return cv.text(String(s), X(x), Y(y) + size * 0.36, size, c, { align: align || 'left', font: font || 'label', literal: true }); },
        line(pts, w, c) { for (let i = 1; i < pts.length; i++) cv.line(X(pts[i - 1][0]), Y(pts[i - 1][1]), X(pts[i][0]), Y(pts[i][1]), w, c); },
        rect(x, y, w, h, c) { cv.fillRect(X(x), Y(y), w, h, c); },
        quad(pts, c) { cv.quad(pts.map((p) => [X(p[0]), Y(p[1])]), c); },
        circle(x, y, r, c) { cv.circle(X(x), Y(y), r, c); },
        ring(x, y, r, w, a0, a1, c) { cv.arc(X(x), Y(y), r - w / 2, r + w / 2, a0, a1, c); },
        /** A temperature unit: a small ring and the letter. */
        tempUnit(u, x, y, size, c, align) {
            const s = u.temp === 'F' ? 'F' : 'C', w = cv.textWidth(s, size, { literal: true }) + size * 0.42;
            const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
            g.ring(x0 + size * 0.15, y - size * 0.3, size * 0.13, size * 0.07, 0, 360, c);
            g.text(s, x0 + size * 0.38, y, size, c, 'left');
        },
    };
    return g;
}

/* ---------- side panel widgets ---------- */
function shown(id, v, u) {          // a bar widget's value in the shown unit, or null
    if (id === 'coolant') return U.T(v.coolant, u);
    if (id === 'oil') return U.T(v.oil, u);
    if (id === 'boost') return U.P(v.boost, u);
    if (id === 'torque') return U.TQ(v.torque, u);
    if (id === 'power') return U.PW(v.kw, u);
    if (id === 'fuel') return isNum(v.fuelL) ? v.fuelL : null;
    return null;
}
function scaleOf(id, u, cfg) {
    if (id === 'fuel') return { ends: [0, cfg ? cfg.tankLitres : 65], labels: [['0', 0], ['1/2', 0.5], ['1', 1]], zone: [0, 0.1], unit: '' };
    const S = SCALES[id], key = id === 'coolant' || id === 'oil' ? u.temp : id === 'boost' ? u.press : id === 'torque' ? u.torque : u.power;
    const L = S[key];
    return { ends: [L[0], L[2]], labels: L.map((n, i) => [id === 'boost' && key === 'bar' ? n.toFixed(1) : String(n), i / 2]), zone: S.zone || null, unit: key };
}
function icon(g, kind, x, y) {      // the mockup's small white pictograms (simplified)
    const c = '#e6eaee';
    // 0.1.5: BMW's coolant pictogram (a thermometer stem over two bars) and oil can, at the photo's ink box and weight
    if (kind === 'coolant') { g.rect(x - 3, y - 15, 6, 17, c); g.rect(x - 13, y + 3, 26, 4, c); g.rect(x - 13, y + 9, 26, 3, c); }
    else if (kind === 'oil') { g.quad([[x - 15, y + 6], [x + 9, y + 6], [x + 17, y - 3], [x - 15, y - 3]], c); g.quad([[x - 15, y - 3], [x + 3, y - 3], [x - 1, y - 9], [x - 11, y - 9]], c); }
    else if (kind === 'boost') { g.ring(x, y, 11, 3, 0, 360, c); g.line([[x, y], [x + 7, y - 7]], 3, c); }
    else if (kind === 'fuel') { g.rect(x - 8, y - 12, 13, 22, c); g.line([[x + 5, y - 8], [x + 11, y - 2], [x + 11, y + 8]], 2.5, c); }
    else if (kind === 'torque' || kind === 'power') { g.ring(x, y, 10, 3.4, 0, 360, c); g.text(kind === 'torque' ? 'T' : 'P', x, y + 1, 13, c, 'center', 'bold'); }
}
function barWidget(g, r, id, v, u, cfg) {
    const sc = scaleOf(id, u, cfg), val = shown(id, v, u), y = r.y0 + r.h * 0.6, ty = y - 34, x0 = r.x0 + 8, x1 = r.x1 - 18;
    icon(g, id, r.x0 + 22, ty);
    if (id === 'coolant' || id === 'oil') g.tempUnit(u, r.x1 - 10, ty, 22, '#f2f5f8', 'right');
    else if (sc.unit) g.text(sc.unit, r.x1 - 10, ty, 22, '#f2f5f8', 'right');
    g.line([[x0, y], [x1, y]], 3, [238, 241, 244, 235]);      // 0.1.5: BMW's track is a bright white 3 px line
    if (sc.zone) g.rect(x0 + (x1 - x0) * sc.zone[0], y - 3.5, (x1 - x0) * (sc.zone[1] - sc.zone[0]), 7, '#e2262a');
    if (val === null) g.text('NO DATA', (x0 + x1) / 2, y - 16, 16, LABEL, 'center', 'bold');
    else {
        const f = clamp((val - sc.ends[0]) / (sc.ends[1] - sc.ends[0]), 0, 1);
        if (f > 0.004) g.rect(x0, y - 4, (x1 - x0) * f, 8, '#eef1f4');
        g.rect(x0 + (x1 - x0) * f - 2, y - 9, 4, 18, '#e2262a');
    }
    sc.labels.forEach((l) => { const x = x0 + (x1 - x0) * l[1]; g.line([[x, y - 7], [x, y + 5]], 2.4, '#f2f5f8'); g.text(l[0], x, y + 27, 22, '#f2f5f8', 'center'); });
}
function rowsWidget(g, r, rows) {
    const n = rows.length, step = Math.min(44, r.h / n);
    rows.forEach((row, i) => {
        const y = r.cy + (i - (n - 1) / 2) * step;
        g.text(row[0], r.x0 + 6, y, 18, LABEL, 'left', 'bold');
        g.text(row[1], r.x1 - (row[2] ? 50 : 8), y, 25, WHITE, 'right', 'bold');
        if (row[2]) g.text(row[2], r.x1 - 8, y + 2, 18, '#d9dee4', 'right');
    });
}
const dash = '--';
const fmt = (x, d) => (isNum(x) ? x.toFixed(d || 0) : dash);
function rowsOf(id, v, u, cfg) {
    const t = v.trip || {};
    if (id === 'trip') return [['TRIP', fmt(U.DST(t.km, u), 1), u.dist], ['TIME', isNum(t.h) && isNum(t.m) ? t.h + ':' + (t.m < 10 ? '0' : '') + t.m : dash, 'h'],
        ['AVG SPEED', fmt(U.SPD(t.avgKmh, u)), u.speed], ['AVG', fmt(U.CONS(t.avgL100, u), 1), u.cons]];
    if (id === 'range') return [['RANGE', fmt(U.DST(v.rangeKm, u)), u.dist]];
    if (id === 'consumption') return [['AVG', fmt(U.CONS(t.avgL100, u), 1), u.cons]];
    if (id === 'timer') {
        const tm = v.timer || {};
        return [[u.speed === 'mph' ? '0-60 MPH' : '0-100 KM/H', fmt(tm.last, 1), 's'], ['BEST', fmt(tm.best, 1), 's']];
    }
    if (id === 'warmup') {
        const ok = isNum(v.oil) && v.oil >= cfg.engine.oilWarm, unit = u.temp === 'F' ? 'F' : 'C';
        return [['WARM-UP', ok ? 'READY' : fmt(U.T(v.oil, u)), ok ? '' : unit], ['FULL REVS AT', fmt(U.T(cfg.engine.oilWarm, u)), unit]];
    }
    return [];
}
function tyres(g, r, v, u) {
    const cx = r.cx - 50 * r.side, cy = r.cy + 12, t = v.tyres || {}, p = t.p || [], tc = t.t || [];
    g.ring(cx - 46, r.y0 + 34, 11, 2.5, 0, 360, '#e6eaee');
    g.text(u.press, cx - 28, r.y0 + 34, 24, '#e6eaee', 'left');
    g.tempUnit(u, cx - 4, r.y0 + 62, 21, '#e6eaee', 'center');
    [[-48, -42], [48, -42], [-48, 42], [48, 42]].forEach((d, i) => {
        const ps = U.P(p[i], u), ts = U.T(tc[i], u);
        g.text(ps === null ? dash : u.press === 'psi' ? String(Math.round(ps)) : ps.toFixed(1), cx + d[0], cy + d[1] - 14, 27, WHITE, 'center', 'bold');
        g.text(ts === null ? dash : String(Math.round(ts)), cx + d[0], cy + d[1] + 14, 25, '#dfe4ea', 'center', 'bold');
    });
    const ln = [230, 234, 238, 178];
    g.line([[cx - 72, cy], [cx - 22, cy]], 1.6, ln); g.line([[cx + 22, cy], [cx + 72, cy]], 1.6, ln);
    g.line([[cx, cy - 68], [cx, cy - 26]], 1.6, ln); g.line([[cx, cy + 26], [cx, cy + 68]], 1.6, ln);
    g.line([[cx - 9, cy - 19], [cx + 9, cy - 19], [cx + 9, cy + 19], [cx - 9, cy + 19], [cx - 9, cy - 19]], 2.5, '#3ecf6a');
}
function gmeter(g, r, v) {
    const cx = r.cx, cy = r.cy + 6, R1 = 100, R2 = 66, ringC = [200, 200, 230, 216];
    [[R1, 0.36, '0.6 g'], [R2, 0.62, '0.4 g']].forEach((x) => {
        const gapDeg = x[1] * 180 / Math.PI;
        g.ring(cx, cy, x[0], 2, gapDeg, 360 - gapDeg, ringC);
        g.text(x[2], cx, cy - x[0], 18, '#eef1f4', 'center', 'bold');
    });
    g.line([[cx - R1 - 16, cy], [cx + R1 + 16, cy]], 1.5, [200, 200, 230, 204]);
    g.line([[cx, cy - R1 - 14], [cx, cy + R1 + 14]], 1.5, [200, 200, 230, 204]);
    const pk = v.peaks || {};
    // right, braking (down), left, accelerating (up): the kit's angles run clockwise from 12 o'clock
    [[pk.right, 90], [pk.brake, 180], [pk.left, 270], [pk.accel, 0]].forEach((x) => {
        if (!isNum(x[0])) return;
        g.ring(cx, cy, 30 + 60 * clamp(x[0] / 0.6, 0, 1), 9, x[1] - 31.5, x[1] + 31.5, [130, 130, 200, 191]);
    });
    if (isNum(v.gLat) && isNum(v.gLong)) g.circle(cx + R1 * clamp(v.gLat / 0.6, -1.2, 1.2), cy - R1 * clamp(v.gLong / 0.6, -1.2, 1.2), 9, '#ff6a1a');
}
const MODE_TAG = { sportplus: 'SPORT+', sport: 'SPORT', comfort: 'COMFORT' };
function modeColumn(g, r, v) {
    const lvl = { comfort: 0, sport: 1, sportplus: 2 }[v.mode];
    ['ENGINE', 'CHASSIS', 'STEERING', 'GEARBOX'].forEach((w, i) => {
        const y = r.y0 + 24 + i * 62;
        g.text(w, r.x0 + 6, y, 19, LABEL, 'left', 'bold');
        g.text(MODE_TAG[v.mode] || dash, r.x1 - 6, y, 21, WHITE, 'right', 'bold');
        for (let k = 0; k < 3; k++) g.quad([[r.x0 + 6 + k * 80, y + 30], [r.x0 + 72 + k * 80, y + 30], [r.x0 + 78 + k * 80, y + 22], [r.x0 + 12 + k * 80, y + 22]], k === lvl ? '#f1141d' : [170, 176, 184, 140]);
    });
}
function widget(g, id, r, v, u, avail, cfg) {
    const w = C.get(id);
    if (!w || w.draw === 'none') return;
    if (!avail(id) && w.draw !== 'bar') { g.text('NO DATA', r.cx, r.cy, 20, LABEL, 'center', 'bold'); g.text(w.label, r.cx, r.cy + 28, 16, LABEL, 'center'); return; }
    if (w.draw === 'tyres') tyres(g, r, v, u);
    else if (w.draw === 'gmeter') gmeter(g, r, v);
    else if (w.draw === 'modes') modeColumn(g, r, v);
    else if (w.draw === 'rows') rowsWidget(g, r, rowsOf(id, v, u, cfg));
    else barWidget(g, r, id, avail(id) ? v : {}, u, cfg);
}

/** A side panel: rect = geom RECTS.panelL / panelR, the canvas that size, cleared to transparent. */
function drawPanel(cv, rect, side, lay, v, u, avail, cfg) {
    const g = pen(cv.clear(), rect);
    if (lay.full) widget(g, lay.full, G.slotRect(side, 'full'), v, u, avail, cfg);
    else { widget(g, lay.upper, G.slotRect(side, 'upper'), v, u, avail, cfg); widget(g, lay.lower, G.slotRect(side, 'lower'), v, u, avail, cfg); }
    return cv;
}
/** What a panel shows, rounded as drawn: the panel is redrawn only when this changes. */
function panelKey(lay, v, u, avail, cfg) {
    const ids = lay.full ? [lay.full] : [lay.upper, lay.lower];
    return JSON.stringify(ids.map((id) => {
        const w = C.get(id);
        if (!w || w.draw === 'none') return id;
        const a = avail(id);
        if (w.draw === 'bar') { const s = a ? shown(id, v, u) : null; return [id, a, s === null ? null : round(s, 1)]; }
        if (w.draw === 'rows') return [id, a, rowsOf(id, v, u, cfg)];
        if (w.draw === 'modes') return [id, a, v.mode];
        if (w.draw === 'tyres') { const t = v.tyres || {}; return [id, a, (t.p || []).map((x) => round(U.P(x, u), 1)), (t.t || []).map((x) => round(U.T(x, u)))]; }
        if (w.draw === 'gmeter') { const pk = v.peaks || {}; return [id, a, round(v.gLat, 2), round(v.gLong, 2), round(pk.right, 2), round(pk.brake, 2), round(pk.left, 2), round(pk.accel, 2)]; }
        return id;
    }).concat([u.temp, u.press, u.torque, u.power, u.speed, u.dist, u.cons]));
}

/* ---------- corners and the bottom row ---------- */
function oilFrac(v, u) {
    const t = U.T(v.oil, u), L = SCALES.oil[u.temp];
    return t === null ? null : clamp((t - L[0]) / (L[2] - L[0]), 0, 1);
}
function clockText(v, u) {
    if (!v.clock) return null;
    const h = v.clock.h, m = (v.clock.m < 10 ? '0' : '') + v.clock.m;
    if (u.clock === 24) return { t: h + ':' + m, ap: '' };
    return { t: ((h + 11) % 12 + 1) + ':' + m, ap: h < 12 ? 'am' : 'pm' };
}
function cornerKey(side, v, u, cfg) {
    if (side < 0) {
        const f = isNum(v.fuelL) ? round(clamp(v.fuelL / cfg.tankLitres, 0, 1), 3) : null;
        return JSON.stringify([f, round(U.DST(v.rangeKm, u)), u.dist, clockText(v, u)]);
    }
    const o = oilFrac(v, u);
    return JSON.stringify([o === null ? null : round(o, 3), round(U.T(v.ambient, u)), u.temp]);
}
/** A corner: the static art (base, rgba of the rect) then its needle and the bottom row's live texts. */
function drawCorner(cv, rect, side, base, v, u, cfg) {
    cv.d.set(base);
    const g = pen(cv, rect), Bt = BOTTOM;
    const needle = (tr, sd, f, w, c) => { const p = G.at(tr, f, sd); g.line([[p.x, p.y], [p.x + p.nx * 42, p.y + p.ny * 42]], w, c); };
    if (side < 0) {
        if (isNum(v.fuelL)) needle(FUEL_TR, -1, clamp(v.fuelL / cfg.tankLitres, 0, 1), 6, '#ff2a1f');
        const range = U.DST(v.rangeKm, u);
        g.text(range === null ? dash : String(Math.round(range)), Bt.rangeX - 38, Bt.y, 32, WHITE, 'left');
        g.text(u.dist, Bt.rangeX + 30, Bt.y + 4, 21, WHITE, 'left');
        const ck = clockText(v, u);
        if (ck) { const w = g.text(ck.t, Bt.clockX, Bt.y, 32, WHITE, 'left'); if (ck.ap) g.text(ck.ap, Bt.clockX + w + 6, Bt.y + 4, 21, WHITE, 'left'); }
    } else {
        const o = oilFrac(v, u);
        if (o !== null) needle(OIL_TR, 1, o, 3, [236, 240, 244, 230]);
        const t = U.T(v.ambient, u);
        const w = g.text(t === null ? dash : (t >= 0 ? '+' : '') + Math.round(t), Bt.tempX, Bt.y, 32, WHITE, 'left');
        g.tempUnit(u, Bt.tempX + w + 6, Bt.y + 4, 21, WHITE, 'left');
    }
    return cv;
}

module.exports = { drawPanel, drawCorner, panelKey, cornerKey, shown, scaleOf, rowsOf, oilFrac, clockText, SCALES, MODE_TAG };
