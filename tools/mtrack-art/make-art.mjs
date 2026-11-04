// Dev-time only (not shipped): renders tools/mtrack-art/art.html item by item in headless Chromium and writes
// apps/adam_mtrack/art/art.json: { v, items: [{ name, format, w, h, rect, sampling, bytes, data }], atlas }.
// data = the item's pixels (r8: one byte a pixel, rgba8: straight-alpha RGBA rows), raw deflate, base64.
// r8 items come from the luma of the opaque art ('luma') or the alpha of white-on-transparent art ('alpha').
// Asserts the uploaded total (the art plus the four live panel boxes) is within config uploadBudgetBytes.
// The same source gives the same file (deflate level 9, items in a fixed order).
//   PLAYWRIGHT=<path to playwright/index.mjs> node tools/mtrack-art/make-art.mjs [out.json]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const require = createRequire(import.meta.url);
const cfg = require(path.join(root, 'apps/adam_mtrack/config.js'));
const G = require(path.join(root, 'apps/adam_mtrack/geom.js'));
const out = process.argv[2] || path.join(root, 'apps/adam_mtrack/art/art.json');
const { chromium } = await import(process.env.PLAYWRIGHT || '/home/claudius/.local/node/lib/node_modules/playwright/index.mjs');

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--font-render-hinting=none'] });
try {
    const page = await browser.newPage();
    await page.goto('file://' + path.join(here, 'art.html'));
    const art = await page.evaluate(() => window.ART);
    const items = [];
    let total = 0;
    for (let i = 0; i < art.items.length; i++) {
        const it = art.items[i], r = it.rect;
        const rgba = Buffer.from(await page.evaluate((k) => window.renderItem(k), i), 'base64');
        if (rgba.length !== r.w * r.h * 4) throw new Error(it.name + ': got ' + rgba.length + ' bytes');
        let px = rgba;
        if (it.format === 'r8') {
            px = Buffer.alloc(r.w * r.h);
            for (let p = 0; p < px.length; p++) {
                const o = p * 4;
                px[p] = it.from === 'luma' ? Math.round(0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]) : rgba[o + 3];
            }
        }
        const z = zlib.deflateRawSync(px, { level: 9 });
        items.push({ name: it.name, format: it.format, w: r.w, h: r.h, rect: r, sampling: it.sampling, bytes: px.length, data: z.toString('base64') });
        console.log(it.name.padEnd(15) + String(px.length).padStart(9) + ' bytes, ' + String(z.length).padStart(7) + ' deflated');
    }
    // uploaded at arm: everything but the corner variant not in use, plus the side panels' boxes
    const corner = items.filter((x) => x.name === 'cornerR_us')[0].bytes;
    items.forEach((x) => { if (x.name !== 'cornerR_metric' && x.name !== 'cornerR_us') total += x.bytes; });
    total += corner + 2 * G.RECTS.panelR.w * G.RECTS.panelR.h * 4;
    console.log('upload at arm: ' + total + ' bytes (budget ' + cfg.uploadBudgetBytes + ')');
    if (total > cfg.uploadBudgetBytes) throw new Error('over the upload budget');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ v: 1, items, atlas: art.atlas }) + '\n');
    console.log('wrote ' + out + ' (' + fs.statSync(out).size + ' bytes)');
} finally {
    await browser.close();
}
