// Dev-time only (not shipped): renders tools/mtrack-art/art.html item by item in headless Chromium and writes
// apps/adam_mtrack/art/art.json: { v, items: [{ name, format, w, h, rect, sampling, bytes, data }], atlas }.
// data = the item's pixels (r8: one byte a pixel, rgba8: straight-alpha RGBA rows), raw deflate, base64.
// r8 items come from the luma of the opaque art ('luma') or the alpha of white-on-transparent art ('alpha').
// v2 (0.1.3): 'bg' (1920 x 720) is kept as bgR2: its right half at half resolution (480 x 360, 2 x 2 average), which the
// tachs layer mirrors. Asserts the cover's renderer memory (stages.js memoryOf: every asset it uploads, counted twice as
// cluster-render does) is within config memoryBudgetBytes.
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
const ST = require(path.join(root, 'apps/adam_mtrack/stages.js'));
const out = process.argv[2] || path.join(root, 'apps/adam_mtrack/art/art.json');
// the atlas's text face, a file per weight (fonts/, SIL OFL 1.1)
const ART_FONTS = [['LiberationSans-Regular.ttf', 400], ['LiberationSans-Bold.ttf', 700]];
const { chromium } = await import(process.env.PLAYWRIGHT || '/home/claudius/.local/node/lib/node_modules/playwright/index.mjs');

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--font-render-hinting=none'] });
try {
    const page = await browser.newPage();
    await page.goto('file://' + path.join(here, 'art.html'));
    // 0.1.5: the committed text face; makeArt throws if it falls back to another face
    const faces = ART_FONTS.map((f) => ({ weight: f[1], b64: fs.readFileSync(path.join(here, 'fonts', f[0])).toString('base64') }));
    const art = await page.evaluate((f) => window.makeArt(f), faces);
    const items = [];
    let total = 0;
    for (let i = 0; i < art.items.length; i++) {
        const it = art.items[i], r = it.rect;
        const rgba = Buffer.from(await page.evaluate((k) => window.renderItem(k), i), 'base64');
        if (rgba.length !== r.w * r.h * 4) throw new Error(it.name + ': got ' + rgba.length + ' bytes');
        let px = rgba, name = it.name, w = r.w, h = r.h, rect = r;
        if (it.format === 'r8') {
            px = Buffer.alloc(r.w * r.h);
            for (let p = 0; p < px.length; p++) {
                const o = p * 4;
                px[p] = it.from === 'luma' ? Math.round(0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]) : rgba[o + 3];
            }
        }
        if (it.name === 'overR') {      // coverage + palette index, twice as wide (stages.js encodeLH, OVER_PALETTE)
            px = ST.encodeLH(rgba, r.w, { x: 0, y: 0, w: r.w, h: r.h }, ST.OVER_PALETTE);
            px = Buffer.concat(Array.from({ length: r.h }, (_, y) => Buffer.concat([px.slice(y * r.w, (y + 1) * r.w), px.slice((r.h + y) * r.w, (r.h + y + 1) * r.w)])));
            it.format = 'r8'; w = 2 * r.w;
        }
        if (it.name === 'bg') {         // the right half, 2 x 2 averaged: the tachs layer mirrors it about x 960
            const half = Buffer.alloc((r.w / 4) * (r.h / 2));
            for (let y = 0; y < r.h / 2; y++) {
                for (let x = 0; x < r.w / 4; x++) {
                    const a = 2 * y * r.w + r.w / 2 + 2 * x, b = a + r.w;
                    half[y * (r.w / 4) + x] = Math.round((px[a] + px[a + 1] + px[b] + px[b + 1]) / 4);
                }
            }
            px = half; name = 'bgR2'; w = r.w / 4; h = r.h / 2; rect = { x: r.w / 2, y: 0, w: r.w / 2, h: r.h };
        }
        const z = zlib.deflateRawSync(px, { level: 9 });
        items.push({ name, format: it.format, w, h, rect, sampling: it.sampling, bytes: px.length, data: z.toString('base64') });
        console.log(name.padEnd(15) + String(px.length).padStart(9) + ' bytes, ' + String(z.length).padStart(7) + ' deflated');
    }
    // the cover's renderer memory: every asset output.js uploads (one corner variant), counted twice
    total = ST.memoryOf({ items, atlas: art.atlas });
    console.log('renderer memory of the cover: ' + total + ' bytes counted (budget ' + cfg.memoryBudgetBytes + ')');
    if (total > cfg.memoryBudgetBytes) throw new Error('over the renderer memory budget');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ v: 2, items, atlas: art.atlas }) + '\n');
    console.log('wrote ' + out + ' (' + fs.statSync(out).size + ' bytes)');
} finally {
    await browser.close();
}
