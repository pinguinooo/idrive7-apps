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
const PD = require('./polydist');
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
    ['app.json: id, title, version 0.1.7, installs with the cover off, Sport+ only, US units', () => {
        assert.deepStrictEqual([SPEC.id, SPEC.title, SPEC.version, SPEC.loggingId], ['adam_mtrack', 'M Track Cluster', '0.1.7', 'OAD3']);
        assert.strictEqual(item('coverOn').default, false);
        assert.strictEqual(item('whenToShow').default, 'sportplus');
        assert.strictEqual(item('units').default, 'us');
        assert.deepStrictEqual(item('bright').steps.indexOf(item('bright').default) >= 0, true);
        assert.deepStrictEqual(SPEC.screens[0].buttons.map((b) => b[0]), ['BTN_COVER', 'BTN_ALL'], 'no BTN_SETTINGS (the kit would add a sixth tab)');
    }],
    ['app.json 0.1.4: panels default to coolant over oil, torque over power; the left two reset once for saved settings', () => {
        assert.deepStrictEqual(['leftPanel', 'leftLower', 'rightPanel', 'rightLower'].map((k) => item(k).default), ['coolant', 'oil', 'torque', 'power']);
        assert.deepStrictEqual(['leftPanel', 'leftLower'].map((k) => item(k).reset), [1, 1]);
        assert.deepStrictEqual(SPEC.settings.filter((s) => s.reset).map((s) => s.key), ['leftPanel', 'leftLower'], 'nothing else resets');
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
        assert.deepStrictEqual(ART.items.map((i) => i.name), ['bgR2', 'band', 'overR', 'atlas', 'cornerL', 'cornerR_us', 'cornerR_metric'], 'no M badge (0.1.7)');
        const it = (n) => ART.items.filter((i) => i.name === n)[0], xywh = (r) => [r.x, r.y, r.w, r.h];
        assert.deepStrictEqual([it('bgR2').format, it('bgR2').w, it('bgR2').h, it('bgR2').sampling], ['r8', 480, 360, 'bilinear'], 'the background\'s right half at half resolution');
        assert.deepStrictEqual([it('overR').format, it('overR').w, it('overR').h], ['r8', 2 * G.RECTS.overR.w, G.RECTS.overR.h], 'the over-art as coverage + palette index');
        ['band', 'cornerL'].forEach((n) => assert.deepStrictEqual(xywh(it(n).rect), xywh(G.RECTS[n]), n + ' rect = geom'));
        assert.deepStrictEqual(xywh(it('cornerR_us').rect), xywh(G.RECTS.cornerR));
        const mem = ST.memoryOf(ART);
        assert.ok(mem <= cfg.memoryBudgetBytes && cfg.memoryBudgetBytes <= 3 * 1048576, 'renderer memory ' + mem);
        assert.strictEqual(mem, 3017808, 'the measured 2.88 MiB (make-art prints it; 0.1.7: no badge, Codex\'s layout; 0.1.6 was 3135520)');
        assert.ok(cfg.memoryBudgetBytes < cfg.renderer.pixelBytes / 5, 'far under the 16 MiB every app shares');
    }],
    ['the over-art\'s palette index decodes to its colours: the outer edge, its gradient, the red edge and the ticks (0.1.7)', () => {
        const ov = it2('overR'), w = G.RECTS.overR.w, h = G.RECTS.overR.h, px = zlib.inflateRawSync(Buffer.from(ov.data, 'base64'));
        const seen = {};
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const l = px[y * 2 * w + x], k = px[y * 2 * w + w + x]; if (l > 200) { assert.strictEqual(k % 17, 0); seen[k / 17] = (seen[k / 17] || 0) + 1; } }
        [2, 7, 10, 11, 12].forEach((k) => assert.ok(seen[k] > 20, 'colour ' + k + ' (' + ST.OVER_PALETTE[k] + ') used: ' + JSON.stringify(seen)));
        assert.ok(!seen[0], 'index 0 is never written where something is drawn');
    }],
    ['no stray unit label right of the oil gauge (KB-ANY-205): art.html draws no text at x 1806, and the right corner\'s art ends at the gauge (0.1.7: x 1814)', () => {
        const html = fs.readFileSync(path.join(__dirname, '../../tools/mtrack-art/art.html'), 'utf8');
        assert.ok(!/1806/.test(html), 'the 0.1.0 label call is gone');
        const c = it2('cornerR_us'), px = zlib.inflateRawSync(Buffer.from(c.data, 'base64'));
        let right = 0;
        for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) if (px[(y * c.w + x) * 4 + 3] > 0) right = Math.max(right, c.rect.x + x);
        assert.ok(right < 1818, 'the oil gauge art ends at ' + right);
    }],
    ['0.1.7 corner labels keep 7 px clear of the band in the committed art (8 px rule less 1 px antialiasing)', () => {
        [['cornerL', -1], ['cornerR_us', 1], ['cornerR_metric', 1]].forEach((x) => {
            const c = it2(x[0]), px = zlib.inflateRawSync(Buffer.from(c.data, 'base64')), quads = G.gaugeQuads(1, x[1]);
            let ink = 0, worst = Infinity;
            for (let j = 0; j < c.h; j++) for (let i = 0; i < c.w; i++) {
                const k = (j * c.w + i) * 4;
                if (px[k + 3] < 200 || Math.min(px[k], px[k + 1], px[k + 2]) < 195) continue;     // label ink #d7d9e1 only
                ink++;
                const p = [c.rect.x + i + 0.5, c.rect.y + j + 0.5];
                quads.forEach((q) => { worst = Math.min(worst, PD.pointPoly(p, q)); });
            }
            assert.ok(ink > 50, x[0] + ': label ink found (' + ink + ' px)');
            assert.ok(worst >= 7, x[0] + ': a label pixel sits ' + worst.toFixed(2) + ' px from the band');
        });
    }],
    ['atlas: every gear (P R N D - and 0.1.6\'s digits 1-8, no small style) and speed glyph the centre draws, the tachs\' numerals 0..7; mph and km/h; no drive-mode tags (0.1.7); the centre\'s static cell', () => {
        const A = ART.atlas;
        'PRND-12345678'.split('').forEach((c) => assert.ok(A.styles.gear.glyphs[c], 'gear ' + c));
        assert.ok(!A.styles.small && !A.styles.gear.glyphs['9'], 'no small digit style, no gear 9');
        assert.ok(!('tags' in A), 'no tags key: neither Codex\'s design nor BMW\'s photo has a drive-mode tag');
        '01234567'.split('').forEach((c) => assert.ok(A.styles.bar.glyphs[c], 'bar numeral ' + c));
        assert.ok(!A.styles.bar.glyphs['8'] && !A.styles.gear.glyphs['0'], 'only what the cover draws');
        assert.deepStrictEqual([A.centre.px, A.centre.py], [G.CENTRE_CELL.x, G.CENTRE_CELL.y]);
        '0123456789-'.split('').forEach((c) => assert.ok(A.styles.speed.glyphs[c], 'speed ' + c));
        assert.ok(A.labels.mph && A.labels['km/h']);
        assert.deepStrictEqual([A.styles.gear.w, A.styles.gear.h, A.styles.speed.w, A.styles.speed.h, A.styles.bar.w, A.styles.bar.h], [91, 112, 49, 61, 35, 26], 'Codex\'s glyph boxes');
    }],
    ['0.1.6 full panel: no bgR2 byte under 15 (a 0 is the LCD\'s lit backlight, a lavender frame on the car); the corners too', () => {
        const it = it2('bgR2'), px = zlib.inflateRawSync(Buffer.from(it.data, 'base64'));
        let min = 255;
        for (let i = 0; i < px.length; i++) min = Math.min(min, px[i]);
        assert.ok(min >= 15, 'darkest background byte ' + min);
        [0, it.w - 1, (it.h - 1) * it.w, it.h * it.w - 1].forEach((i) => assert.ok(px[i] >= 15, 'corner ' + i + ': ' + px[i]));
    }],
    ['0.1.6 Tach lead: a number setting, steps = config LEAD_STEPS (0 = Off), default = config rpmLead.leadMs, marked', () => {
        const t = item('tachLead');
        assert.deepStrictEqual([t.type, t.unit, t.steps, t.default, t.markDefault, t.labels['0']], ['number', 'ms', cfg.LEAD_STEPS, cfg.rpmLead.leadMs, true, 'Off']);
        assert.ok(cfg.LEAD_STEPS.indexOf(cfg.rpmLead.leadMs) >= 0);
        assert.ok(!t.reset, 'additive: no reset needed');
        assert.strictEqual(cfg.rpmPoll.pollMs, 40, 'rpm poll at Shift Lights\' 40 ms');
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
        assert.ok(new RegExp('vec2\\(' + G.RECTS.centre.w + '\\.0, ' + G.RECTS.centre.h + '\\.0\\)').test(S.centreFs(G.RECTS.centre, ART.atlas)));
        assert.strictEqual((ST.coverStages(ART, cfg)[0].fs.match(/a = max\(a, num\(p, /g) || []).length, 16, 'the tachs bake 16 numeral quads');
    }],
    ['the emulator hook: only emufeed.js reads MTRACK_EMU_FEED, loaded only when it is set; no other env var in the app', () => {
        fs.readdirSync(APP).filter((f) => /\.js$/.test(f) && f !== 'cluster_render_client.js').forEach((f) => {
            const src = fs.readFileSync(path.join(APP, f), 'utf8'), envs = src.match(/process\.env\.[A-Z_]+/g) || [];
            envs.forEach((e) => assert.ok(f === 'main.js' && (e === 'process.env.MTRACK_CR_SOCKET' || e === 'process.env.MTRACK_EMU_FEED'), f + ': ' + e));
        });
        assert.ok(/if \(process\.env\.MTRACK_EMU_FEED\) require\('\.\/emufeed'\)/.test(fs.readFileSync(path.join(APP, 'main.js'), 'utf8')));
    }],    ['0.1.7 colours: the corner art draws Codex\'s track, outline and red zone; the palettes hold the colours the shaders and widgets name', () => {
        const ci = it2('cornerR_us'), px = zlib.inflateRawSync(Buffer.from(ci.data, 'base64')), seen = {};
        for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 200) { const k = ST.encodeLH(px.slice(i, i + 4), 1, { x: 0, y: 0, w: 1, h: 1 }, ST.PALETTE)[1] / 17; seen[k] = (seen[k] || 0) + 1; }
        [[6, 'track #161a22'], [5, 'zone #b3283e'], [1, 'labels #d7d9e1']].forEach((x) => assert.ok(seen[x[0]] > 30, x[1] + ': ' + JSON.stringify(seen)));
        const has = (P, h) => P.some((c) => c.join() === [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join());
        ['#d7d9e1', '#acb0bd', '#707581', '#626875', '#b3283e', '#161a22', '#596171', '#c4c8d2', '#d0d3db'].forEach((h) => assert.ok(has(ST.PALETTE, h), 'PALETTE ' + h));
        ['#7e889e', '#151c27', '#78283a', '#8a3748', '#9da3b2', '#555d6c'].forEach((h) => assert.ok(has(ST.OVER_PALETTE, h), 'OVER_PALETTE ' + h));
        assert.strictEqual(ST.PALETTE.length, 16); assert.strictEqual(ST.OVER_PALETTE.length, 16);
    }],
    ['0.1.5: the art\'s text face is committed (Liberation Sans, OFL beside it) and art.html names no system face', () => {
        const mk = fs.readFileSync(path.join(__dirname, '../../tools/mtrack-art/make-art.mjs'), 'utf8'), html = fs.readFileSync(path.join(__dirname, '../../tools/mtrack-art/art.html'), 'utf8');
        const files = (/ART_FONTS = (\[.*\]);/.exec(mk) || [])[1];
        assert.ok(files, 'make-art.mjs lists ART_FONTS');
        JSON.parse(files.replace(/'/g, '"')).forEach((f) => assert.ok(fs.existsSync(path.join(__dirname, '../../tools/mtrack-art/fonts', f[0])), f[0]));
        assert.ok(/SIL Open Font License/.test(fs.readFileSync(path.join(__dirname, '../../tools/mtrack-art/fonts/OFL-Liberation.txt'), 'utf8')));
        assert.ok(!/Arial|Helvetica|BMW Type/.test(html), 'no system face in art.html');
        assert.ok(/refusing to draw on a fallback face/.test(html));
    }],
];
