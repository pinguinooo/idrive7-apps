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
const HUD_CROP = [0, 30, 0.7];      // the HUD scene's x, y at the preview box's top-left, and its scale (all 800 px wide)
const MODE_NAME = { comfort: 'COMFORT', sport: 'SPORT', sportplus: 'SPORT+' };
const BOTH_NAME = { hud: 'SHOWING THE HUD', cluster: 'SHOWING THE CLUSTER' };
const CL_NAME = { large: 'M SLATS, LARGE', classic: 'M SLATS, SMALL', row: 'CENTRE ROW', stock: 'STOCK LOOK' };
const HUD_NAME = { large: 'SHIFT BAR + REV BRACKET, LARGE', classic: 'SHIFT BAR + REV BRACKET, SMALL', bar: 'SHIFT BAR ONLY', bracket: 'REV BRACKET + GEAR' };
const fmt = (n) => (G.isNum(n) ? String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '--');
const shade = (hex, k) => [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k)).concat([255]);

/** A slat bar (geom.slatBar) at (dx + x * k, dy + y * k): lit slats filled, unlit ones as dim outlines. */
function slats(cv, t, m, g, state, level, dx, dy, k) {
    const s = k || 1, st = g.style, P = (pts) => pts.map((p) => [dx + p[0] * s, dy + p[1] * s]);
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

/** "HUD: ON" / "HUD: OFF" / "ON, NOT SHOWING" in plain words, and under it the style shown (only when shown). */
function label(cv, t, x, what, name, on, s, more, waiting) {
    cv.text(what + (!on ? ': OFF' : waiting ? ': ON, NOT SHOWING (' + waiting + ' WINS: ONE AT A TIME)' : ': ON'), x, 66, 20, on && !waiting ? t.text : t.dim, { font: 'bold', spacing: 1.5, literal: true });
    if (on && !waiting) cv.text(name + '   ' + s.size + '%' + (s.bright < 100 ? '   BRIGHT ' + s.bright + '%' : '') + (s.night ? '   NIGHT' : '') + (more || ''), x, 92, 18, t.dim, { font: 'bold', spacing: 1, literal: true });
}

function clusterPreview(cv, t, m) {
    const s = m.sel.cluster, b = BOX.cl, on = m.displays.cluster, d = m.displays.display, shown = d === 'cluster' || d === 'both';
    label(cv, t, b[0], 'CLUSTER', CL_NAME[s.style] || s.style, on, s, d === 'both' ? '   CENTRE AREA (EXPERIMENTAL)' : '', on && !shown ? 'HUD' : '');
    cv.strokeRoundRect(b[0], b[1], b[2], b[3], 6, 1, withAlpha(t.tick, 0.5));
    if (!on || !shown || !m.cfg.clusterStyles[s.style]) return;
    const st = m.cfg.clusterStyles[s.style];
    let g = geom.slatBar(st, s.size / 100, 'panel');
    if (!g.fits) g = geom.slatBar(st, 1, 'panel');
    slats(cv, t, m, g, m.states.cluster, L.levelOf(m.cfg, s), b[0] + b[2] / 2 - st.cx, b[1] + b[3] / 2 - st.cy);
}

function hudPreview(cv, t, m) {
    const s = m.sel.hud, b = BOX.hud, k = HUD_CROP[2], dx = b[0] - HUD_CROP[0] * k, dy = b[1] - HUD_CROP[1] * k, C = m.cfg.colors, on = m.displays.hud;
    const d = m.displays.display, shown = d === 'hud' || d === 'both', moved = s.x || s.y ? '   MOVED ' + s.x + ', ' + s.y : '';
    label(cv, t, b[0], 'HUD', HUD_NAME[s.style] || s.style, on, s, moved, on && !shown ? 'CLUSTER' : '');
    cv.strokeRoundRect(b[0], b[1], b[2], b[3], 6, 1, withAlpha(t.tick, 0.5));
    if (!on || !shown || HUD_NAME[s.style] === undefined) return;
    const state = m.states.hud, level = L.levelOf(m.cfg, s), hl = geom.hudLayout(m.cfg, s);
    // the stock speed's centre (hud.centerX): a faint mark under the art
    cv.line(dx + (m.cfg.hud.centerX + s.x) * k, b[1] + b[3] - 14, dx + (m.cfg.hud.centerX + s.x) * k, b[1] + b[3] - 4, 1, withAlpha(t.tick, 0.6));
    if (hl.bar) slats(cv, t, m, hl.bar, state, level, dx, dy, k);
    const br = hl.bracket;
    if (!br) return;
    const lim = s.style !== 'bracket' && state.flashing;
    hudart.drawBracketStatic(cv, br, C, dx, dy, k);
    if (!lim || L.flashOn(m.now, state.flashT0, m.cfg.flashHz)) hudart.drawBracketFill(cv, br, G.isNum(m.rpm) ? m.rpm : 0, lim ? C.R : C.cream, dx, dy, k);
    if (s.style === 'classic' && !lim) hudart.drawCells(cv, br, m.th, state.lit, m.cfg.hudStyles.cells, C, dx, dy, k);
    hudart.drawGear(cv, br, m.gear, C.rail, dx, dy, k);
}

function draw(cv, t, m) {
    G.frame(cv, t, ['Shift Lights'], 0, [m.demo && { text: 'DEMO' }]);
    clusterPreview(cv, t, m);
    hudPreview(cv, t, m);
    cv.text(fmt(m.rpm), CX, 382, 72, t.text, { align: 'center', font: 'num', literal: true });
    cv.text('RPM', CX + 150, 382, 24, t.dim, { font: 'bold' });
    const th = m.th, mt = m.mt;
    const src = m.eff && m.eff.source === 'car' ? ' (CAR)' : ' (SETTING, NO SIGNAL)';
    cv.text((MODE_NAME[mt.mode] || mt.mode) + src + (mt.invalid ? ' (settings ignored)' : '') + '    START ' + fmt(th.start) + '    SHIFT ' + fmt(th.shift) +
        '    LIMIT ' + fmt(th.limit) + (th.capped ? ' (cold)' : ''), CX, 420, 24, th.capped ? t.cold : t.text, { align: 'center', font: 'bold', literal: true });
    const s = m.link;
    const link = s.link === 'none' ? 'none' : s.link + (Object.keys(s.layers).length ? ' (' + Object.keys(s.layers).length + ' layers)' : '');
    const ds = m.displays, tg = (s.targets && s.targets.map) || 'not asked';
    // the car shows the HUD or the cluster, one at a time: say which one wins
    const both = ds.hud && ds.cluster ? '    BOTH ON: ' + (ds.both === 'map' ? 'EXPERIMENTAL CENTRE AREA (MAP ' + String(tg).toUpperCase() + ')' : BOTH_NAME[ds.both] + ' (ONE AT A TIME)') : '';
    cv.text('OIL ' + (G.isNum(m.oil) ? Math.round(m.oil * 1.8 + 32) + ' F' : 'n/a') + '    GEAR ' + (G.isNum(m.gear) && m.gear > 0 ? m.gear : '-') +
        (m.onlySportPlus ? '    ONLY SPORT+' : '') + both + '    LINK ' + link, CX, 452, 20, t.dim, { align: 'center', font: 'bold', literal: true });
    if (m.offReason) {
        cv.fillRect(0, 464, W, 48, withAlpha(m.offReason.indexOf('STOPPED') === 0 ? t.crit : t.warn, 0.22));
        cv.text(m.offReason, CX, 496, 24, m.offReason.indexOf('STOPPED') === 0 ? t.crit : t.warn, { align: 'center', font: 'bold', spacing: 1, literal: true });
    }
}

module.exports = { draw };
