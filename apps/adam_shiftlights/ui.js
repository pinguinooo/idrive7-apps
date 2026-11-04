'use strict';
/**
 * ui.js - the centre screen (1600 x 520): five settings pages under header tabs (Home, HUD, Cluster, Behavior, About),
 * drawn from pages.js with the kit's own parts: G.frame tabs, G.button pills, cv.target rows. The kit draws the
 * controller's focus ring and runs a press. Where the kit does not run the screen (Software renderer, Standard
 * layout, no touch routing) there are no page buttons: a read-only Home, and the bar's Settings button opens the
 * HMI's settings list.
 *
 * Drawn only on a change (main.js), never per frame: no live numbers. Only roundRect, strokeRoundRect, circle, text
 * and fillRect (the GPU Recorder and the software Canvas both have them; KB-ANY-198). ASCII text only.
 * act(writes) -> the function a press runs (main.js saves the writes inside safety.guard).
 */
const { withAlpha } = require('./kit/canvas');
const G = require('./kit/gauges');
const P = require('./pages');

const X0 = 40, W = 1520, NOTE_Y = 76, ROW_Y = 92, ROW_H = 62, PITCH = 70, CTL_H = 44;
const PILL_OPT = { font: 'bold', spacing: 1.5 };

const toneOf = (t, tone) => (tone === 'warn' ? t.warn : tone === 'crit' ? t.crit : tone === 'on' ? t.text : t.dim);
const txt = (cv, s, x, y, size, c, o) => cv.text(String(s), x, y, size, c, Object.assign({ literal: true }, o));

/** The kit's settings switch (sheet.js toggle), w x h, dimmed when the row is off. */
function sw(cv, t, x, y, w, h, on, enabled) {
    const S = t.sel || t.accent;
    cv.roundRect(x, y, w, h, h / 2, on ? withAlpha(S, enabled ? 1 : 0.35) : withAlpha('#ffffff', enabled ? 0.16 : 0.08));
    cv.circle(on ? x + w - h / 2 : x + h / 2, y + h / 2, h / 2 - 5, withAlpha('#ffffff', enabled ? 1 : 0.4));
}

/** Pills' widths for texts (G.button's text: upper case, h * 0.4). */
function pillWidths(cv, texts) {
    return texts.map((s) => Math.max(104, Math.ceil(cv.textWidth(String(s).toUpperCase(), CTL_H * 0.4, PILL_OPT)) + 40));
}

/** The control part of a row, right-aligned at xr, centred on cy. Targets left to right. */
function control(cv, t, r, xr, cy, act) {
    const y = cy - CTL_H / 2;
    if (r.kind === 'toggle') { sw(cv, t, xr - 76, cy - 19, 76, 38, r.controls[0].on, r.enabled); return; }
    if (!cv.own) {          // read-only: the value in words (G.button draws nothing there)
        txt(cv, r.value, xr, cy + 8, 22, r.enabled ? t.text : t.dim, { align: 'right', font: 'bold' });
        return;
    }
    if (r.kind === 'pills') {
        const ws = pillWidths(cv, r.controls.map((c) => c.text)), gap = 10;
        let x = xr - ws.reduce((a, b) => a + b + gap, -gap);
        r.controls.forEach((c, i) => {
            G.button(cv, t, x, y, ws[i], CTL_H, c.text, act(c.writes), { key: c.key, primary: c.on, busy: !r.enabled });
            x += ws[i] + gap;
        });
        return;
    }
    stepper(cv, t, r.controls, r.value, xr - STEP_W, y, r.enabled, act);
}

const VAL_W = 176, STEP_W = CTL_H + 8 + VAL_W + 8 + CTL_H;
/** [-] value [+]: an end stays a button (the focus never jumps) drawn dim; a disabled row has no buttons. */
function stepper(cv, t, controls, value, x, y, enabled, act) {
    const btn = (c, bx) => {
        G.button(cv, t, bx, y, CTL_H, CTL_H, ' ', act(c.writes), { key: c.key, busy: !enabled, color: c.end && enabled ? t.dim : undefined });
        // the sign drawn as bars: the button's own text (h * 0.4) is too small for one character
        const col = enabled && !c.end ? t.text : withAlpha(t.dim, 0.7), cx = bx + CTL_H / 2, cy = y + CTL_H / 2;
        cv.fillRect(cx - 8, cy - 1.5, 16, 3, col);
        if (c.text === '+') cv.fillRect(cx - 1.5, cy - 8, 3, 16, col);
    };
    btn(controls[0], x);
    cv.roundRect(x + CTL_H + 8, y, VAL_W, CTL_H, 10, withAlpha('#ffffff', 0.04));
    txt(cv, value, x + CTL_H + 8 + VAL_W / 2, y + CTL_H / 2 + 8, 22, enabled ? t.text : t.dim, { align: 'center', font: 'bold' });
    btn(controls[1], x + CTL_H + 8 + VAL_W + 8);
}

