// Compiles every M Track shader in headless WebGL1 (swiftshader, GLSL ES 1.00 as on the KOMBI), counts each program's
// uniform vectors (16 at most: the minimum GLSL ES 1.00 guarantees) and samplers (8 at most), and probes pixels through
// the same renderer stand-in the emulator uses (crdraw.js): the tachs (fill below the revs line and none above, the red
// cap, the left bar the mirror of the right, the over-art's palette colours, a numeral on each bar), the panels (a box's
// coverage and palette colour, the corner over the panel), the centre (a glyph at its quad, the badge and its alpha),
// the slats, the KNOWN step's test card, and nothing at all once u_alive is 0 (the dead-man value). Exit 1 on failure.
//   PLAYWRIGHT=<playwright index.mjs> node test/adam_mtrack/shader_check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launch } from './composite.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const S = require(path.join(here, '../../apps/adam_mtrack/shader.js'));
const G = require(path.join(here, '../../apps/adam_mtrack/geom.js'));
const ST = require(path.join(here, '../../apps/adam_mtrack/stages.js'));
const cfg = require(path.join(here, '../../apps/adam_mtrack/config.js'));
const ART = JSON.parse(fs.readFileSync(path.join(here, '../../apps/adam_mtrack/art/art.json'), 'utf8'));
const failures = [];
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures.push(what); };

