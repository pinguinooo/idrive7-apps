// Compiles every M Track shader in headless WebGL1 (swiftshader, GLSL ES 1.00 as on the KOMBI), counts each program's
// uniform vectors (16 at most: the minimum GLSL ES 1.00 guarantees), and probes pixels through the same renderer
// stand-in the emulator uses (crdraw.js): the fill below the revs line and none above, the red cap at it, a glyph at
// its quad, lit and unlit slats, and nothing at all once u_alive is 0 (the dead-man switch). Exit 1 on any failure.
//   PLAYWRIGHT=<playwright index.mjs> node test/adam_mtrack/shader_check.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launch } from './composite.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const S = require(path.join(here, '../../apps/adam_mtrack/shader.js'));
const G = require(path.join(here, '../../apps/adam_mtrack/geom.js'));
const cfg = require(path.join(here, '../../apps/adam_mtrack/config.js'));
const failures = [];
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures.push(what); };

const R = G.RECTS, sb = G.slatBar(cfg.row);
const PROGRAMS = { FS_BASE: S.FS_BASE, FS_TEX: S.FS_TEX, FS_SLATS: S.FS_SLATS, FS_SOLID: S.FS_SOLID, glyphs: S.glyphFs(R.glyphs.w, R.glyphs.h, 1024, 472) };
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
        check(c.vec <= 16, n + ': ' + c.vec + ' uniform vectors (16 at most), ' + c.samplers + ' samplers');
    }

    // pixel probes: synthetic assets through crdraw.js
    const probe = (list, assets, pts) => page.evaluate((x) => {
        const cr = window.__cr || (window.__cr = window.CRDraw.create(document.getElementById('c')));
        for (const a of x.assets) {
            const u = new Uint8Array(a.w * a.h * (a.format === 'r8' ? 1 : 4));
            if (a.fill !== undefined) u.fill(a.fill);
            (a.rects || []).forEach((r) => { for (let y = r[1]; y < r[1] + r[3]; y++) for (let xx = r[0]; xx < r[0] + r[2]; xx++) u[y * a.w + xx] = 255; });
            cr.putAsset(a.key, Math.random(), a, u);
        }
        cr.draw(x.list, 1920, 720);
        const gl = cr.gl, out = [];
        for (const p of x.pts) { const px = new Uint8Array(4); gl.readPixels(p[0], 720 - 1 - p[1], 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); out.push(Array.from(px)); }
        return { out, errors: cr.errors };
    }, { list, assets, pts });
    const base = (alive, yr) => ({ kind: 'effect', x: 0, y: 0, w: 1920, h: 720, fs: S.FS_BASE, binds: [['u_lum', 'lum'], ['u_band', 'band'], ['u_overR', 'ov'], ['u_overL', 'ov']],
        uniforms: [['u_bandBox', [R.band.x, R.band.y, R.band.w, R.band.h]], ['u_overBox', [R.overR.x, R.overR.y, R.overR.w, R.overR.h]], ['u_tint', [1, 1, 1, 1]], ['u_fill', [yr, 6, 110, 0]], ['u_alive', [alive]]] });
    const assets = [{ key: 'lum', format: 'r8', w: 1920, h: 720, fill: 100 }, { key: 'band', format: 'r8', w: R.band.w, h: R.band.h, fill: 255 }, { key: 'ov', format: 'rgba8', w: R.overR.w, h: R.overR.h, fill: 0 }];
    let r = await probe([base(1, 400)], assets, [[1290, 520], [1290, 250], [1290, 400], [960, 400], [1920 - 1290, 520]]);
    const [below, above, cap, centre, leftBelow] = r.out;
    check(below[0] > 115 && Math.abs(below[0] - below[1]) < 6, 'base: swept fill below the revs (' + below.slice(0, 3) + ' over art 100)');
    check(Math.abs(above[0] - 100) <= 2, 'base: no fill above the glow (' + above.slice(0, 3) + ')');
    check(cap[0] > 200 && cap[1] < 60, 'base: the red cap at the revs line (' + cap.slice(0, 3) + ')');
    check(Math.abs(centre[0] - 100) <= 2, 'base: art untouched outside the bands (' + centre.slice(0, 3) + ')');
    check(Math.abs(leftBelow[0] - below[0]) <= 2, 'base: the left bar mirrors the right (' + leftBelow.slice(0, 3) + ')');
    r = await probe([base(0, 400)], assets, [[1290, 520], [960, 400]]);
    check(r.out.every((p) => p[0] + p[1] + p[2] === 0), 'base: u_alive 0 draws nothing (' + JSON.stringify(r.out) + ')');

    const gl = (alive) => ({ kind: 'effect', x: R.glyphs.x, y: R.glyphs.y, w: R.glyphs.w, h: R.glyphs.h, fs: PROGRAMS.glyphs, binds: [['u_atlas', 'atlas']],
        uniforms: [['u_dst', [40, 40, 20, 20].concat(new Array(24).fill(0)), 'vec4'], ['u_src', [10, 10, 1, 0].concat(new Array(24).fill(0)), 'vec4'], ['u_bright', [1]], ['u_alive', [alive]]] });
    const atlas = [{ key: 'atlas', format: 'r8', w: 1024, h: 472, fill: 0, rects: [[10, 10, 20, 20]] }];
    r = await probe([gl(1)], atlas, [[R.glyphs.x + 50, R.glyphs.y + 50], [R.glyphs.x + 30, R.glyphs.y + 30], [R.glyphs.x + 70, R.glyphs.y + 50]]);
    check(r.out[0][0] > 240 && r.out[1][0] === 0 && r.out[2][0] === 0, 'glyphs: the atlas cell shows at its quad only (' + JSON.stringify(r.out) + ')');
    r = await probe([gl(0)], atlas, [[R.glyphs.x + 50, R.glyphs.y + 50]]);
    check(r.out[0][0] === 0, 'glyphs: u_alive 0 draws nothing');

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
} finally {
    await browser.close();
}
console.log(failures.length ? failures.length + ' FAILED' : 'all shader checks passed');
process.exit(failures.length ? 1 : 0);
