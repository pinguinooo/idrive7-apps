'use strict';
/* units.js conversions and choices; geom.js: the 0-7 tach scale, numerals, mirrors, rects; widgets.js keys. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const U = require('../../apps/adam_mtrack/units');
const G = require('../../apps/adam_mtrack/geom');
const W = require('../../apps/adam_mtrack/widgets');
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
    ['tach scale 0-7: 0 at 0, firstStep at 1000, 1 at 7000; clamped; monotonic', () => {
        assert.strictEqual(G.fracOf(0, T), 0); near(G.fracOf(1000, T), T.firstStep, 1e-9); assert.strictEqual(G.fracOf(7000, T), 1);
        assert.strictEqual(G.fracOf(9000, T), 1); assert.strictEqual(G.fracOf(-500, T), 0); assert.strictEqual(G.fracOf(NaN, T), 0);
        for (let r = 0; r < 7000; r += 50) assert.ok(G.fracOf(r + 50, T) > G.fracOf(r, T), String(r));
    }],
    ['the 7,000 rpm line is the top tick (the old 8); 0 at the 0 tick; the line rises with the revs', () => {
        near(G.yOfRpm(7000, T), G.BARS.tickTopY, 0.01); near(G.yOfRpm(0, T), G.BARS.tick0Y, 0.01);
        for (let r = 0; r < 7000; r += 250) assert.ok(G.yOfRpm(r + 250, T) < G.yOfRpm(r, T), String(r));
    }],
    ['ticks every 500 rpm, majors at the 1000s (15); numerals 0..7 only, in order up the bar, 7 at the top tick', () => {
        const t = G.ticks(T);
        assert.strictEqual(t.length, 15);
        assert.deepStrictEqual(t.filter((x) => x.major).map((x) => x.rpm), [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000]);
        const n = G.numerals(T);
        assert.deepStrictEqual(n.map((x) => x.k), [0, 1, 2, 3, 4, 5, 6, 7]);
        for (let i = 1; i < n.length; i++) assert.ok(n[i].y < n[i - 1].y);
        near(n[7].y, G.BARS.nums8[4][1], 0.5, 'numeral 7 where the mockup had 8'); near(n[7].x, G.BARS.nums8[4][0], 0.5);
        near(n[0].x, G.BARS.nums8[0][0], 0.5);
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
    ['centre quads: the gear (letter or 0.1.6\'s digit) in the one big spot, speed digits centred, the unit and the tag; at most 6; a dash without data', () => {
        const art = JSON.parse(fs.readFileSync(path.join(__dirname, '../../apps/adam_mtrack/art/art.json'), 'utf8'));
        const gs = art.atlas.styles.gear, src = (c) => [gs.glyphs[c].x, gs.glyphs[c].y];
        const q = G.centreQuads(art.atlas, { gear: '3', speed: 123, unit: 'mph', tag: 'SPORT+' });
        assert.strictEqual(q.length, 6, 'gear, 3 speed digits, unit, tag: no small digit');
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
        const B = G.RECTS.badge, C = G.RECTS.centre, cc = G.CENTRE_CELL;
        assert.ok(B.x >= C.x && B.y >= C.y && B.x + B.w <= C.x + C.w && B.y + B.h <= C.y + C.h, 'the M badge inside the centre layer');
        assert.ok(cc.x >= C.x && cc.y >= C.y && cc.x + cc.w <= C.x + C.w && cc.y + cc.h <= C.y + C.h, 'the static line and stack icon inside the centre layer');
        assert.deepStrictEqual([art.atlas.centre.px, art.atlas.centre.py, art.atlas.centre.w, art.atlas.centre.h], [cc.x, cc.y, cc.w, cc.h], 'the atlas cell is the geom one');
    }],
    ['the tachs\' numerals: 8 a bar from the atlas\'s bar style, the left bar\'s at the mirror of each centre, inside the over-art; the panels layer holds every live box', () => {
        const art = JSON.parse(fs.readFileSync(path.join(__dirname, '../../apps/adam_mtrack/art/art.json'), 'utf8'));
        const q = G.barNumeralQuads(art.atlas, cfg.tach), n = G.numerals(cfg.tach), O = G.RECTS.overR, L = G.RECTS.overL;
        assert.strictEqual(q.length, 16);
        q.slice(0, 8).forEach((x, i) => {
            const c = art.atlas.styles.bar.glyphs[String(i)], l = q[8 + i];
            assert.deepStrictEqual(x.src, [c.x, c.y]);
            assert.deepStrictEqual(l.src, x.src, 'the same glyph, not mirrored');
            near(x.dst[0] + c.ox + c.adv / 2, n[i].x, 0.6, 'right ' + i + ' centred on its numeral');
            near(l.dst[0] + c.ox + c.adv / 2, 1920 - n[i].x, 0.6, 'left ' + i + ' at the mirror');
            assert.ok(x.dst[0] >= O.x && x.dst[0] + x.dst[2] <= O.x + O.w && l.dst[0] >= L.x && l.dst[0] + l.dst[2] <= L.x + L.w, 'inside the over-art: ' + JSON.stringify([x.dst, l.dst]));
        });
        const P = G.RECTS.panels;
        ['panelL', 'panelR', 'cornerL', 'cornerR'].forEach((k) => { const r = G.RECTS[k]; assert.ok(r.x >= P.x && r.y >= P.y && r.x + r.w <= P.x + P.w && r.y + r.h <= P.y + P.h, k); });
        assert.ok(G.RECTS.cornerR.x + G.RECTS.cornerR.w <= 1760, 'the right corner ends at 1760 (the stray unit label is gone, KB-ANY-205)');
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