const R = G.RECTS, sb = G.slatBar(cfg.row), A = ART.atlas, STG = ST.coverStages(ART, cfg);
const PROGRAMS = { tachs: STG[0].fs, panels: STG[1].fs, centre: STG[2].fs, slats: S.FS_SLATS, known: S.knownFs(), FS_SOLID: S.FS_SOLID, FS_TEX: S.FS_TEX };
const pal = (p) => Array.from(ST.palPixels(p));
const browser = await launch();
try {
    const page = await browser.newPage();
    await page.setContent('<canvas id="c" width="1920" height="720"></canvas>');
    await page.addScriptTag({ path: path.join(here, 'crdraw.js') });
    const counts = await page.evaluate((progs) => {
        const gl = document.createElement('canvas').getContext('webgl'), out = {};
        const VS = 'attribute vec2 a_position; varying vec2 v_uv; void main() { v_uv = a_position; gl_Position = vec4(a_position, 0.0, 1.0); }';
        const W = { [gl.FLOAT]: 1, [gl.FLOAT_VEC2]: 1, [gl.FLOAT_VEC3]: 1, [gl.FLOAT_VEC4]: 1, [gl.FLOAT_MAT4]: 4, [gl.INT]: 1, [gl.BOOL]: 1 };
        for (const name of Object.keys(progs)) {
            const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); return [s, gl.getShaderParameter(s, gl.COMPILE_STATUS), gl.getShaderInfoLog(s)]; };
            const v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, progs[name]);
            if (!f[1]) { out[name] = { error: f[2] }; continue; }
            const p = gl.createProgram(); gl.attachShader(p, v[0]); gl.attachShader(p, f[0]); gl.linkProgram(p);
            let vec = 0, samplers = 0;
            for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
                const u = gl.getActiveUniform(p, i);
                if (u.type === gl.SAMPLER_2D) samplers++; else vec += (W[u.type] || 1) * u.size;
            }
            out[name] = { linked: gl.getProgramParameter(p, gl.LINK_STATUS), vec, samplers };
        }
        return out;
    }, PROGRAMS);
    for (const [n, c] of Object.entries(counts)) {
        check(!c.error && c.linked, n + ' compiles and links' + (c.error ? ': ' + c.error : ''));
        check(c.vec <= 16 && c.samplers <= 8, n + ': ' + c.vec + ' uniform vectors (16 at most), ' + c.samplers + ' samplers (8 at most)');
    }

    // pixel probes: synthetic assets through crdraw.js. An asset: { key, format, w, h, fill, rects: [[x, y, w, h, value]], data: [bytes] }
    const probe = (list, assets, pts) => page.evaluate((x) => {
        const cr = window.__cr || (window.__cr = window.CRDraw.create(document.getElementById('c')));
        for (const a of x.assets) {
            const u = new Uint8Array(a.w * a.h * (a.format === 'r8' ? 1 : 4));
            if (a.fill !== undefined) u.fill(a.fill);
            if (a.data) u.set(a.data);
            (a.rects || []).forEach((r) => { for (let y = r[1]; y < r[1] + r[3]; y++) for (let xx = r[0]; xx < r[0] + r[2]; xx++) u[y * a.w + xx] = r[4] === undefined ? 255 : r[4]; });
            cr.putAsset(a.key, Math.random(), a, u);
        }
        cr.draw(x.list, 1920, 720);
        const gl = cr.gl, out = [];
        for (const p of x.pts) { const px = new Uint8Array(4); gl.readPixels(p[0], 720 - 1 - p[1], 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); out.push(Array.from(px)); }
        return { out, errors: cr.errors };
    }, { list, assets, pts });
    const layer = (stage, uniforms, binds) => ({ kind: 'effect', x: stage.rect.x, y: stage.rect.y, w: stage.rect.w, h: stage.rect.h, fs: stage.fs,
        binds: Object.keys(stage.binds).map((k) => [k, binds[k] || stage.binds[k]]), uniforms });

    // the tachs: background 100, band everywhere, a red block in the over-art at (10..20, 10..20), numeral '3' lit in the atlas
    const ow = R.overR.w, c3 = A.styles.bar.glyphs['3'];
    const overData = new Uint8Array(2 * ow * R.overR.h);
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) { overData[y * 2 * ow + x] = 255; overData[y * 2 * ow + ow + x] = 5 * 17; }
    const tachsAssets = [{ key: 'bgR2', format: 'r8', w: 480, h: 360, fill: 100, sampling: 'bilinear' }, { key: 'overR', format: 'r8', w: 2 * ow, h: R.overR.h, data: Array.from(overData) },
        { key: 'opal', format: 'rgba8', w: 16, h: 1, data: pal(ST.OVER_PALETTE) }, { key: 'band', format: 'r8', w: R.band.w, h: R.band.h, fill: 255 },
        { key: 'atlas', format: 'r8', w: A.w, h: A.h, fill: 0, rects: [[c3.x, c3.y, c3.w, c3.h]] }];
    const tachs = (alive, yr) => layer(STG[0], [['u_tint', [1, 1, 1, 1]], ['u_fill', [yr, 6, 110, 0]], ['u_alive', [alive]]], {});
    const q3 = G.barNumeralQuads(A, cfg.tach)[3], q3l = G.barNumeralQuads(A, cfg.tach)[11];
    const ctr = (q) => [q.dst[0] + Math.floor(q.dst[2] / 2), q.dst[1] + Math.floor(q.dst[3] / 2)];
    let r = await probe([tachs(1, 400)], tachsAssets, [[1290, 520], [1290, 250], [1290, 400], [960, 400], [1920 - 1291, 520], [R.overR.x + 15, R.overR.y + 15], [1920 - (R.overR.x + 15) - 1, R.overR.y + 15], ctr(q3), ctr(q3l), [1290, 380], [1293, 380]]);
    const [below, above, cap, mid, leftBelow, red, redL, n3, n3l, gridLine, gridCell] = r.out;
    check(below[0] > 115 && Math.abs(below[0] - below[1]) < 6, 'tachs: swept fill below the revs (' + below.slice(0, 3) + ' over art 100)');
    check(Math.abs(above[0] - 100) <= 2, 'tachs: no fill above the glow (' + above.slice(0, 3) + ')');
    check(cap[0] > 200 && cap[1] > 60 && cap[1] < 120 && cap[2] < 80, 'tachs: BMW\'s orange-red block at the revs line (' + cap.slice(0, 3) + ')');
    check(gridCell[0] > gridCell[1] + 60 && gridLine[1] < gridCell[1] - 8 && gridLine[0] < gridCell[0], 'tachs: the glow above the revs is a crimson wash under a 6 px grid of darker lines (line ' +
        gridLine.slice(0, 3) + ', cell ' + gridCell.slice(0, 3) + ')');
    check(Math.abs(mid[0] - 100) <= 2, 'tachs: background untouched outside the bands (' + mid.slice(0, 3) + ')');
    check(Math.abs(leftBelow[0] - below[0]) <= 2, 'tachs: the left bar mirrors the right (' + leftBelow.slice(0, 3) + ')');
    check(Math.abs(red[0] - 200) <= 3 && Math.abs(red[1] - 30) <= 3 && Math.abs(red[2] - 42) <= 3, 'tachs: the over-art\'s palette index 5 draws its red (' + red.slice(0, 3) + ')');
    check(Math.abs(redL[0] - red[0]) <= 2 && Math.abs(redL[1] - red[1]) <= 2, 'tachs: the over-art mirrored on the left bar, pixel for pixel (' + redL.slice(0, 3) + ')');
    check(n3[0] > 240 && n3l[0] > 240, 'tachs: numeral 3 on both bars (' + n3.slice(0, 3) + ' / ' + n3l.slice(0, 3) + ')');
    r = await probe([tachs(0, 400)], tachsAssets, [[1290, 520], [960, 400]]);
    check(r.out.every((p) => p[0] + p[1] + p[2] === 0), 'tachs: u_alive 0 draws nothing (' + JSON.stringify(r.out) + ')');

    // the panels: a red pixel block in panelR's box (coverage 255, index 6), the corner's grey band over the panel
    const box = (n, blocks) => { const rr = R[n], d = new Uint8Array(2 * rr.w * rr.h); blocks.forEach((b) => { for (let y = b[1]; y < b[1] + 6; y++) for (let x = b[0]; x < b[0] + 6; x++) { d[y * 2 * rr.w + x] = b[2]; d[y * 2 * rr.w + rr.w + x] = b[3] * 17; } }); return { key: n, format: 'r8', w: 2 * rr.w, h: rr.h, data: Array.from(d) }; };
    const ov = [R.cornerR.x - R.panelR.x + 10, R.cornerR.y - R.panelR.y + 10];      // a spot inside both panelR and cornerR
    const panelAssets = [box('panelL', []), box('panelR', [[10, 10, 255, 6], [ov[0], ov[1], 255, 1]]), box('cornerL', []), box('cornerR', [[10, 10, 255, 6]]),
        { key: 'pal', format: 'rgba8', w: 16, h: 1, data: pal(ST.PALETTE) }];
    const panels = (alive) => layer(STG[1], [['u_bright', [1]], ['u_alive', [alive]]], {});
    r = await probe([panels(1)], panelAssets, [[R.panelR.x + 12, R.panelR.y + 12], [R.panelL.x + 12, R.panelL.y + 12], [R.cornerR.x + 12, R.cornerR.y + 12]]);
    check(Math.abs(r.out[0][0] - 0xe2) <= 3 && Math.abs(r.out[0][1] - 0x26) <= 3, 'panels: coverage + palette index 6 draws #e2262a (' + r.out[0].slice(0, 3) + ')');
    check(r.out[1][0] + r.out[1][1] + r.out[1][2] === 0, 'panels: an empty box draws nothing (' + r.out[1].slice(0, 3) + ')');
    check(Math.abs(r.out[2][0] - 0xe2) <= 3, 'panels: the corner drawn over the panel where they overlap (' + r.out[2].slice(0, 3) + ', panel white under it)');
    r = await probe([panels(0)], panelAssets, [[R.panelR.x + 12, R.panelR.y + 12]]);
    check(r.out[0][0] + r.out[0][1] + r.out[0][2] === 0, 'panels: u_alive 0 draws nothing');

    // the centre: a glyph cell at a quad, the badge (solid) with its alpha
    const C = R.centre, gq = [40, 40, 20, 20];
    const centre = (alive, badge) => layer(STG[2], [['u_dst', gq.concat(new Array(24).fill(0)), 'vec4'], ['u_src', [10, 10, 1, 0].concat(new Array(24).fill(0)), 'vec4'],
        ['u_misc', [1, badge, 0, 0]], ['u_alive', [alive]]], {});
    const centreAssets = [{ key: 'atlas', format: 'r8', w: A.w, h: A.h, fill: 0, rects: [[10, 10, 20, 20]] }, { key: 'badge', format: 'rgba8', w: R.badge.w, h: R.badge.h, data: Array.from(Buffer.alloc(R.badge.w * R.badge.h * 4, 0)).map((v, i) => (i % 4 === 0 ? 40 : i % 4 === 2 ? 220 : i % 4 === 3 ? 255 : 90)) }];
    r = await probe([centre(1, 1)], centreAssets, [[C.x + 50, C.y + 50], [C.x + 30, C.y + 30], [R.badge.x + 60, R.badge.y + 28]]);
    check(r.out[0][0] > 240 && r.out[1][0] === 0, 'centre: the atlas cell shows at its quad only (' + JSON.stringify(r.out.slice(0, 2)) + ')');
    check(Math.abs(r.out[2][0] - 40) <= 3 && Math.abs(r.out[2][2] - 220) <= 3, 'centre: the badge (' + r.out[2].slice(0, 3) + ')');
    r = await probe([centre(1, 0)], centreAssets, [[R.badge.x + 60, R.badge.y + 28]]);
    check(r.out[0][0] + r.out[0][2] === 0, 'centre: badge alpha 0 hides it (the slats lit)');
    r = await probe([centre(0, 1)], centreAssets, [[C.x + 50, C.y + 50], [R.badge.x + 60, R.badge.y + 28]]);
    check(r.out.every((p) => p[0] + p[1] + p[2] === 0), 'centre: u_alive 0 draws nothing');

    // the slats (unchanged from 0.1.2)
    const slats = (lit, alive) => ({ kind: 'effect', x: sb.rect.x, y: sb.rect.y, w: sb.rect.w, h: sb.rect.h, fs: S.FS_SLATS, binds: [],
        uniforms: S.slatUniforms(sb, cfg.colors, 1).map((u) => (u[0] === 'u_st' ? ['u_st', [lit, 0, 1, 0.2]] : [u[0], u[1], u[2] && u[2].type])).concat([['u_alive', [alive]]]) });
    const d = sb.dims, yb = cfg.row.cy + d.h / 2, yy = Math.round(yb - 4), lean = d.shear * 4 / d.h;
    const xOuter = Math.round(960 + d.inner + (d.perSide - 1) * d.pitch + d.slat / 2 - lean), xInner = Math.round(960 + d.inner + d.slat / 2 - lean);
    r = await probe([slats(3, 1)], [], [[xOuter, yy], [xInner, yy], [1920 - xOuter, yy]]);
    check(r.out[0][0] > 200 && r.out[0][1] > 120 && r.out[0][2] < 60, 'slats: an outer slat lit amber at 3 lit (' + r.out[0].slice(0, 3) + ')');
    check(r.out[1][0] > 20 && r.out[1][0] < 90, 'slats: an inner slat dim (' + r.out[1].slice(0, 3) + ')');
    check(r.out[2][0] > 200, 'slats: mirrored on the left (' + r.out[2].slice(0, 3) + ')');
    r = await probe([slats(10, 0)], [], [[xOuter, yy], [xInner, yy]]);
    check(r.out.every((p) => p[0] + p[1] + p[2] === 0), 'slats: u_alive 0 draws nothing');

    // the KNOWN step: the card (all 255) in the middle, a dial's rim, nothing at u_alive 0
    const K = ST.knownStages(() => null, cfg)[0];
    const known = (alive) => layer(K, [['u_val', [30, 2, 0, 0]], ['u_alive', [alive]]], {});
    const card = [{ key: 'card', format: 'r8', w: 1024, h: 576, fill: 255, sampling: 'bilinear' }];
    r = await probe([known(1)], card, [[960, 360], [340, 360 - 252], [100, 100]]);
    check(Math.abs(r.out[0][0] - 71) <= 4 && Math.abs(r.out[0][2] - 255) <= 2, 'known: the test card in the middle (' + r.out[0].slice(0, 3) + ')');
    check(r.out[1][0] > 150, 'known: the left dial\'s rim (' + r.out[1].slice(0, 3) + ')');
    check(r.out[2][3] === 255 && r.out[2][0] < 10, 'known: opaque dark panel elsewhere (' + r.out[2] + ')');
    // 0.1.4 edge ruler: the frame on each edge, a long tick at 200, a short one at 40, dark between and past them
    r = await probe([known(1)], card, [[0, 300], [1919, 300], [700, 0], [700, 719], [200, 30], [40, 8], [60, 8], [40, 20], [1919 - 30, 400], [3, 300]]);
    check(r.out.slice(0, 4).every((p) => p[0] > 200), 'known: a 2 px frame on all four edges (' + r.out.slice(0, 4).map((p) => p[0]) + ')');
    check(r.out[4][0] > 200 && r.out[5][0] > 200 && r.out[8][0] > 200, 'known: ruler ticks, long every 200 px, short every 40 (' + [4, 5, 8].map((i) => r.out[i][0]) + ')');
    check([6, 7, 9].every((i) => r.out[i][0] < 10), 'known: dark between ticks, past a short one, inside the frame (' + [6, 7, 9].map((i) => r.out[i][0]) + ')');
    r = await probe([known(0)], card, [[960, 360], [340, 108]]);
    check(r.out.every((p) => p[0] + p[1] + p[2] === 0), 'known: u_alive 0 draws nothing');
} finally {
    await browser.close();
}
console.log(failures.length ? failures.length + ' FAILED' : 'all shader checks passed');
process.exit(failures.length ? 1 : 0);
