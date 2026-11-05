'use strict';
const assert = require('assert');
const G = require('../../apps/adam_shiftlights/geom');
const L = require('../../apps/adam_shiftlights/logic');
const cfg = L.validateConfig(require('../../apps/adam_shiftlights/config')).cfg;

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, what + ': ' + a + ' vs ' + b);
const box = (g) => [g.bar.x0, g.bar.y0, g.bar.x1 - g.bar.x0, g.bar.y1 - g.bar.y0];
const bar = (name, scale) => G.slatBar(cfg.clusterStyles[name], scale || 1, 'panel');
const hudBar = (scale) => G.slatBar(cfg.hudStyles.bar, scale || 1, 'hud');
const sel = (c, h, cs, hs, x, y) => ({ cluster: { style: c, size: cs || 100, bright: 100, night: false }, hud: { style: h, size: hs || 100, bright: 100, night: false, x: x || 0, y: y || 0 } });
const HUD_ROLES = { large: ['slats', 'bracketImg', 'bracketFill'], classic: ['slats', 'bracketImg', 'bracketFill'], bar: ['slats'], bracket: ['bracketImg', 'bracketFill'] };
const hudSpecs = (h, size, x, y) => G.layersFor(cfg, 'hud', sel('large', h, 100, size, x, y));
const rectsOf = (specs) => specs.map((s) => [s.role, s.rect.x, s.rect.y, s.rect.w, s.rect.h].join(' '));

const clSel = (c, size, x, y) => { const v = sel(c, 'bar', size); v.cluster.x = x; v.cluster.y = y; return v; };

