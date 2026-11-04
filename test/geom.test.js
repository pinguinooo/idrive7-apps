'use strict';
const assert = require('assert');
const G = require('../apps/adam_shiftlights/geom');
const L = require('../apps/adam_shiftlights/logic');
const cfg = L.validateConfig(require('../apps/adam_shiftlights/config')).cfg;

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, what + ': ' + a + ' vs ' + b);
const box = (g) => [g.bar.x0, g.bar.y0, g.bar.x1 - g.bar.x0, g.bar.y1 - g.bar.y0];
const bar = (name, scale) => G.slatBar(cfg.clusterStyles[name], scale || 1, 'panel');
const hudBar = (scale) => G.slatBar(cfg.hudStyles.bar, scale || 1, 'hud');
const sel = (c, h, cs, hs) => ({ cluster: { style: c, size: cs || 100, bright: 100, night: false }, hud: { style: h, size: hs || 100, bright: 100, night: false } });
const HUD_ROLES = { large: ['slats', 'bracketImg', 'bracketFill'], classic: ['bracketImg', 'bracketFill'], bar: ['slats'], bracket: ['bracketImg', 'bracketFill'], off: [] };

module.exports = [
    ['bars match the mockups (+-1 px): large 741,109 438x83; classic 753,127 414x46; row 788,134 344x22; HUD 111,92 578x52', () => {
        [['large', [741, 109, 438, 83]], ['classic', [753, 127, 414, 46]], ['row', [788, 134, 344, 22]]].forEach((x) => {
            box(bar(x[0])).forEach((v, i) => near(v, x[1][i], 1, x[0] + ' ' + i));
        });
        box(hudBar()).forEach((v, i) => near(v, [111, 92, 578, 52][i], 1, 'hud ' + i));
        const s = bar('stock'), xs = (side) => s.polys.filter((p) => (p.pts[0][0] < 960) === (side < 0)).map((p) => p.pts.map((q) => q[0]));
        const span = (a) => [Math.min.apply(null, [].concat.apply([], a)), Math.max.apply(null, [].concat.apply([], a))];
        span(xs(-1)).forEach((v, i) => near(v, [714.7, 805.3][i], 0.05, 'stock left'));
        span(xs(1)).forEach((v, i) => near(v, [1114.7, 1205.3][i], 0.05, 'stock right'));
        assert.deepStrictEqual([s.bar.y0, s.bar.y1], [139, 231]);
    }],
    ['poly counts 20 / 20 / 12 / 2 / 15; lighting indices in order', () => {
        assert.deepStrictEqual(['large', 'classic', 'row', 'stock'].map((k) => bar(k).polys.length).concat([hudBar().polys.length]), [20, 20, 12, 2, 15]);
        const ix = (g) => g.polys.map((p) => p.i).sort((a, b) => a - b).join();
        assert.strictEqual(ix(bar('large')), '0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9');
        assert.strictEqual(ix(hudBar()), '0,0,1,1,2,2,3,3,4,4,5,5,6,6,7');
        // inward: index 0 is the outermost pair, the last a side is innermost
        const l = bar('large'), outer = l.polys.filter((p) => p.i === 0).map((p) => p.pts[0][0]).sort((a, b) => a - b);
        assert.deepStrictEqual(outer.map(Math.round), [741, 1179]);
        // the row keeps v3's fields: 788..1132, the innermost pair at 933 and 962
        const r = bar('row'), inner = r.polys.filter((p) => p.i === 5).map((p) => Math.min(p.pts[0][0], p.pts[1][0])).sort((a, b) => a - b);
        assert.deepStrictEqual(inner, [933, 962]);
    }],
    ['mirrored styles lean / on the left and \\ on the right, no slat crosses the axis; the HUD bar leans / throughout', () => {
        ['large', 'classic', 'stock'].forEach((k) => {
            const g = bar(k);
            g.polys.forEach((p) => {
                const left = p.pts[0][0] < 960, baseX = (p.pts[0][0] + p.pts[1][0]) / 2, topX = (p.pts[2][0] + p.pts[3][0]) / 2;
                assert.ok(left ? topX > baseX : topX < baseX, k + ' lean');
                p.pts.forEach((q) => assert.ok(left ? q[0] <= 960 : q[0] >= 960, k + ' crosses the axis at ' + q[0]));
            });
        });
        bar('row').polys.forEach((p) => assert.strictEqual(p.pts[0][0], p.pts[3][0]));
        hudBar().polys.forEach((p) => { near(p.pts[2][0] - p.pts[1][0], 18.72, 1e-6, 'hud lean'); assert.ok(p.pts[2][1] < p.pts[1][1]); });
    }],
    ['size 120 keeps the centre and scales w and h; a size that does not fit falls back to 100 with one warning', () => {
        const a = bar('large', 1), b = bar('large', 1.2);
        near((b.bar.x0 + b.bar.x1) / 2, (a.bar.x0 + a.bar.x1) / 2, 1e-6, 'cx');
        near((b.bar.y0 + b.bar.y1) / 2, (a.bar.y0 + a.bar.y1) / 2, 1e-6, 'cy');
        near(box(b)[2], box(a)[2] * 1.2, 1e-6, 'w'); near(box(b)[3], box(a)[3] * 1.2, 1e-6, 'h');
        const edge = JSON.parse(JSON.stringify(cfg));
        edge.clusterStyles.large.cx = 1700;
        const warns = [];
        const sp = G.layersFor(edge, 'cluster', sel('large', 'off', 120), (w) => warns.push(w));
        assert.strictEqual(sp.length, 1);
        near(sp[0].geom.dims.h, 82.8, 1e-6, 'fell back to 100 %');
        assert.ok(sp[0].geom.fits);
        assert.deepStrictEqual(warns, ['cluster size 120 % does not fit the panel: using 100 %']);
        assert.strictEqual(G.layersFor(cfg, 'cluster', sel('large', 'off', 120)).length, 1);   // 120 fits normally
        near(G.layersFor(cfg, 'cluster', sel('large', 'off', 120))[0].geom.dims.h, 99.36, 1e-6, '120 %');
    }],
    ['layersFor: every display x 25 style pairs gives the expected roles and targets', () => {
        L.CLUSTER_STYLES.forEach((c) => L.HUD_STYLES.forEach((h) => L.DISPLAYS.forEach((d) => {
            const specs = G.layersFor(cfg, d, sel(c, h));
            const showCl = (d === 'cluster' || d === 'both') && c !== 'off', showHud = (d === 'hud' || d === 'both') && h !== 'off';
            const want = (showCl ? [['cluster', 'slats', d === 'both' && showHud ? 'map' : 'panel']] : [])
                .concat(showHud ? HUD_ROLES[h].map((r) => ['hud', r, 'hud']) : []);
            assert.deepStrictEqual(specs.map((s) => [s.which, s.role, s.target]), want, [c, h, d].join('/'));
            specs.forEach((s) => assert.ok(G.inside(s.rect, s.target), [c, h, d, s.role].join('/') + ' rect ' + JSON.stringify(s.rect)));
        })));
        // the cluster's layer is the same whatever the HUD style, but for the target
        const a = G.layersFor(cfg, 'both', sel('large', 'bar'))[0], b = G.layersFor(cfg, 'both', sel('large', 'off'))[0];
        assert.deepStrictEqual([a.rect.x, a.rect.y, a.rect.w, a.rect.h, a.target], [295, 8, 498, 144, 'map']);
        assert.deepStrictEqual([b.rect.x, b.rect.y, b.rect.w, b.rect.h, b.target], [711, 78, 498, 144, 'panel']);
    }],
    ['bracket: 10-point path 0 to 7, large below the bar (origin y 152), classic at 131; gear box inside the rect', () => {
        const lg = G.bracket(cfg.hudStyles, 'large'), cl = G.bracket(cfg.hudStyles, 'classic');
        assert.deepStrictEqual([lg.pts.length, lg.origin, cl.origin], [10, [300, 152], [300, 131]]);
        near(lg.L, cl.L, 1e-9, 'same length');
        assert.ok(lg.rect.y >= hudBar().bar.y1, 'the large bracket starts under the bar: ' + lg.rect.y);
        assert.deepStrictEqual(lg.nums.map((n) => n.k), [0, 1, 2, 3, 4, 5, 6, 7]);
        near(lg.sOf(7000), lg.L, 1e-9, 's(7000)'); near(lg.sOf(3500), lg.L / 2, 1e-9, 's(3500)');
        const tip = lg.at(0), end = lg.at(lg.L);
        assert.deepStrictEqual([tip.x, tip.y].map(Math.round), [300, 214]);
        assert.deepStrictEqual([end.x, end.y].map(Math.round), [697, 152]);
        assert.ok(end.ny > 0.99, 'the fill side is below the rail');
        [lg, cl].forEach((b) => {
            const g = b.gearBox, r = b.rect;
            assert.ok(g.x >= r.x && g.y >= r.y && g.x + g.w <= r.x + r.w && g.y + g.h <= r.y + r.h, 'gear box ' + JSON.stringify(g) + ' in ' + JSON.stringify(r));
            assert.ok(b.fits && G.inside(r, 'hud'));
        });
    }],
];
