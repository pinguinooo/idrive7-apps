// Replays the fake cluster-render log (fake_cluster_render.js: JSON lines + frames/<n>.bin) to any time t and draws the
// panel as the service would (crstate.mjs + crdraw.js in headless WebGL1 / swiftshader): effect layers with their
// uniforms, animations at t, samplers on assets, exclusive, class / z / order, a closed connection's layers gone.
// Copy of iDrive-Apps test/cr_composite.mjs, extended for assets, binds, exclusive and linear animations.
//   node test/adam_mtrack/composite.mjs <log.jsonl> <t ms> <out.png> [--backlight]
// --backlight (0.1.6): the LCD's lit black. The panel shows a pure 0 as its backlight (a lavender frame on the car):
// cleared to lavender, then every pixel with r+g+b <= 24 painted lavender too; uncovered = how many pixels are lavender.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createState, apply, layersAt, assetsOf } from './crstate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const readLog = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

/** The service state at t, moving forward through the records (going back starts over). */
export function createReplay(recs, logDir) {
    let S = null, i = 0, last = -Infinity;
    const pixelsOf = (m) => (m.file ? fs.readFileSync(path.join(logDir, m.file)) : null);
    const reset = () => { S = createState(); i = 0; };
    reset();
    return {
        at(t) {
            if (t < last) reset();
            last = t;
            while (i < recs.length && recs[i].t <= t) apply(S, recs[i++], pixelsOf);
            return S;
        },
        more(list) { list.forEach((r) => recs.push(r)); },
    };
}

export const LAVENDER = [110, 106, 180];
/**
 * A compositor on a Playwright browser: render(S, t, { anims, png, backlight, crop }) -> { png, lit, uncovered } (lit =
 * pixels brighter than near-black; uncovered = with backlight, the pixels that show the LCD's lit black, else null; crop
 * [x, y, w, h]: the PNG of that panel rect only, the counts still of the whole panel).
 */
export async function createCompositor(browser) {
    const page = await browser.newPage();
    await page.setContent('<canvas id="c" width="1920" height="720"></canvas>');
    await page.addScriptTag({ path: path.join(here, 'crdraw.js') });
    await page.evaluate(() => { window.__cr = window.CRDraw.create(document.getElementById('c')); });
    const sent = {};
    async function render(S, t, opts) {
        const list = layersAt(S, t, 'panel', { anims: !(opts && opts.anims === false) && process.env.CR_ANIMS !== 'off' });
        for (const k of assetsOf(list)) {
            const a = S.assets.get(k);
            if (!a || !a.version || sent[k] === a.version) continue;
            await page.evaluate((x) => {
                const bin = atob(x[3]), u = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
                window.__cr.putAsset(x[0], x[1], x[2], u);
            }, [k, a.version, { format: a.format, w: a.w, h: a.h, sampling: a.sampling }, a.data.toString('base64')]);
            sent[k] = a.version;
        }
        const r = await page.evaluate((x) => {
            const L = x.lav;
            window.__cr.draw(x.list, 1920, 720, L || [0, 0, 0]);
            const gl = window.__cr.gl, px = new Uint8Array(1920 * 720 * 4);
            gl.readPixels(0, 0, 1920, 720, gl.RGBA, gl.UNSIGNED_BYTE, px);
            let lit = 0, uncovered = null;
            for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 24) lit++;
            const urlOf = (src) => {
                if (!x.crop) return src.toDataURL('image/png');
                const c3 = document.createElement('canvas'), k = x.crop; c3.width = k[2]; c3.height = k[3];
                c3.getContext('2d').drawImage(src, k[0], k[1], k[2], k[3], 0, 0, k[2], k[3]);
                return c3.toDataURL('image/png');
            };
            if (!L) return { url: x.png ? urlOf(document.getElementById('c')) : '', lit, uncovered, errors: window.__cr.errors.slice() };
            uncovered = 0;
            for (let i = 0; i < px.length; i += 4) {
                if (px[i] + px[i + 1] + px[i + 2] <= 24) { px[i] = L[0]; px[i + 1] = L[1]; px[i + 2] = L[2]; }
                if (px[i] === L[0] && px[i + 1] === L[1] && px[i + 2] === L[2]) uncovered++;
            }
            let url = '';
            if (x.png) {         // readPixels runs bottom up: flip into a 2D canvas for the PNG
                const c2 = document.createElement('canvas'); c2.width = 1920; c2.height = 720;
                const g2 = c2.getContext('2d'), img = g2.createImageData(1920, 720), row = 1920 * 4;
                for (let y = 0; y < 720; y++) { img.data.set(px.subarray((719 - y) * row, (720 - y) * row), y * row); }
                for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
                g2.putImageData(img, 0, 0);
                url = urlOf(c2);
            }
            return { url, lit, uncovered, errors: window.__cr.errors.slice() };
        }, { list, png: !opts || opts.png !== false, lav: opts && opts.backlight ? LAVENDER : null, crop: (opts && opts.crop) || null });
        return { png: r.url ? Buffer.from(r.url.split(',')[1], 'base64') : null, lit: r.lit, uncovered: r.uncovered, layers: list.length, errors: r.errors };
    }
    return { render, page };
}

export async function launch() {
    const { chromium } = await import(process.env.PLAYWRIGHT || '/home/claudius/.local/node/lib/node_modules/playwright/index.mjs');
    return chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
}

if (process.argv[1] && process.argv[1].endsWith('composite.mjs')) {
    const args = process.argv.slice(2), backlight = args.indexOf('--backlight') >= 0;
    const [log, t, out] = args.filter((a) => a !== '--backlight');
    if (!log || !t || !out) { console.error('usage: composite.mjs <log.jsonl> <t ms> <out.png> [--backlight]'); process.exit(2); }
    const browser = await launch();
    const comp = await createCompositor(browser);
    const r = await comp.render(createReplay(readLog(log), path.dirname(log)).at(Number(t)), Number(t), { backlight });
    fs.writeFileSync(out, r.png);
    console.log(out + ': ' + r.layers + ' layers, ' + r.lit + ' lit pixels' + (backlight ? ', uncovered ' + r.uncovered + ' (' + (100 * r.uncovered / (1920 * 720)).toFixed(1) + ' %)' : '') + (r.errors.length ? ', shader errors: ' + r.errors.join(' | ') : ''));
    await browser.close();
}