module.exports = [
    ['cluster move: every step of every style fits the panel at every size, lands x, y px from the default; off the panel falls back', () => {
        L.CLUSTER_STYLES.forEach((c) => cfg.sizeSteps.forEach((size) => {
            const home = G.layersFor(cfg, 'cluster', clSel(c, size, 0, 0))[0].geom.bar;
            cfg.clusterNudge.x.forEach((x) => cfg.clusterNudge.y.forEach((y) => {
                const said = [], g = G.layersFor(cfg, 'cluster', clSel(c, size, x, y), (m) => said.push(m))[0].geom;
                assert.deepStrictEqual(said, [], [c, size, x, y].join(' '));
                assert.ok(g.fits, [c, size, x, y].join(' '));
                near(g.bar.x0 - home.x0, x, 1e-9, c + ' x'); near(g.bar.y0 - home.y0, y, 1e-9, c + ' y');
            }));
        }));
        const said = [], g = G.layersFor(cfg, 'cluster', clSel('large', 120, 0, 700), (m) => said.push(m))[0].geom;
        assert.deepStrictEqual(said, ['cluster size 120 % does not fit the panel: using 100 %', 'cluster move 0, 700 px does not fit the panel: using the default place']);
        assert.deepStrictEqual(box(g), box(bar('large')));
        const m = [], b = G.layersFor(cfg, 'both', clSel('large', 100, 0, 400), (x) => m.push(x))[0];
        assert.ok(G.inside(b.rect, 'map') && /^cluster move 0, 400 px does not fit the map/.test(m[0]), m.join('; '));
        // the default place is 25 px under the mockup's (0.3.1), still on the panel above its middle
        assert.deepStrictEqual([bar('large').bar.y0, bar('row').bar.y0].map(Math.round), [134, 159]);
    }],
    ['bars match the mockups (+-1 px): large 741,134 438x83; classic 753,152 414x46; row 788,159 344x22 (25 px under the mockup); HUD 111,92 578x52', () => {
        [['large', [741, 134, 438, 83]], ['classic', [753, 152, 414, 46]], ['row', [788, 159, 344, 22]]].forEach((x) => {
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
        const sp = G.layersFor(edge, 'cluster', sel('large', 'large', 120), (w) => warns.push(w));
        assert.strictEqual(sp.length, 1);
        near(sp[0].geom.dims.h, 82.8, 1e-6, 'fell back to 100 %');
        assert.ok(sp[0].geom.fits);
        assert.deepStrictEqual(warns, ['cluster size 120 % does not fit the panel: using 100 %']);
        assert.strictEqual(G.layersFor(cfg, 'cluster', sel('large', 'large', 120)).length, 1);   // 120 fits normally
        near(G.layersFor(cfg, 'cluster', sel('large', 'large', 120))[0].geom.dims.h, 99.36, 1e-6, '120 %');
    }],
    ['layersFor: every display x 16 style pairs gives the expected roles and targets', () => {
        L.CLUSTER_STYLES.forEach((c) => L.HUD_STYLES.forEach((h) => L.DISPLAYS.forEach((d) => {
            const specs = G.layersFor(cfg, d, sel(c, h));
            const showCl = d === 'cluster' || d === 'both', showHud = d === 'hud' || d === 'both';
            const want = (showCl ? [['cluster', 'slats', d === 'both' ? 'map' : 'panel']] : [])
                .concat(showHud ? HUD_ROLES[h].map((r) => ['hud', r, 'hud']) : []);
            assert.deepStrictEqual(specs.map((s) => [s.which, s.role, s.target]), want, [c, h, d].join('/'));
            specs.forEach((s) => assert.ok(G.inside(s.rect, s.target), [c, h, d, s.role].join('/') + ' rect ' + JSON.stringify(s.rect)));
        })));
        // the cluster's layer is the same whatever the HUD style, but for the target
        const a = G.layersFor(cfg, 'both', sel('large', 'bar'))[0], b = G.layersFor(cfg, 'cluster', sel('large', 'bar'))[0];
        assert.deepStrictEqual([a.rect.x, a.rect.y, a.rect.w, a.rect.h, a.target], [295, 8, 498, 144, 'map']);
        assert.deepStrictEqual([b.rect.x, b.rect.y, b.rect.w, b.rect.h, b.target], [711, 103, 498, 144, 'panel']);
    }],
    ['bracket: 10-point path 0 to 7 centred on x 400 at top 152, the same for every HUD style; gear box inside the rect', () => {
        const lg = hudSpecs('large')[1].geom, cl = hudSpecs('classic')[1].geom, bk = hudSpecs('bracket')[0].geom;
        assert.deepStrictEqual([lg.pts.length, lg.origin, cl.origin, bk.origin].map(JSON.stringify), ['10', '[201.4,152]', '[201.4,152]', '[201.4,152]']);
        assert.deepStrictEqual([lg.rect, cl.rect], [bk.rect, bk.rect]);
        near(lg.L, cl.L, 1e-9, 'same length');
        assert.ok(lg.rect.y >= hudBar().bar.y1, 'the bracket starts under the bar: ' + lg.rect.y);
        assert.deepStrictEqual(lg.nums.map((n) => n.k), [0, 1, 2, 3, 4, 5, 6, 7]);
        near(lg.sOf(7000), lg.L, 1e-9, 's(7000)'); near(lg.sOf(3500), lg.L / 2, 1e-9, 's(3500)');
        const tip = lg.at(0), end = lg.at(lg.L);
        assert.deepStrictEqual([tip.x, tip.y].map(Math.round), [201, 214]);
        assert.deepStrictEqual([end.x, end.y].map(Math.round), [599, 152]);
        assert.ok(end.ny > 0.99, 'the fill side is below the rail');
        [lg, cl, bk].forEach((b) => {
            const g = b.gearBox, r = b.rect;
            assert.ok(g.x >= r.x && g.y >= r.y && g.x + g.w <= r.x + r.w && g.y + g.h <= r.y + r.h, 'gear box ' + JSON.stringify(g) + ' in ' + JSON.stringify(r));
            assert.ok(b.fits && G.inside(r, 'hud'));
        });
    }],
    ['centred on the stock speed: with no move the bracket path, the bar and the gear sit on hud.centerX (+-1 px)', () => {
        const sp = hudSpecs('large'), bar = sp[0].geom, b = sp[1].geom;
        near((b.pts[0][0] + b.pts[b.pts.length - 1][0]) / 2, cfg.hud.centerX, 1, 'bracket path mid');
        near((bar.bar.x0 + bar.bar.x1) / 2, cfg.hud.centerX, 1, 'bar mid (its lean included)');
        near(b.gear.x, cfg.hud.centerX, 1e-9, 'gear x');
        // another centre moves everything with it
        const c2 = JSON.parse(JSON.stringify(cfg)); c2.hud.centerX = 380;
        const s2 = G.layersFor(c2, 'hud', sel('large', 'large'));
        assert.deepStrictEqual(rectsOf(s2), rectsOf(sp).map((r) => r.split(' ').map((v, i) => (i === 1 ? Number(v) - 20 : v)).join(' ')));
    }],
    ['HUD size changes the drawn size: bar, bracket and gear scale by k, the bottom stays at anchorY (it grows upward)', () => {
        ['large', 'classic', 'bar', 'bracket'].forEach((h) => {
            const by = {};
            [70, 100, 120].forEach((size) => { by[size] = hudSpecs(h, size); });
            assert.notDeepStrictEqual(rectsOf(by[70]), rectsOf(by[100]), h + ' 70 vs 100');
            assert.notDeepStrictEqual(rectsOf(by[120]), rectsOf(by[100]), h + ' 120 vs 100');
            [70, 120].forEach((size) => {
                const k = size / 100, s0 = by[100], s1 = by[size];
                s0.forEach((a, i) => {
                    const b = s1[i];
                    if (a.role === 'slats') {
                        near(b.geom.bar.x1 - b.geom.bar.x0, (a.geom.bar.x1 - a.geom.bar.x0) * k, 1e-6, h + ' bar w ' + size);
                        near(b.geom.bar.y1 - b.geom.bar.y0, 52 * k * (h === 'classic' ? cfg.hudStyles.smallBar : 1), 1e-6, h + ' bar h ' + size);
                        near(cfg.hud.anchorY - b.geom.bar.y1, (cfg.hud.anchorY - a.geom.bar.y1) * k, 1e-6, h + ' bar grows up ' + size);
                    } else {
                        near(b.geom.L, a.geom.L * k, 1e-6, h + ' bracket length ' + size);
                        near(b.geom.gear.h, 27.6 * k, 1e-6, h + ' gear ' + size);
                        near(cfg.hud.anchorY - b.geom.gear.y, (cfg.hud.anchorY - a.geom.gear.y) * k, 1e-6, h + ' gear grows up ' + size);
                        near(b.geom.gearBox.w, a.geom.gearBox.w * k, 2, h + ' gear box ' + size);
                    }
                });
            });
        });
    }],
    ['Bar only: exactly one slats layer, no bracket, no gear', () => {
        const sp = hudSpecs('bar');
        assert.deepStrictEqual(sp.map((s) => s.role), ['slats']);
        assert.ok(sp[0].geom.style.idle, 'the HUD bar shows at idle');
    }],
    ['large vs small: the bracket does not move (same rect, origin, gear); small is the same slat bar at 70 %, no cells', () => {
        const lg = hudSpecs('large'), sm = hudSpecs('classic');
        const br = (sp) => sp.filter((s) => s.role === 'bracketImg')[0].geom;
        assert.deepStrictEqual([br(lg).rect, br(lg).origin, br(lg).gear], [br(sm).rect, br(sm).origin, br(sm).gear]);
        assert.deepStrictEqual([lg.map((s) => s.role), sm.map((s) => s.role)], [['slats', 'bracketImg', 'bracketFill'], ['slats', 'bracketImg', 'bracketFill']]);
        assert.deepStrictEqual([sm[0].geom.style.palette, sm[0].geom.style.idle], [cfg.hudStyles.bar.palette, true], 'the HUD bar\'s slats, unlit ones showing at idle');
        near(sm[0].geom.dims.h, lg[0].geom.dims.h * 0.7, 1e-9, 'small bar height');
        assert.ok(sm.concat(lg).every((s) => s.cells === undefined && s.flash === undefined), 'no cells, no per-style flash flag');
    }],
    ['HUD move: x +40 moves every HUD rect 40 right, y -30 moves them 30 up; off the scene falls back with one warning', () => {
        L.HUD_STYLES.forEach((h) => {
            const a = hudSpecs(h), b = hudSpecs(h, 100, 40, 0), c = hudSpecs(h, 100, 0, -30);
            a.forEach((s, i) => {
                assert.deepStrictEqual([b[i].rect.x - s.rect.x, b[i].rect.y - s.rect.y, b[i].rect.w, b[i].rect.h], [40, 0, s.rect.w, s.rect.h], h + ' x');
                assert.deepStrictEqual([c[i].rect.x - s.rect.x, c[i].rect.y - s.rect.y], [0, -30], h + ' y');
            });
        });
        const warns = [], sp = G.layersFor(cfg, 'hud', sel('large', 'large', 100, 120, 300, 0), (w) => warns.push(w));
        // 120 % moved 300 px right does not fit; 100 % moved 300 px does not either: the centre (the shift bar alone never falls back:
        // it is pulled into the visible box)
        assert.deepStrictEqual(warns, ['hud size 120 % does not fit the hud: using 100 %', 'hud move 300, 0 px does not fit the hud: using the centre']);
        const w1 = [];
        G.layersFor(cfg, 'hud', sel('large', 'large', 100, 120, -100, -60), (w) => w1.push(w));
        assert.deepStrictEqual(w1, ['hud size 120 % does not fit the hud: using 100 %']);   // 100 % moved 100 px left and 60 up fits
        assert.deepStrictEqual(rectsOf(sp), rectsOf(hudSpecs('large')));
        sp.forEach((s) => assert.ok(G.inside(s.rect, 'hud')));
        const w2 = [], s2 = G.layersFor(cfg, 'hud', sel('large', 'bracket', 100, 120, 60, 0), (w) => w2.push(w));
        assert.deepStrictEqual(w2, []);   // the bracket alone fits at 120 % moved 60 px
        assert.ok(s2[0].rect.x > hudSpecs('bracket', 120)[0].rect.x);
    }],
];
