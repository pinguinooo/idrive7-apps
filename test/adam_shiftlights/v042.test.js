'use strict';
/* Shift Lights 0.4.2: the HUD's Small style is the Large layout with the shift bar at hudStyles.smallBar (70 %), centred over
 * the same bracket on the Large bar's base line, with no in-bracket cells; a saved 'classic' keeps working; the About page
 * and the README carry no "not proven on a car" text. The flash at the shift point is in logic.test.js (every style),
 * output.test.js (the bracket fill) and main_flow.test.js (main.js end to end on both targets). */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const G = require('../../apps/adam_shiftlights/geom');
const L = require('../../apps/adam_shiftlights/logic');
const P = require('../../apps/adam_shiftlights/pages');
const config = require('../../apps/adam_shiftlights/config');
const cfg = L.validateConfig(config).cfg;
const APP = path.join(__dirname, '..', '..', 'apps', 'adam_shiftlights');
const SPEC = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));

const V = cfg.hud.visible, M = cfg.hud.barMargin;
const lay = (style, size, x, y, barX) => G.hudLayout(cfg, { style, size, x, y, barX }, () => {});
/** The bar where it sits before the clamp (the clamp moves it left / right only). */
const raw = (l) => ({ x0: l.bar.bar.x0 - l.barShift.x, x1: l.bar.bar.x1 - l.barShift.x, y0: l.bar.bar.y0, y1: l.bar.bar.y1 });
const mid = (b) => (b.x0 + b.x1) / 2;
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, what + ': ' + a + ' vs ' + b);
const model = (saved) => {
    const vals = {};
    SPEC.settings.forEach((s) => { vals[s.key] = s.default; });
    Object.assign(vals, saved);
    return { get: (k) => vals[k], schema: SPEC.settings, cfg, carMode: null, offReason: '', version: SPEC.version };
};

