'use strict';
/**
 * view.js - the centre screen (1600 x 520): a live preview of what goes to the cluster and the HUD, each in
 * its own style (same geom.js / logic.js / hudart.js as the output), the numbers behind it, and why nothing
 * is sent when it is off. ASCII text only.
 */
const { withAlpha } = require('./kit/canvas');
const G = require('./kit/gauges');
const L = require('./logic');
const geom = require('./geom');
const hudart = require('./hudart');

const W = 1600, CX = 800;
const BOX = { cl: [100, 104, 600, 206], hud: [850, 104, 600, 206] };   // x, y, w, h of the two previews
const HUD_CROP = [100, 84];         // the HUD scene's x, y at the preview box's top-left (600 x 206 of 800 x 480)
const MODE_NAME = { comfort: 'COMFORT', sport: 'SPORT', sportplus: 'SPORT+' };
const SHOW_NAME = { off: 'OFF', cluster: 'CLUSTER', hud: 'HUD', both: 'CLUSTER + HUD' };
const CL_NAME = { large: 'M SLATS LARGE', classic: 'M SLATS CLASSIC', row: 'ROW V3', stock: 'STOCK BLOCKS', off: 'OFF' };
const HUD_NAME = { large: 'BAR + BRACKET LARGE', classic: 'BAR + BRACKET CLASSIC', bar: 'BAR ONLY', bracket: 'BRACKET + GEAR', off: 'OFF' };
const fmt = (n) => (G.isNum(n) ? String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '--');
const shade = (hex, k) => [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k)).concat([255]);

/** A slat bar (geom.slatBar) moved by (dx, dy): lit slats filled, unlit ones as dim outlines. */
function slats(cv, t, m, g, state, level, dx, dy) {
    const st = g.style, P = (pts) => pts.map((p) => [p[0] + dx, p[1] + dy]);
    const outline = (pts) => { const q = P(pts); q.forEach((p, i) => { const r = q[(i + 1) % q.length]; cv.line(p[0], p[1], r[0], r[1], 1.5, withAlpha(t.tick, 0.8)); }); };
    const last = st.palette[st.palette.length - 1];
    if (state.flashing) {
        if (!L.flashOn(m.now, state.flashT0, m.cfg.flashHz)) { g.polys.forEach((p) => outline(p.pts)); return; }
        const hull = !st.stage && st.lean !== 'none';
        (hull ? [{ pts: g.hull }] : g.polys).forEach((p) => cv.quad(P(p.pts), shade(m.cfg.colors[last], level)));
        return;
    }
    g.polys.forEach((p) => {
        const on = st.stage ? state.lit > 0 : p.i < state.lit;
        const letter = st.stage ? st.palette[Math.min(st.palette.length, Math.max(1, state.lit)) - 1] : st.palette[p.i];
        if (on) cv.quad(P(p.pts), shade(m.cfg.colors[letter], level));
        else outline(p.pts);
    });
}

function label(cv, t, x, name, s) {
    const extra = s.style === 'off' ? '' : '    SIZE ' + s.size + '%    BRIGHT ' + s.bright + '%' + (s.night ? '    NIGHT' : '');
    cv.text(name + extra, x, 92, 20, t.dim, { font: 'bold', spacing: 1.5, literal: true });
}

function clusterPreview(cv, t, m) {
    const s = m.sel.cluster, b = BOX.cl;
    label(cv, t, b[0], 'CLUSTER: ' + (CL_NAME[s.style] || s.style), s);
    cv.strokeRoundRect(b[0], b[1], b[2], b[3], 6, 1, withAlpha(t.tick, 0.5));
    if (s.style === 'off' || !m.cfg.clusterStyles[s.style]) return;
    const st = m.cfg.clusterStyles[s.style];
    let g = geom.slatBar(st, s.size / 100, 'panel');
    if (!g.fits) g = geom.slatBar(st, 1, 'panel');
    slats(cv, t, m, g, m.states.cluster, L.levelOf(m.cfg, s), b[0] + b[2] / 2 - st.cx, b[1] + b[3] / 2 - st.cy);
}

function hudPreview(cv, t, m) {
    const s = m.sel.hud, b = BOX.hud, dx = b[0] - HUD_CROP[0], dy = b[1] - HUD_CROP[1], C = m.cfg.colors;
    label(cv, t, b[0], 'HUD: ' + (HUD_NAME[s.style] || s.style), s);
    cv.strokeRoundRect(b[0], b[1], b[2], b[3], 6, 1, withAlpha(t.tick, 0.5));
    if (HUD_NAME[s.style] === undefined || s.style === 'off') return;
    const state = m.states.hud, level = L.levelOf(m.cfg, s);
    if (s.style === 'large' || s.style === 'bar') {
        let g = geom.slatBar(m.cfg.hudStyles.bar, s.size / 100, 'hud');
        if (!g.fits) g = geom.slatBar(m.cfg.hudStyles.bar, 1, 'hud');
        slats(cv, t, m, g, state, level, dx, dy);
    }
    if (s.style === 'bar') return;
    const br = geom.bracket(m.cfg.hudStyles, s.style), lim = s.style !== 'bracket' && state.flashing;
    hudart.drawBracketStatic(cv, br, C, dx, dy, 1);
    if (!lim || L.flashOn(m.now, state.flashT0, m.cfg.flashHz)) hudart.drawBracketFill(cv, br, G.isNum(m.rpm) ? m.rpm : 0, lim ? C.R : C.cream, dx, dy, 1);
    if (s.style === 'classic' && !lim) hudart.drawCells(cv, br, m.th, state.lit, m.cfg.hudStyles.cells, C, dx, dy, 1);
    hudart.drawGear(cv, br, m.gear, C.rail, dx, dy, 1);
}

function draw(cv, t, m) {
    G.frame(cv, t, ['Shift Lights'], 0, [m.demo && { text: 'DEMO' }]);
    clusterPreview(cv, t, m);
    hudPreview(cv, t, m);
    cv.text(fmt(m.rpm), CX, 382, 72, t.text, { align: 'center', font: 'num', literal: true });
    cv.text('RPM', CX + 150, 382, 24, t.dim, { font: 'bold' });
    const th = m.th, mt = m.mt;
    cv.text((MODE_NAME[mt.mode] || mt.mode) + (mt.invalid ? ' (settings ignored)' : '') + '    START ' + fmt(th.start) + '    SHIFT ' + fmt(th.shift) +
        '    LIMIT ' + fmt(th.limit) + (th.capped ? ' (cold)' : ''), CX, 420, 24, th.capped ? t.cold : t.text, { align: 'center', font: 'bold', literal: true });
    const s = m.link;
    const link = s.link === 'none' ? 'none' : s.link + (Object.keys(s.layers).length ? ' (' + Object.keys(s.layers).length + ' layers)' : '');
    cv.text('OIL ' + (G.isNum(m.oil) ? Math.round(m.oil * 1.8 + 32) + ' F' : 'n/a') + '    GEAR ' + (G.isNum(m.gear) && m.gear > 0 ? m.gear : '-') +
        '    SHOW ' + (SHOW_NAME[m.display] || m.display) + '    LINK ' + link, CX, 452, 20, t.dim, { align: 'center', font: 'bold', literal: true });
    if (m.offReason) {
        cv.fillRect(0, 464, W, 48, withAlpha(m.offReason.indexOf('STOPPED') === 0 ? t.crit : t.warn, 0.22));
        cv.text(m.offReason, CX, 496, 24, m.offReason.indexOf('STOPPED') === 0 ? t.crit : t.warn, { align: 'center', font: 'bold', spacing: 1, literal: true });
    }
}

module.exports = { draw };
