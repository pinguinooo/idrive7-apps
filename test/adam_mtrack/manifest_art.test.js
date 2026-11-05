'use strict';
/* app.json against config.js and the catalogue; art/art.json (v2): every item decodes to w x h x bytes, lies inside the
 * panel, the cover's renderer memory is within the 3 MiB budget, the atlas has every glyph the centre and the tachs
 * need, no "8" numeral, no stray unit label; the shaders: u_alive in each, the stages' samplers and baked sizes. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const APP = path.join(__dirname, '..', '..', 'apps', 'adam_mtrack');
const SPEC = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));
const ART = JSON.parse(fs.readFileSync(path.join(APP, 'art', 'art.json'), 'utf8'));
const C = require('../../apps/adam_mtrack/catalogue');
const G = require('../../apps/adam_mtrack/geom');
const cfg = require('../../apps/adam_mtrack/config');
const S = require('../../apps/adam_mtrack/shader');
const ST = require('../../apps/adam_mtrack/stages');
const item = (k) => SPEC.settings.filter((s) => s.key === k)[0];
const it2 = (n) => ART.items.filter((i) => i.name === n)[0];

module.exports = [
    ['app.json: the Safety settings: BMW popups (Use if sent by default, Require, Ignore), drop if no drive mode (off), the speed timeout within config\'s bounds', () => {
        assert.deepStrictEqual([item('popupGuard').default, item('popupGuard').options.map((o) => o[0])], ['auto', ['auto', 'require', 'ignore']]);
        assert.deepStrictEqual([item('modeMissingDrop').type, item('modeMissingDrop').default], ['bool', false]);
        const st = item('speedStaleMs'), S = cfg.safety;
        assert.strictEqual(st.default, S.speedStaleMs);
        assert.deepStrictEqual([st.steps[0], st.steps[st.steps.length - 1]], [S.speedStaleMinMs, S.speedStaleMaxMs]);
        assert.ok(st.steps.every((x, i) => x >= S.speedStaleMinMs && x <= S.speedStaleMaxMs && (!i || x > st.steps[i - 1])), 'steps inside the bounds, rising');
        assert.ok(st.steps.every((x) => typeof st.labels[String(x)] === 'string'), 'every step has a label');
        assert.ok(!('requireCheckControl' in cfg), 'the old config switch is gone (BMW popups replaces it)');
        assert.ok(st.steps.indexOf(S.speedStaleMs) >= 0);
    }],
    ['app.json: id, title, version 0.1.3, installs with the cover off, Sport+ only, US units', () => {
        assert.deepStrictEqual([SPEC.id, SPEC.title, SPEC.version, SPEC.loggingId], ['adam_mtrack', 'M Track Cluster', '0.1.3', 'OAD3']);
        assert.strictEqual(item('coverOn').default, false);
        assert.strictEqual(item('whenToShow').default, 'sportplus');
        assert.strictEqual(item('units').default, 'us');
        assert.deepStrictEqual(item('bright').steps.indexOf(item('bright').default) >= 0, true);
        assert.deepStrictEqual(SPEC.screens[0].buttons.map((b) => b[0]), ['BTN_COVER', 'BTN_ALL'], 'no BTN_SETTINGS (the kit would add a sixth tab)');
    }],
    ['every catalogue id is an option of every panel setting; the defaults are selectable widgets', () => {
        ['leftPanel', 'leftLower', 'rightPanel', 'rightLower'].forEach((k) => {
            assert.deepStrictEqual(item(k).options.map((o) => o[0]), C.ids(), k);
            assert.ok(C.get(item(k).default).inApp, k + ' default');
        });
        assert.strictEqual(C.CATALOGUE.length, 23, '22 widgets and Empty');
        assert.strictEqual(C.hidden().length, 8);
    }],
    ['every interface a widget needs, and every one main.js reads, is in app.json signals', () => {
        const ifaces = Object.keys(SPEC.signals);
        C.CATALOGUE.forEach((w) => w.needs.forEach((i) => assert.ok(ifaces.indexOf(i) >= 0, w.id + ' ' + i)));
        const main = fs.readFileSync(path.join(APP, 'main.js'), 'utf8');
        (main.match(/'de\.bmw\.[A-Za-z0-9_.]+'/g) || []).forEach((q) => assert.ok(ifaces.indexOf(q.slice(1, -1)) >= 0, q));
        assert.strictEqual(SPEC.signals['de.bmw.infotainment.vehicle.Vehicle2'].statusCarSpeed2, 'rs', 'speed has a getter (polled)');
    }],
    ['art.json v2: every item decodes to w x h x bpp, lies inside its target; the cover takes under 3 MiB of the renderer\'s 16 (0.1.2: 8.2)', () => {
        assert.strictEqual(ART.v, 2);
        ART.items.forEach((it) => {
            const px = zlib.inflateRawSync(Buffer.from(it.data, 'base64'));
            assert.strictEqual(px.length, it.w * it.h * (it.format === 'r8' ? 1 : 4), it.name);
            if (it.name !== 'atlas') { const r = it.rect; assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1920 && r.y + r.h <= 720, it.name); }
            assert.ok(it.w <= 2048 && it.h <= 2048, it.name + ' within an asset');
        });
        assert.deepStrictEqual(ART.items.map((i) => i.name), ['bgR2', 'band', 'overR', 'atlas', 'badge', 'cornerL', 'cornerR_us', 'cornerR_metric']);
        const it = (n) => ART.items.filter((i) => i.name === n)[0], xywh = (r) => [r.x, r.y, r.w, r.h];
        assert.deepStrictEqual([it('bgR2').format, it('bgR2').w, it('bgR2').h, it('bgR2').sampling], ['r8', 480, 360, 'bilinear'], 'the background\'s right half at half resolution');
        assert.deepStrictEqual([it('overR').format, it('overR').w, it('overR').h], ['r8', 2 * G.RECTS.overR.w, G.RECTS.overR.h], 'the over-art as coverage + palette index');
        ['band', 'badge', 'cornerL'].forEach((n) => assert.deepStrictEqual(xywh(it(n).rect), xywh(G.RECTS[n]), n + ' rect = geom'));
        assert.deepStrictEqual(xywh(it('cornerR_us').rect), xywh(G.RECTS.cornerR));
        const mem = ST.memoryOf(ART);
        assert.ok(mem <= cfg.memoryBudgetBytes && cfg.memoryBudgetBytes <= 3 * 1048576, 'renderer memory ' + mem);
        assert.strictEqual(mem, 3049504, 'the measured 2.9 MiB (make-art prints it)');
        assert.ok(cfg.memoryBudgetBytes < cfg.renderer.pixelBytes / 5, 'far under the 16 MiB every app shares');
    }],
    ['the over-art\'s palette index decodes to its colours: a pixel of each field and of the edge line', () => {
        const ov = it2('overR'), w = G.RECTS.overR.w, h = G.RECTS.overR.h, px = zlib.inflateRawSync(Buffer.from(ov.data, 'base64'));
        const seen = {};
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const l = px[y * 2 * w + x], k = px[y * 2 * w + w + x]; if (l > 200) { assert.strictEqual(k % 17, 0); seen[k / 17] = (seen[k / 17] || 0) + 1; } }
        [1, 4, 5, 6].forEach((k) => assert.ok(seen[k] > 20, 'colour ' + k + ' (' + ST.OVER_PALETTE[k] + ') used: ' + JSON.stringify(seen)));
        assert.ok(!seen[0], 'index 0 is never written where something is drawn');
    }],
    ['no stray unit label right of the oil gauge (KB-ANY-205): art.html draws no text at x 1806, and the right corner\'s art ends at 1760', () => {
        const html = fs.readFileSync(path.join(__dirname, '../../tools/mtrack-art/art.html'), 'utf8');
        assert.ok(!/1806/.test(html), 'the 0.1.0 label call is gone');
        const c = it2('cornerR_us'), px = zlib.inflateRawSync(Buffer.from(c.data, 'base64'));
        let right = 0;
        for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) if (px[(y * c.w + x) * 4 + 3] > 0) right = Math.max(right, c.rect.x + x);
        assert.ok(right < 1760, 'the oil gauge art ends at ' + right);
    }],
    ['atlas: every gear, small and speed glyph the centre draws, the tachs\' numerals 0..7; mph and km/h; the drive-mode tags; the centre\'s static cell', () => {
        const A = ART.atlas;
        'PRND-'.split('').forEach((c) => assert.ok(A.styles.gear.glyphs[c], 'gear ' + c));
        '01234567'.split('').forEach((c) => assert.ok(A.styles.bar.glyphs[c], 'bar numeral ' + c));
        assert.ok(!A.styles.bar.glyphs['8'] && !A.styles.gear.glyphs['0'], 'only what the cover draws');
        assert.deepStrictEqual([A.centre.px, A.centre.py], [G.CENTRE_CELL.x, G.CENTRE_CELL.y]);
        '12345678'.split('').forEach((c) => assert.ok(A.styles.small.glyphs[c], 'small ' + c));
        '0123456789-'.split('').forEach((c) => assert.ok(A.styles.speed.glyphs[c], 'speed ' + c));
        assert.ok(A.labels.mph && A.labels['km/h']);
        ['SPORT+', 'SPORT', 'COMFORT'].forEach((x) => assert.ok(A.tags[x], x));
    }],
    ['the over-art tachs draw numerals 0..7 only (no 8): geom places 8 numerals', () => {
        assert.strictEqual(G.numerals(cfg.tach).length, 8);
        assert.ok(!G.numerals(cfg.tach).some((n) => n.k === 8));
        assert.strictEqual(cfg.tach.max, 7000);
    }],
    ['shaders: every program declares u_alive and multiplies its alpha by it; each stage binds exactly the samplers its shader has; sizes baked from geom and the atlas', () => {
        const stages = ST.coverStages(ART, cfg).concat(ST.knownStages(() => Buffer.alloc(1), cfg));
        stages.map((s) => s.fs).concat([S.FS_TEX, S.FS_SOLID]).forEach((fs1) => assert.ok(/uniform float u_alive;/.test(fs1) && /u_alive[,)]/.test(fs1), fs1.slice(0, 200)));
        stages.forEach((s) => {
            const samplers = (s.fs.match(/uniform sampler2D (\w+);/g) || []).map((x) => x.split(' ')[2].slice(0, -1)).sort();
            assert.deepStrictEqual(Object.keys(s.binds).sort(), samplers, s.id);
            Object.keys(s.binds).forEach((k) => assert.ok(s.assets.some((a) => a.name === s.binds[k]) || ['atlas'].indexOf(s.binds[k]) >= 0, s.id + ' ' + k));
            assert.ok(samplers.length <= 5, s.id + ': ' + samplers.length + ' samplers');
            assert.ok(/#ifdef GL_FRAGMENT_PRECISION_HIGH/.test(s.fs) || s.id === 'slats', s.id + ' picks highp only where the GPU has it');
        });
        assert.ok(new RegExp('vec2\\(' + G.RECTS.centre.w + '\\.0, ' + G.RECTS.centre.h + '\\.0\\)').test(S.centreFs(G.RECTS.centre, ART.atlas, G.RECTS.badge)));
        assert.strictEqual((ST.coverStages(ART, cfg)[0].fs.match(/a = max\(a, num\(p, /g) || []).length, 16, 'the tachs bake 16 numeral quads');
    }],
    ['the emulator hook: only emufeed.js reads MTRACK_EMU_FEED, loaded only when it is set; no other env var in the app', () => {
        fs.readdirSync(APP).filter((f) => /\.js$/.test(f) && f !== 'cluster_render_client.js').forEach((f) => {
            const src = fs.readFileSync(path.join(APP, f), 'utf8'), envs = src.match(/process\.env\.[A-Z_]+/g) || [];
            envs.forEach((e) => assert.ok(f === 'main.js' && (e === 'process.env.MTRACK_CR_SOCKET' || e === 'process.env.MTRACK_EMU_FEED'), f + ': ' + e));
        });
        assert.ok(/if \(process\.env\.MTRACK_EMU_FEED\) require\('\.\/emufeed'\)/.test(fs.readFileSync(path.join(APP, 'main.js'), 'utf8')));
    }],
];