module.exports = [
    ['Small: the Large bar at 70 %, on the same base line and middle, at every size and HUD move; the bracket and gear as Large\'s', () => {
        assert.strictEqual(cfg.hudStyles.smallBar, 0.7);
        let n = 0;
        cfg.sizeSteps.forEach((size) => cfg.nudge.x.forEach((x) => [-60, 0, 60].forEach((y) => {
            // compared where both lay out as asked (a size or move whose art leaves the scene falls back per style: the
            // wider Large bar falls back where Small still fits, e.g. 120 % moved 100 px left)
            const sm = lay('classic', size, x, y, 0), lg = lay('large', sm.size, sm.x, sm.y, 0), what = [size, x, y].join(' ');
            if (lg.size !== sm.size || lg.x !== sm.x || lg.y !== sm.y) return;
            const a = raw(lg), b = raw(sm);
            near(b.x1 - b.x0, (a.x1 - a.x0) * 0.7, 1e-9, what + ' width');
            near(b.y1 - b.y0, (a.y1 - a.y0) * 0.7, 1e-9, what + ' height');
            near(b.y1, a.y1, 1e-9, what + ' base');
            near(mid(b), mid(a), 1e-9, what + ' middle');
            assert.deepStrictEqual([sm.bracket.rect, sm.bracket.gear, sm.bracket.origin], [lg.bracket.rect, lg.bracket.gear, lg.bracket.origin], what);
            assert.ok(sm.bar.bar.y1 <= sm.bracket.rect.y + 8, what + ': the bar sits above the bracket');
            n++;
        })));
        assert.ok(n > 300 && n <= 6 * 21 * 3, 'compared ' + n);
        // centred over the bracket on the stock speed (no move): the bar's middle, the bracket path's middle and the gear
        const l = lay('classic', 100, 0, 0, 0), b = l.bracket;
        near(mid(l.bar.bar), cfg.hud.centerX, 1, 'bar middle');
        near((b.pts[0][0] + b.pts[b.pts.length - 1][0]) / 2, cfg.hud.centerX, 1, 'bracket middle');
        near(b.gear.x, cfg.hud.centerX, 1e-9, 'gear');
        // 577.9 x 52 -> 404.5 x 36.4 at 100 %
        near(l.bar.bar.x1 - l.bar.bar.x0, 404.54, 0.01, 'small bar width at 100 %');
        near(l.bar.dims.h, 36.4, 1e-9, 'small bar height at 100 %');
    }],
    ['Small ignores the Large bar\'s own move (centred over the bracket) but is held inside the visible box like it', () => {
        cfg.sizeSteps.forEach((size) => cfg.nudge.x.forEach((x) => {
            const base = lay('classic', size, x, 60, 0);
            [-100, -35, 70, 100].forEach((barX) => assert.deepStrictEqual(lay('classic', size, x, 60, barX).bar.bar, base.bar.bar, [size, x, barX].join(' ')));
            const bb = base.bar.bar;
            assert.ok(bb.x0 >= V.x0 + M - 1e-9 && bb.x1 <= V.x1 - M + 1e-9, [size, x, bb.x0, bb.x1].join(' '));
            assert.strictEqual(base.barShift.asked, 0);
            assert.strictEqual(base.barShift.clamped, Math.abs(base.barShift.x) > 0.01);
        }));
        // Adam's saved HUD (110 %, 80 px left, 60 px down; bar move 70 for Large): Small fits centred, no clamp, no note
        const adam = lay('classic', 110, -80, 60, 70);
        assert.strictEqual(adam.barShift.clamped, false);
        near(mid(adam.bar.bar), cfg.hud.centerX - 80, 1, 'centred on the moved HUD');
        // only 120 % moved 90 px or more reaches the box: pulled in, and the HUD page says so
        assert.strictEqual(lay('classic', 120, -100, 60, 0).barShift.clamped, true);
        assert.strictEqual(lay('classic', 120, -80, 60, 0).barShift.clamped, false);
        const held = P.view(1, model({ hudOn: true, hudStyle: 'classic', hudSize: 120, hudX: -100 }));
        assert.ok(/held inside the visible area/.test(held.note) && held.noteTone === 'warn', held.note);
        const fine = P.view(1, model({ hudOn: true, hudStyle: 'classic', hudSize: 110, hudX: -80, hudY: 60, hudBarX: 70 }));
        assert.ok(!/held/.test(fine.note), fine.note);
        // the Shift bar left / right row stays the Large and Bar only styles' (off for Small, no controls)
        const row = fine.rows.filter((r) => r.id === 'hudBarX')[0];
        assert.deepStrictEqual([row.enabled, row.desc], [false, 'Only for the Large and Bar only styles']);
        assert.ok(P.controlsOf(fine).every((c) => !/hudBarX/.test(c.key)));
    }],
    ['a saved hudStyle "classic" keeps working: read as Small with no warning, three layers (bar, bracket image, fill), no cells', () => {
        const s = L.readStyle(cfg, (k) => ({ hudStyle: 'classic', hudSize: 110, hudX: -80, hudY: 60, hudBarX: 70 }[k]), 'hud');
        assert.deepStrictEqual([s.style, s.warnings.filter((w) => /hudStyle/.test(w))], ['classic', []]);
        const specs = G.layersFor(cfg, 'hud', { cluster: L.readStyle(cfg, () => undefined, 'cluster'), hud: s });
        assert.deepStrictEqual(specs.map((x) => x.role), ['slats', 'bracketImg', 'bracketFill']);
        assert.ok(specs.every((x) => G.inside(x.rect, 'hud') && x.cells === undefined));
        assert.deepStrictEqual(SPEC.settings.filter((x) => x.key === 'hudStyle')[0].options.map((o) => o[0]), ['large', 'classic', 'bar', 'bracket']);
        const v = P.view(1, model({ hudOn: true, hudStyle: 'classic' })).rows[0];
        assert.deepStrictEqual([v.value, v.desc], ['Small', 'Smaller shift bar + rev bracket']);
    }],
    ['About page and README: no "not proven / untested on a car" text; About shows the version from app.json', () => {
        const untested = /not proven|unproven|untested|not tested|not yet (seen|tested|proven)|on (a|the|this) car yet/i;
        const about = P.view(4, model({}));
        assert.strictEqual(about.note, 'Shift Lights 0.4.2');
        assert.deepStrictEqual(about.blocks.map((b) => b.title), ['Remove safely', 'Kill switch']);
        const text = JSON.stringify(about);
        assert.ok(!untested.test(text), text.match(untested));
        const readme = fs.readFileSync(path.join(APP, 'README.md'), 'utf8');
        assert.ok(!untested.test(readme), String(readme.match(untested)));
        assert.ok(/0\.4\.2/.test(readme), 'the README names 0.4.2');
    }],
];
