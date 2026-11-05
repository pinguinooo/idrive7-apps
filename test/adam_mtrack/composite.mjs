// Replays the fake cluster-render log (fake_cluster_render.js: JSON lines + frames/<n>.bin) to any time t and draws the
// panel as the service would (crstate.mjs + crdraw.js in headless WebGL1 / swiftshader): effect layers with their
// uniforms, animations at t, samplers on assets, exclusive, class / z / order, a closed connection's layers gone.
// Copy of iDrive-Apps test/cr_composite.mjs, extended for assets, binds, exclusive and linear animations.
//   node test/adam_mtrack/composite.mjs <log.jsonl> <t ms> <out.png>
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

/** A compositor on a Playwright browser: render(S, t) -> { png, lit } (lit = pixels brighter than near-black). */
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
            window.__cr.draw(x.list, 1920, 720);
            const gl = window.__cr.gl, px = new Uint8Array(1920 * 720 * 4);
            gl.readPixels(0, 0, 1920, 720, gl.RGBA, gl.UNSIGNED_BYTE, px);
            let lit = 0;
            for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 24) lit++;
            return { url: x.png ? document.getElementById('c').toDataURL('image/png') : '', lit, errors: window.__cr.errors.slice() };
        }, { list, png: !opts || opts.png !== false });
        return { png: r.url ? Buffer.from(r.url.split(',')[1], 'base64') : null, lit: r.lit, layers: list.length, errors: r.errors };
    }
    return { render, page };
}

export async function launch() {
    const { chromium } = await import(process.env.PLAYWRIGHT || '/home/claudius/.local/node/lib/node_modules/playwright/index.mjs');
    return chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
}

if (process.argv[1] && process.argv[1].endsWith('composite.mjs')) {
    const [log, t, out] = process.argv.slice(2);
    if (!log || !t || !out) { console.error('usage: composite.mjs <log.jsonl> <t ms> <out.png>'); process.exit(2); }
    const browser = await launch();
    const comp = await createCompositor(browser);
    const r = await comp.render(createReplay(readLog(log), path.dirname(log)).at(Number(t)), Number(t));
    fs.writeFileSync(out, r.png);
    console.log(out + ': ' + r.layers + ' layers, ' + r.lit + ' lit pixels' + (r.errors.length ? ', shader errors: ' + r.errors.join(' | ') : ''));
    await browser.close();
}