/** One settings row: label, one-line description under it, the control on the right. */
function drawRow(cv, t, r, x, y, w, act) {
    cv.roundRect(x, y, w, ROW_H, 14, withAlpha('#ffffff', 0.05));
    txt(cv, r.label, x + 24, y + 28, 24, r.enabled ? t.text : t.dim);
    txt(cv, r.desc, x + 24, y + 51, 18, t.dim);
    control(cv, t, r, x + w - 18, y + ROW_H / 2, act);
    if (r.kind === 'toggle' && r.enabled && cv.own) cv.target(x, y, w, ROW_H, act(r.controls[0].writes), r.controls[0].key, 14);
}

/** The line under the tabs; a button at its right (e.g. "Turn HUD on"). */
function noteLine(cv, t, v, act) {
    if (!v.note) return;
    txt(cv, v.note, X0 + 4, NOTE_Y, 22, toneOf(t, v.noteTone), { font: 'bold' });
    if (v.noteAction && cv.own) {
        const a = v.noteAction, bw = pillWidths(cv, [a.text])[0];
        G.button(cv, t, X0 + W - bw, NOTE_Y - 34, bw, 40, a.text, act(a.writes), { key: a.key, primary: true });
    }
}

function homePage(cv, t, v, act, own) {
    const S = t.sel || t.accent, top = own ? 52 : 48, ch = 250, cw = (W - 32) / 2;
    v.cards.forEach((c, i) => {
        const x = X0 + i * (cw + 32), y = top;
        cv.roundRect(x, y, cw, ch, 18, withAlpha('#ffffff', 0.05));
        cv.roundRect(x, y, 8, ch, 4, c.on ? S : withAlpha('#ffffff', 0.15));
        txt(cv, c.label, x + 40, y + 54, 26, t.text, { font: 'bold' });
        txt(cv, c.on ? 'ON' : 'OFF', x + 38, y + 150, 72, c.on ? t.text : t.dim, { font: 'bold', spacing: 2 });
        const state = c.on ? c.state.text : own ? 'Press to turn on' : '';
        txt(cv, state, x + 40, y + 206, 22, toneOf(t, c.state.tone), { font: 'bold' });
        sw(cv, t, x + cw - 40 - 112, y + ch / 2 - 28, 112, 56, c.on, true);
        if (own) cv.target(x, y, cw, ch, act(c.controls[0].writes), c.controls[0].key, 18);
    });
    const ry = top + ch + 16;
    drawRow(cv, t, v.rows[0], X0, ry, W, act);
    // status: the drive mode, why nothing shows (if so), and the kill switch
    const sy = ry + ROW_H + 16;
    cv.roundRect(X0, sy, W, ROW_H + 8, 14, withAlpha('#ffffff', 0.05));
    const off = v.status.off, crit = off.indexOf('STOPPED') === 0;
    if (off) {
        cv.roundRect(X0, sy, 8, ROW_H + 8, 4, crit ? t.crit : t.warn);
        txt(cv, off, X0 + 24, sy + 30, 22, crit ? t.crit : t.warn, { font: 'bold' });
        txt(cv, v.status.mode, X0 + 24, sy + 56, 18, t.dim);
    } else txt(cv, v.status.mode, X0 + 24, sy + 43, 22, t.text);
    if (own) {
        const a = v.alloff, bw = 200;
        G.button(cv, t, X0 + W - 18 - bw, sy + 11, bw, 48, a.text, act(a.writes), { key: a.key, color: t.crit });
        txt(cv, 'Kill switch', X0 + W - 18 - bw - 20, sy + 43, 18, t.dim, { align: 'right' });
    } else txt(cv, 'Buttons below: HUD on/off, Cluster on/off, Settings (every setting)', X0 + W - 18, sy + 43, 18, t.dim, { align: 'right' });
}

