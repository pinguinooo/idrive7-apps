'use strict';
/* units.js conversions and choices; geom.js: the 0-7 tach scale, numerals, mirrors, rects; widgets.js keys. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const U = require('../../apps/adam_mtrack/units');
const G = require('../../apps/adam_mtrack/geom');
const W = require('../../apps/adam_mtrack/widgets');
const PD = require('./polydist');
const cfg = require('../../apps/adam_mtrack/config');
const T = cfg.tach;
const near = (a, b, e, m) => assert.ok(Math.abs(a - b) <= (e || 0.05), (m || '') + ' ' + a + ' vs ' + b);

module.exports = [
    ['conversions with known values', () => {
        const us = U.resolve('us'), m = U.resolve('metric');
        near(U.SPD(100, us), 62.14, 0.01, 'mph'); near(U.SPD(100, m), 100);
        near(U.T(0, us), 32); near(U.T(100, us), 212); near(U.P(1, us), 14.5, 0.01); near(U.TQ(500, us), 368.8, 0.05);
        near(U.PW(285, us), 382.2, 0.05); near(U.DST(100, us), 62.14, 0.01); near(U.CONS(9.6, us), 24.5, 0.05); near(U.CONS(9.6, m), 9.6);
        assert.strictEqual(U.CONS(0, us), null); assert.strictEqual(U.SPD(null, us), null); assert.strictEqual(U.T(NaN, us), null);
    }],
    ['units: US by default (mph, psi, F, lb-ft, hp, mi, mpg, 12 h); metric; follow car; garbage is US', () => {
        assert.deepStrictEqual(U.resolve('us'), { temp: 'F', press: 'psi', power: 'hp', torque: 'lb-ft', speed: 'mph', dist: 'mi', cons: 'mpg', clock: 12 });
        assert.strictEqual(U.resolve('metric').speed, 'km/h');
        assert.deepStrictEqual(U.resolve('nonsense'), U.resolve('us'));
        assert.deepStrictEqual(U.resolve('car', {}), U.resolve('us'), 'the car says nothing: US');
        const c = U.resolve('car', { temp: 'C', press: 'BAR' });
        assert.deepStrictEqual([c.temp, c.press, c.speed, c.dist, c.torque], ['C', 'bar', 'km/h', 'km', 'Nm']);
        assert.strictEqual(U.resolve('car', { temp: 'F', press: 'BAR' }).speed, 'mph', 'mixed: US');
    }],
    ['0.1.7 tach scale 0-7 on Codex\'s spine: 0 rpm at y 590, 7,000 at 87; clamped; strictly rising every 100 rpm', () => {
        near(G.yOfRpm(0, T), 590, 0.01); near(G.yOfRpm(7000, T), 87, 0.01);
        assert.deepStrictEqual(G.point(0, T), [1920 - 635, 590], 'the right tach is Codex\'s left mirrored');
        near(G.point(7000, T)[0], 1920 - 681, 0.01);
        near(G.yOfRpm(9000, T), 87, 0.01); near(G.yOfRpm(-500, T), 590, 0.01); near(G.yOfRpm(NaN, T), 590, 0.01);
        for (let r = 0; r < 7000; r += 100) assert.ok(G.yOfRpm(r + 100, T) < G.yOfRpm(r, T), String(r));
        near(G.yOfRpm(1000 * 7 / 8, T), 525, 0.01, 'the second anchor at 7/8 of 1,000 rpm');
    }],
    ['0.1.7 the red zone starts at 6,500 rpm: y 119.0, the top 7 % of the scale', () => {
        near(G.yOfRpm(T.redFrom, T), 119.0, 0.1);
        assert.strictEqual(T.redFrom, 6500);
        assert.ok(!('amberFrom' in T) && !('firstStep' in T), 'no amber dashes, no short first step');
    }],
    ['ticks every 500 rpm (15), majors at the 1000s, 24 px long (minors 8), 22 px out from the spine; numerals 0..7 at Codex\'s offsets', () => {
        const t = G.ticks(T);
        assert.strictEqual(t.length, 15);
        assert.deepStrictEqual(t.filter((x) => x.major).map((x) => x.rpm), [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000]);
        assert.deepStrictEqual(t.map((x) => x.len), t.map((x) => (x.major ? 24 : 8)));
        t.forEach((x) => { near(x.x, G.point(x.rpm, T)[0] + 22, 1e-9); near(x.y, G.yOfRpm(x.rpm, T), 1e-9); });
        const n = G.numerals(T);
        const C1 = [[692, 568], [662.7, 494.7], [637.3, 420.3], [619.6, 345.0], [621.0, 270.4], [649.4, 200.9], [683.0, 136.4], [715, 75]];
        assert.deepStrictEqual(n.map((x) => x.k), [0, 1, 2, 3, 4, 5, 6, 7]);
        n.forEach((x, i) => { near(x.x, 1920 - C1[i][0], 0.5, 'numeral ' + i + ' x'); near(x.y, C1[i][1] + 13, 0.5, 'numeral ' + i + ' y'); });
    }],
    ['0.1.7 corner gauges: a faceted band, 3 legs, filled from the low end; clamped; the right one the left\'s mirror', () => {
        assert.deepStrictEqual(G.gaugeQuads(0, -1), []);
        assert.deepStrictEqual(G.gaugeQuads(-1, 1), []); assert.deepStrictEqual(G.gaugeQuads(NaN, -1), []);
        assert.deepStrictEqual(G.gaugeQuads(2, -1), G.gaugeQuads(1, -1));
        const full = G.gaugeQuads(1, -1);
        assert.strictEqual(full.length, 3);
        near(G.GAUGE.len, 290.9, 0.1);
        assert.deepStrictEqual(full[0][0], [290, 601], 'the low end\'s outer edge reaches x 290');
        assert.deepStrictEqual(full[0][3], [272, 583], 'the inner edge stops at x 272 (a 45 deg cut)');
        assert.deepStrictEqual([full[2][1], full[2][2]], [[107, 440], [125, 440]], 'the high end cut flat at y 440');
        [0, 1].forEach((i) => [[1, 0], [2, 3]].forEach((e) => {       // each bend: the edges stop short of each other, mitred
            const a = full[i][e[0]], c = full[i + 1][e[1]], d = Math.hypot(a[0] - c[0], a[1] - c[1]);
            assert.ok(d > 2.5 && d < 3.5, 'a 3 px gap at bend ' + (i + 1) + ': ' + d);
        }));
        const half = G.gaugeQuads(0.5, -1), last = half[half.length - 1], mid = [(last[1][0] + last[2][0]) / 2, (last[1][1] + last[2][1]) / 2];
        assert.strictEqual(half.length, 2);
        near(114 + Math.hypot(mid[0] - 176, mid[1] - 592), 145.4, 1, 'half ends 145.4 px from the low end');
        const dot = (last[2][0] - last[1][0]) * (-1) + (last[2][1] - last[1][1]) * (-1);
        near(dot, 0, 1e-6, 'the partial leg ends in a cut perpendicular to it');
        [0.01, 0.3, 0.5, 0.86, 1].forEach((f) => assert.deepStrictEqual(G.gaugeQuads(f, 1), G.gaugeQuads(f, -1).map((q) => q.map((p) => [1920 - p[0], p[1]])), 'mirror at ' + f));
        assert.deepStrictEqual(G.gaugePoint(1, 1, 26), [1920 - 142, 440]);
        assert.deepStrictEqual(G.gaugePoint(0, -1, 26), [290, 566], 'labels sit toward the inner side');
    }],
    ['0.1.7 corner labels: gaugeLabelOff keeps a 3-digit or one-glyph label box 8 px clear of the band, inside its corner (Codex labelOff)', () => {
        [[-1, G.RECTS.cornerL], [1, G.RECTS.cornerR]].forEach((x) => [0, 0.5, 1].forEach((f) => [[44, 20], [16, 20]].forEach((wh) => {
            const c = G.gaugePoint(f, x[0], G.gaugeLabelOff(f, x[0], wh[0], wh[1])), b = PD.box(c, wh[0], wh[1]), r = x[1], at = x[0] + ' ' + f + ' ' + wh;
            G.gaugeQuads(1, x[0]).forEach((q) => assert.ok(PD.polyPoly(b, q) >= 8 - 1e-6, 'label ' + at + ': ' + PD.polyPoly(b, q) + ' px from the band'));
            assert.ok(b.every((p) => p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h), 'label ' + at + ' inside ' + JSON.stringify(r));
        })));
        const old = PD.box(G.gaugePoint(1, 1, 26), 44, 20);
        assert.ok(Math.min.apply(null, G.gaugeQuads(1, 1).map((q) => PD.polyPoly(old, q))) < 8, 'the 0.1.7 first cut (a flat 26 px) puts "300" within 8 px of the band');
        assert.strictEqual(G.gaugeLabelOff(1, -1, 16, 20), 26, 'a narrow label on the vertical leg keeps the 26 px floor');
    }],
    ['left rects mirror the right ones about x 960; every rect inside the panel', () => {
        const R = G.RECTS;
        [['overL', 'overR'], ['panelL', 'panelR']].forEach((p) => assert.deepStrictEqual(G.flipRect(R[p[1]]), R[p[0]]));
        Object.keys(R).forEach((k) => { const r = R[k]; assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1920 && r.y + r.h <= 720, k); });
        const sl = G.slotRect(-1, 'full'), sr = G.slotRect(1, 'full');
        assert.deepStrictEqual([sl.x0, sl.x1], [1920 - sr.x1, 1920 - sr.x0]);
        const sb = G.slatBar(cfg.row);
        assert.ok(sb.rect.x + sb.rect.w / 2 - 960 < 1 && sb.rect.y < cfg.row.cy && sb.rect.y + sb.rect.h > cfg.row.cy);
    }],
    ['centre quads: the gear (letter or 0.1.6\'s digit) in the one big spot, speed digits centred, the unit; at most 5, no tag (0.1.7); a dash without data', () => {
        const art = JSON.parse(fs.readFileSync(path.join(__dirname, '../../apps/adam_mtrack/art/art.json'), 'utf8'));
        const gs = art.atlas.styles.gear, src = (c) => [gs.glyphs[c].x, gs.glyphs[c].y];
        const q = G.centreQuads(art.atlas, { gear: '3', speed: 123, unit: 'mph', tag: 'SPORT+' });
        assert.strictEqual(q.length, 5, 'gear, 3 speed digits, unit: no tag even when one is passed (0.1.7)');
        assert.ok(!art.atlas.tags, 'no drive-mode tags in the atlas');
        near(q[0].dst[0] + G.RECTS.centre.x + gs.glyphs['3'].ox + gs.glyphs['3'].adv / 2, 960, 1, 'the gear centred on x 960');
        near(q[0].dst[1] + G.RECTS.centre.y + gs.pad, 272, 0.5, 'the gear\'s top at Codex\'s 272');
        assert.deepStrictEqual(q[0].src.slice(0, 2), src('3'), 'the digit 3 from the gear style');
        assert.deepStrictEqual(q[4].src.slice(0, 2), [art.atlas.labels.mph.x, art.atlas.labels.mph.y]);
        const qd = G.centreQuads(art.atlas, { gear: 'D', speed: 123, unit: 'mph', tag: 'SPORT+' });
        assert.deepStrictEqual([qd[0].dst[1], qd[0].dst[3]], [q[0].dst[1], q[0].dst[3]], 'the digit sits where D sits, same size');
        assert.deepStrictEqual(qd[0].dst[0], q[0].dst[0], 'every digit but 1 is as wide as D: same x');
        const one = G.centreQuads(art.atlas, { gear: '1', speed: 0, unit: 'mph' })[0], c1 = gs.glyphs['1'];
        near(one.dst[0] + G.RECTS.centre.x + c1.ox + c1.adv / 2, G.CENTRE.cx, 1, '1 centred on the axis by its own advance');
        '12345678PRND-'.split('').forEach((c) => assert.deepStrictEqual(G.centreQuads(art.atlas, { gear: c, speed: 1, unit: 'mph' })[0].src.slice(0, 2), src(c), c));
        ['9', '0', 'M1', 'S', '', 4].forEach((c) => assert.deepStrictEqual(G.centreQuads(art.atlas, { gear: c, speed: 1, unit: 'mph' })[0].src.slice(0, 2), src('-'), JSON.stringify(c) + ' draws a dash'));
        assert.ok(G.centreQuads(art.atlas, { gear: 'P', speed: 5, unit: 'km/h' }).length === 3, 'P: one speed digit, unit, no tag');
        const none = G.centreQuads(art.atlas, { gear: null, speed: null, unit: 'mph' });
        assert.deepStrictEqual(none.map((x) => x.src.slice(0, 2)), [[art.atlas.styles.gear.glyphs['-'].x, art.atlas.styles.gear.glyphs['-'].y], [art.atlas.styles.speed.glyphs['-'].x, art.atlas.styles.speed.glyphs['-'].y], [art.atlas.labels.mph.x, art.atlas.labels.mph.y]]);
        const sp = G.centreQuads(art.atlas, { gear: 'N', speed: 88, unit: 'mph' }).slice(1, 3), mid = (sp[0].dst[0] + sp[1].dst[0] + sp[1].dst[2]) / 2 + G.RECTS.centre.x;
        near(mid, G.CENTRE.cx, 2, 'speed centred on the axis');
        const spH = art.atlas.styles.speed.glyphs['0'].h;
        assert.strictEqual(G.centreQuads(art.atlas, { gear: 'D', speed: 1500, unit: 'mph' }).filter((x) => x.dst[3] === spH).length, 3, 'speed capped at 3 digits');
        q.forEach((x) => { assert.ok(x.dst[0] >= 0 && x.dst[1] >= 0 && x.dst[0] + x.dst[2] <= G.RECTS.centre.w && x.dst[1] + x.dst[3] <= G.RECTS.centre.h, JSON.stringify(x)); });
        const C = G.RECTS.centre, cc = G.CENTRE_CELL;
        assert.ok(!G.RECTS.badge, 'no M badge rect (0.1.7)');
        assert.ok(cc.x >= C.x && cc.y >= C.y && cc.x + cc.w <= C.x + C.w && cc.y + cc.h <= C.y + C.h, 'the static line and stack icon inside the centre layer');
        assert.deepStrictEqual([art.atlas.centre.px, art.atlas.centre.py, art.atlas.centre.w, art.atlas.centre.h], [cc.x, cc.y, cc.w, cc.h], 'the atlas cell is the geom one');
    }],
    ['the tachs\' numerals: 8 a tach from the atlas\'s bar style, the left tach\'s at the mirror of each centre, inside the panel; the panels layer holds every live box', () => {
        const art = JSON.parse(fs.readFileSync(path.join(__dirname, '../../apps/adam_mtrack/art/art.json'), 'utf8'));
        const q = G.barNumeralQuads(art.atlas, cfg.tach), n = G.numerals(cfg.tach);
        assert.strictEqual(q.length, 16);
        q.slice(0, 8).forEach((x, i) => {
            const c = art.atlas.styles.bar.glyphs[String(i)], l = q[8 + i];
            assert.deepStrictEqual(x.src, [c.x, c.y]);
            assert.deepStrictEqual(l.src, x.src, 'the same glyph, not mirrored');
            near(x.dst[0] + c.ox + c.adv / 2, n[i].x, 0.6, 'right ' + i + ' centred on its numeral');
            near(l.dst[0] + c.ox + c.adv / 2, 1920 - n[i].x, 0.6, 'left ' + i + ' at the mirror');
            [x, l].forEach((d) => assert.ok(d.dst[0] >= 0 && d.dst[1] >= 0 && d.dst[0] + d.dst[2] <= 1920 && d.dst[1] + d.dst[3] <= 720, 'inside the panel: ' + JSON.stringify(d.dst)));
            near(x.dst[1] + art.atlas.styles.bar.pad, n[i].y - 13, 0.5, 'glyph top ' + i);
        });
        const P = G.RECTS.panels;
        ['panelL', 'panelR', 'cornerL', 'cornerR'].forEach((k) => { const r = G.RECTS[k]; assert.ok(r.x >= P.x && r.y >= P.y && r.x + r.w <= P.x + P.w && r.y + r.h <= P.y + P.h, k); });
    }],
    ['widgets: a panel key changes only with what it shows (rounded as drawn); corners likewise', () => {
        const u = U.resolve('us'), lay = { upper: 'coolant', lower: 'boost' }, all = () => true;
        const k = (v) => W.panelKey(lay, v, u, all, cfg);
        assert.strictEqual(k({ coolant: 90, boost: 1 }), k({ coolant: 90.01, boost: 1.001, oil: 50 }));
        assert.notStrictEqual(k({ coolant: 90, boost: 1 }), k({ coolant: 91, boost: 1 }));
        assert.notStrictEqual(W.panelKey(lay, { coolant: 90 }, u, all, cfg), W.panelKey(lay, { coolant: 90 }, U.resolve('metric'), all, cfg));
        assert.notStrictEqual(W.cornerKey(-1, { fuelL: 30 }, u, cfg), W.cornerKey(-1, { fuelL: 31 }, u, cfg));
        assert.deepStrictEqual(W.clockText({ clock: { h: 15, m: 7 } }, u), { t: '3:07', ap: 'pm' });
        assert.deepStrictEqual(W.clockText({ clock: { h: 0, m: 30 } }, u), { t: '12:30', ap: 'am' });
        assert.deepStrictEqual(W.clockText({ clock: { h: 15, m: 7 } }, U.resolve('metric')), { t: '15:07', ap: '' });
        assert.deepStrictEqual(W.scaleOf('coolant', u).labels.map((x) => x[0]), ['160', '210', '270']);
        assert.deepStrictEqual(W.scaleOf('boost', U.resolve('metric')).labels.map((x) => x[0]), ['0.0', '1.0', '2.0']);
    }],
    ['no km/h, kph or a bare C / bar default anywhere in the US path (KB-ANY-199)', () => {
        const u = U.resolve('us');
        ['coolant', 'oil', 'boost', 'torque', 'power'].forEach((id) => assert.ok(['F', 'psi', 'lb-ft', 'hp'].indexOf(W.scaleOf(id, u).unit) >= 0, id));
        assert.deepStrictEqual(W.rowsOf('trip', { trip: { km: 100, h: 1, m: 5, avgKmh: 80, avgL100: 9 } }, u, cfg).map((r) => r[2]), ['mi', 'h', 'mph', 'mpg']);
        assert.strictEqual(W.rowsOf('timer', {}, u, cfg)[0][0], '0-60 MPH');
    }],
];
