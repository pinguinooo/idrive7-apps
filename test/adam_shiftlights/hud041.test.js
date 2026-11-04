'use strict';
/* Shift Lights 0.4.1: the HUD's new defaults (only for fresh installs), the shift bar's own left / right move and its
 * clamp into the visible box, the shift (all red) setting in 100 rpm steps, and the P / R / N gear glyphs. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const G = require('../../apps/adam_shiftlights/geom');
const L = require('../../apps/adam_shiftlights/logic');
const P = require('../../apps/adam_shiftlights/pages');
const hudart = require('../../apps/adam_shiftlights/hudart');
const { Canvas } = require('../../kit/runtime/canvas.js');
const config = require('../../apps/adam_shiftlights/config');
const cfg = L.validateConfig(config).cfg;
const SPEC = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'apps', 'adam_shiftlights', 'app.json'), 'utf8'));
const item = (k) => SPEC.settings.filter((s) => s.key === k)[0];

const V = cfg.hud.visible, M = cfg.hud.barMargin, D = cfg.hud.defaults;
const lay = (size, x, y, barX, style) => G.hudLayout(cfg, { style: style || 'large', size, x, y, barX }, () => {});
const model = (saved) => {
    const vals = {};
    SPEC.settings.forEach((s) => { vals[s.key] = s.default; });
    Object.assign(vals, saved);
    return { get: (k) => vals[k], schema: SPEC.settings, cfg, carMode: null, offReason: '', version: '0.4.1' };
};

module.exports = [
    ['the new HUD defaults: 110 %, 80 px left, 60 px down, bar +70 (app.json and config.js agree)', () => {
        assert.deepStrictEqual(D, { size: 110, x: -80, y: 60, barX: 70 });
        assert.deepStrictEqual(['hudSize', 'hudX', 'hudY', 'hudBarX'].map((k) => item(k).default), [110, -80, 60, 70]);
        assert.deepStrictEqual(item('hudBarX').steps, cfg.nudge.barX);
        assert.ok(cfg.nudge.barX.every((v) => v % 5 === 0) && cfg.nudge.barX.length === 41);
        const r = L.readStyle(cfg, (k) => item(k) && item(k).default, 'hud');
        assert.deepStrictEqual([r.size, r.x, r.y, r.barX, r.warnings], [110, -80, 60, 70, []]);
    }],
    ['defaults are for new installs only: saved values (also 0 and 100) are read as saved; a missing key gets the default', () => {
        const saved = { hudSize: 100, hudX: 0, hudY: 0, hudBarX: 0 };
        const r = L.readStyle(cfg, (k) => saved[k], 'hud');
        assert.deepStrictEqual([r.size, r.x, r.y, r.barX], [100, 0, 0, 0]);
        const adam = { hudSize: 110, hudX: -80, hudY: 60 };
        const a = L.readStyle(cfg, (k) => adam[k], 'hud');
        assert.deepStrictEqual([a.size, a.x, a.y, a.barX], [110, -80, 60, 70], 'barX is new: it starts at the default');
        // the cluster keeps 100 % and no move
        const c = L.readStyle(cfg, () => undefined, 'cluster');
        assert.deepStrictEqual([c.size, c.x, c.y], [100, 0, 0]);
    }],
    ['the settings migration writes none of the HUD size / move keys (saved values are never touched)', () => {
        const writes = L.migrateSettings((k) => ({ enabled: true, display: 'hud', hudStyle: 'large', hudSize: 100, hudX: 0, hudY: 0 }[k]));
        assert.ok(writes.every((w) => !/^hud(Size|X|Y|BarX)$/.test(w[0])), JSON.stringify(writes));
        assert.deepStrictEqual(L.migrateSettings((k) => (k === '_settingsV' ? 3 : undefined)), []);
    }],
    ['at the new defaults the whole shift bar is inside the visible box, margin kept; the bracket and gear are where they were', () => {
        const l = lay(D.size, D.x, D.y, D.barX), b = l.bar.bar;
        assert.ok(b.x0 >= V.x0 + M && b.x1 <= V.x1 - M && b.y0 >= V.y0 && b.y1 <= V.y1, JSON.stringify(b));
        assert.strictEqual(l.barShift.clamped, false);
        // the group move alone leaves the bar's left end near x 2, 58 px outside the box (what Adam saw cut off)
        const l0 = lay(D.size, D.x, D.y, 0), raw0 = l0.bar.bar.x0 - l0.barShift.x;
        assert.ok(Math.abs(raw0 - 2.1) < 0.2 && raw0 < V.x0, 'x0 ' + raw0);
        // the bar move is the bar's alone
        const a = lay(D.size, D.x, D.y, 0), c = lay(D.size, D.x, D.y, D.barX);
        assert.deepStrictEqual([a.bracket.rect, a.bracket.gear, a.bracket.origin], [c.bracket.rect, c.bracket.gear, c.bracket.origin]);
        near(c.bar.bar.x0 - raw0, D.barX, 1e-9, 'the default moves the bar by barX');
        assert.strictEqual(a.barShift.clamped, true, 'with no bar move the clamp has to pull it in (so the default avoids a note on every fresh install)');
        assert.ok(b.y0 >= 90 && lay(D.size, D.x, D.y, D.barX).bracket.fits);
    }],
    ['hud.barX default is the smallest 5 px step that keeps the margin from the visible left edge', () => {
        const l0 = lay(D.size, D.x, D.y, 0), raw0 = l0.bar.bar.x0 - l0.barShift.x;     // the bar's left end with the group move alone
        const okSteps = cfg.nudge.barX.filter((v) => raw0 + v >= V.x0 + M);
        assert.strictEqual(okSteps[0], D.barX);
        assert.ok(raw0 + (D.barX - 5) < V.x0 + M, 'one step less would be inside the margin');
        assert.ok(lay(D.size, D.x, D.y, D.barX).bar.bar.x0 - V.x0 < 20, 'and not further right than needed');
    }],
    ['bar edges stay inside the visible box for every size, HUD move and bar move (clamp); too wide for the box: centred', () => {
        let n = 0, clamped = 0;
        cfg.sizeSteps.forEach((size) => cfg.nudge.x.forEach((x) => cfg.nudge.barX.forEach((barX) => {
            const l = lay(size, x, D.y, barX), b = l.bar.bar, w = b.x1 - b.x0;
            n++;
            if (l.barShift.clamped) clamped++;
            if (w <= V.x1 - V.x0 - 2 * M) assert.ok(b.x0 >= V.x0 + M - 1e-9 && b.x1 <= V.x1 - M + 1e-9, [size, x, barX, b.x0, b.x1].join(' '));
            else near((b.x0 + b.x1) / 2, (V.x0 + V.x1) / 2, 1e-9, 'wide bar centred ' + [size, x, barX]);
            // asked and used differ exactly when it was clamped
            assert.strictEqual(Math.abs(l.barShift.x - barX) > 0.01, l.barShift.clamped, [size, x, barX].join(' '));
        })));
        assert.ok(n > 1000 && clamped > 100 && clamped < n, n + ' ' + clamped);
        // 120 %: 693 px wide, wider than the 680 px box: centred, never cut on one side only
        const w = lay(120, 0, D.y, 0).bar.bar;
        assert.ok(w.x1 - w.x0 > V.x1 - V.x0);
        assert.ok(Math.abs((w.x0 + w.x1) / 2 - 400) < 1e-9);
    }],
    ['clamp: far left asks pull the bar back to the left margin, far right to the right margin; in range is left alone', () => {
        const far = lay(100, -100, 0, -100).bar.bar, farR = lay(100, 100, 0, 100).bar.bar;
        near(far.x0, V.x0 + M, 1e-9, 'left'); near(farR.x1, V.x1 - M, 1e-9, 'right');
        const mid = lay(100, 0, 0, 20);
        assert.strictEqual(mid.barShift.clamped, false);
        near(mid.barShift.x, 20, 1e-9, 'unclamped shift');
        assert.strictEqual(lay(100, -100, 0, -100).barShift.clamped, true);
        // no bar, nothing to clamp; the other styles still lay out
        assert.strictEqual(lay(110, -80, 60, 70, 'bracket').bar, null);
        assert.strictEqual(lay(110, -80, 60, 70, 'bar').bracket, null);
    }],
    ['a layout built without barX behaves as barX 0 (older callers)', () => {
        const a = G.hudLayout(cfg, { style: 'large', size: 100, x: 0, y: 0 }, () => {}), b = lay(100, 0, 0, 0);
        assert.deepStrictEqual(a.bar.bar, b.bar.bar);
    }],
    ['HUD page: a Shift bar left / right row (steps of 5, labelled), a one-line note when the bar was held in, off for styles without a bar', () => {
        const v = P.view(1, model({ hudOn: true }));
        const r = v.rows.filter((x) => x.id === 'hudBarX')[0];
        assert.ok(r && r.enabled && r.label === 'Shift bar left / right');
        assert.deepStrictEqual([r.value, r.controls[0].writes, r.controls[1].writes], ['70 px right', [['hudBarX', 65]], [['hudBarX', 75]]]);
        assert.strictEqual(v.rows.length, 7);
        assert.notStrictEqual(v.noteTone, 'warn');
        const held = P.view(1, model({ hudOn: true, hudX: -100, hudBarX: -100, hudSize: 100 }));
        assert.ok(/held inside the visible area/.test(held.note) && held.noteTone === 'warn', held.note);
        assert.ok(!/held/.test(P.view(1, model({ hudOn: true, hudBarX: 0, hudX: 0, hudY: 0, hudSize: 100 })).note));
        const br = P.view(1, model({ hudOn: true, hudStyle: 'bracket' })).rows.filter((x) => x.id === 'hudBarX')[0];
        assert.strictEqual(br.enabled, false);
        assert.ok(P.controlsOf(P.view(1, model({ hudOn: true, hudStyle: 'bracket' }))).every((c) => !/hudBarX/.test(c.key)));
        assert.ok(P.controlsOf(v).some((c) => c.key === 'hud:hudBarX:+'));
    }],

    // ---- the shift (all red) setting in 100 rpm steps ----
    ['shift (all red) settings: 100 rpm steps from 2,500 to 6,800, every old step kept, the top is the highest one the limiter allows', () => {
        const top = cfg.engine.limitWarm - cfg.engine.shiftBelowLimit;   // 6,850
        ['comfortShift', 'sportShift', 'sportplusShift'].forEach((k) => {
            const s = item(k).steps;
            assert.strictEqual(s[0], 0);
            for (let i = 1; i < s.length; i++) assert.strictEqual(s[i], 2500 + (i - 1) * 100, k + ' ' + i);
            assert.strictEqual(s[s.length - 1], 6800);
            assert.ok(s[s.length - 1] <= top && s[s.length - 1] + L.SHIFT_STEP > top, 'no offered value is above the limiter bound, none below it is missing');
            [2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 6800].forEach((v) => assert.ok(s.indexOf(v) >= 0, k + ' keeps ' + v));
            assert.strictEqual(s.indexOf(6900), -1, '6,900 can never take effect (shift caps at 6,850), so it is no longer offered');
        });
        // every offered value takes effect (first light 2,000 or the value minus 200, warm oil)
        item('sportShift').steps.filter((v) => v).forEach((v) => {
            const mt = L.modeThresholds(cfg, (k) => ({ sportStart: 2000, sportShift: v }[k]), 'sport');
            assert.deepStrictEqual([mt.invalid, mt.shift], [false, v], String(v));
            assert.strictEqual(L.thresholds(cfg, mt, 95).shift, v, 'not capped: ' + v);
        });
    }],
    ['saved shift values: whole 100s as they are; others are taken down to 100 (6,850 -> 6,800); 6,900 and 0 behave as before; no migration', () => {
        const t = (v) => L.modeThresholds(cfg, (k) => (k === 'sportShift' ? v : undefined), 'sport');
        assert.deepStrictEqual([t(6500).shift, t(6800).shift, t(6850).shift, t(6849).shift, t(6750).shift], [6500, 6800, 6800, 6800, 6700]);
        assert.deepStrictEqual([t(6500).invalid, t(6850).invalid], [false, false]);
        assert.strictEqual(t(6900).invalid, true);            // still over the limiter bound: falls back to the defaults, flagged
        assert.deepStrictEqual([t(0).shift, t(undefined).shift, t('x').shift, t(-5).shift], [6800, 6800, 6800, 6800]);
        assert.deepStrictEqual([L.shiftRpm(6850), L.shiftRpm(2599), L.shiftRpm(0), L.shiftRpm(NaN), L.shiftRpm('x')], [6800, 2500, 0, 0, 0]);
        assert.strictEqual(L.SETTINGS_V, 3);
    }],
    ['Behavior page: the shift stepper moves 100 per press, Default sits at the mode\'s rpm, the top step has no "+"', () => {
        const w = (saved, mode) => P.view(3, model(saved)).modes[mode].shift.controls.map((c) => c.writes);
        assert.deepStrictEqual(w({ sportShift: 6500 }, 1), [[['sportShift', 6400]], [['sportShift', 6600]]]);
        assert.deepStrictEqual(w({ sportShift: 6700 }, 1), [[['sportShift', 6600]], [['sportShift', 0]]]);   // Default sits at 6,800, just before an explicit 6,800
        assert.deepStrictEqual(w({ sportShift: 6800 }, 1), [[['sportShift', 0]], []]);
        assert.deepStrictEqual(w({ sportShift: 6850 }, 1), [[['sportShift', 0]], []], 'a saved 6,850 shows as 6,800');
        assert.strictEqual(P.view(3, model({ sportShift: 6850 })).modes[1].shift.value, '6,800');
        assert.deepStrictEqual(w({ comfortShift: 5200 }, 0), [[['comfortShift', 5100]], [['comfortShift', 5300]]]);
    }],

    // ---- gear glyphs ----
    ['gearGlyph: P / R / N from the selector, 1 to 9 in D, nothing for anything unknown (never a wrong gear)', () => {
        const g = L.gearGlyph;
        assert.deepStrictEqual(['P', 'R', 'N'].map((s) => g(s, 0)), ['P', 'R', 'N']);
        assert.deepStrictEqual(['P', 'R', 'N'].map((s) => g(s, 3)), ['P', 'R', 'N'], 'the selector wins over a stale gear');
        assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => g('D', n)), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
        assert.deepStrictEqual([1, 8].map((n) => g(undefined, n)), ['1', '8'], 'no selector: the number as today');
        assert.deepStrictEqual([g(undefined, -1), g(null, -1)], ['R', 'R'], 'gear -1 is R');
        // unknown or missing: blank
        ['X', 'S', 'M', 'd', '', 7, {}, 0, 'NP'].forEach((s) => assert.strictEqual(g(s, 4), '', 'stage ' + JSON.stringify(s)));
        [undefined, null, 0, 10, 11, -2, 2.5, NaN, Infinity, '3', {}, []].forEach((n) => {
            assert.strictEqual(g('D', n), '', 'D gear ' + JSON.stringify(n));
            assert.strictEqual(g(undefined, n), n === undefined || n === null ? '' : g(undefined, n));
        });
        assert.strictEqual(g(undefined, 0), '', 'N or P not told apart: nothing');
        assert.strictEqual(g('D', -1), '');
        assert.strictEqual(g(), '');
    }],
    ['the HUD draws P, R, N and 1 to 9 as strokes in the gear spot, and nothing for anything else', () => {
        const b = G.bracket(cfg.hudStyles, null, 1), r = b.rect;
        const drawn = (gear) => {
            const cv = new Canvas(r.w, r.h);
            hudart.drawGear(cv, b, gear, '#fbfbe8', -r.x, -r.y, 1);
            let n = 0;
            for (let i = 3; i < cv.d.length; i += 4) if (cv.d[i]) n++;
            return n;
        };
        const sig = (gear) => { const cv = new Canvas(r.w, r.h); hudart.drawGear(cv, b, gear, '#fbfbe8', -r.x, -r.y, 1); return Buffer.from(cv.d.buffer, cv.d.byteOffset, cv.d.length).toString('base64'); };
        ['P', 'R', 'N', '1', '3', '8', 3, 9].forEach((g) => assert.ok(drawn(g) > 100, 'draws ' + g));
        [undefined, null, '', 'X', 'D', 0, 10, -1, 'p', {}, 'PR'].forEach((g) => assert.strictEqual(drawn(g), 0, 'blank for ' + JSON.stringify(g)));
        assert.strictEqual(sig(3), sig('3'));
        assert.strictEqual(new Set(['P', 'R', 'N', '3', '8'].map(sig)).size, 5, 'five different pictures');
        assert.strictEqual(hudart.glyphOf('R'), 'R');
        assert.strictEqual(hudart.glyphOf(5), '5');
        assert.strictEqual(hudart.glyphOf('Z'), '');
        // the gear box (what a gear change redraws) holds every glyph
        ['P', 'R', 'N', '8'].forEach((g) => {
            const cv = new Canvas(r.w, r.h);
            hudart.drawGear(cv, b, g, '#fbfbe8', -r.x, -r.y, 1);
            const gb = b.gearBox;
            for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
                if (cv.d[(y * r.w + x) * 4 + 3] && !(x >= gb.x - r.x && x < gb.x - r.x + gb.w && y >= gb.y - r.y && y < gb.y - r.y + gb.h)) assert.fail(g + ' leaves the gear box at ' + x + ',' + y);
            }
        });
    }],
];

function near(a, b, tol, what) { assert.ok(Math.abs(a - b) <= tol, what + ': ' + a + ' vs ' + b); }