function displayPage(cv, t, v, act) {
    noteLine(cv, t, v, act);
    v.rows.forEach((r, i) => drawRow(cv, t, r, X0, ROW_Y + i * PITCH, W, act));
}

function behaviorPage(cv, t, v, act) {
    noteLine(cv, t, v, act);
    const lw = 760;
    v.rows.forEach((r, i) => drawRow(cv, t, r, X0, ROW_Y + i * PITCH, lw, act));
    // shift points: a mode a row, first light and shift side by side
    const px = X0 + lw + 20, pw = W - lw - 20, py = ROW_Y, ph = 5 * PITCH - 8;
    cv.roundRect(px, py, pw, ph, 14, withAlpha('#ffffff', 0.05));
    txt(cv, 'Shift points', px + 24, py + 34, 24, t.text, { font: 'bold' });
    const c1 = px + pw - 18 - 2 * STEP_W - 16, c2 = px + pw - 18 - STEP_W;
    txt(cv, 'First light', c1 + STEP_W / 2, py + 34, 18, t.dim, { align: 'center', font: 'bold' });
    txt(cv, 'Shift (all red)', c2 + STEP_W / 2, py + 34, 18, t.dim, { align: 'center', font: 'bold' });
    v.modes.forEach((m, i) => {
        const y = py + 52 + i * 58;
        txt(cv, m.label, px + 24, y + CTL_H / 2 + 8, 24, m.enabled ? (m.invalid ? t.warn : t.text) : t.dim, { font: 'bold' });
        stepper(cv, t, m.start.controls, m.start.value, c1, y, m.enabled, act);
        stepper(cv, t, m.shift.controls, m.shift.value, c2, y, m.enabled, act);
    });
    v.notes.slice(0, 4).forEach((n, i) => txt(cv, n.text, px + 24, py + 52 + 3 * 58 + 30 + i * 26, 18, toneOf(t, n.tone)));
}

function aboutPage(cv, t, v, act) {
    noteLine(cv, t, v, act);
    const lw = 760, h = 5 * PITCH - 8;
    cv.roundRect(X0, ROW_Y, lw, h, 14, withAlpha('#ffffff', 0.05));
    let y = ROW_Y + 34;
    v.blocks.forEach((b, i) => {
        txt(cv, b.title, X0 + 24, y, 22, i === 0 ? t.warn : t.text, { font: 'bold' });
        y += 26;
        b.lines.forEach((l) => { txt(cv, (i === 0 ? '- ' : '') + l, X0 + 24, y, 18, t.dim); y += 22; });
        y += 14;
    });
    const rx = X0 + lw + 20, rw = W - lw - 20;
    txt(cv, 'Screen (rarely needed)', rx + 4, ROW_Y + 30, 22, t.text, { font: 'bold' });
    v.rows.forEach((r, i) => drawRow(cv, t, r, rx, ROW_Y + 44 + i * PITCH, rw, act));
    txt(cv, v.rowsNote, rx + 4, ROW_Y + 44 + 3 * PITCH + 20, 18, t.dim);
}

/** One screen's pages: tab(i) picks a page, draw(cv, t, m, act) draws it. */
function createUi() {
    let page = 0;
    return {
        page: () => page,
        /** Header tab i (from ctx.onTab); anything out of range is ignored. */
        tab(i) { if (typeof i === 'number' && Math.floor(i) === i && i >= 0 && i < P.PAGES.length) page = i; },
        draw(cv, t, m, act) {
            const own = !!cv.own, a = act || (() => () => {});
            if (!own) { G.frame(cv, t, ['Shift Lights'], 0, []); homePage(cv, t, P.view(0, m), a, false); return; }
            G.frame(cv, t, P.PAGES, page, []);
            const v = P.view(page, m);
            if (v.id === 'home') homePage(cv, t, v, a, true);
            else if (v.id === 'behavior') behaviorPage(cv, t, v, a);
            else if (v.id === 'about') aboutPage(cv, t, v, a);
            else displayPage(cv, t, v, a);
        },
    };
}

module.exports = { createUi };
