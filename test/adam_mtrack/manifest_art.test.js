'use strict';
/* app.json against config.js and the catalogue; art/art.json: every item decodes to w x h x bytes, lies inside the
 * panel, the upload at arm is within the budget, the atlas has every glyph the centre needs, no "8" numeral. */
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
const item = (k) => SPEC.settings.filter((s) => s.key === k)[0];

module.exports = [
    ['app.json: id, title, version 0.1.0, installs with the cover off, Sport+ only, US units', () => {
        assert.deepStrictEqual([SPEC.id, SPEC.title, SPEC.version, SPEC.loggingId], ['adam_mtrack', 'M Track Cluster', '0.1.0', 'OAD3']);
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
    ['art.json: every item decodes to w x h x bpp, lies inside its target, the upload at arm is within the budget', () => {
        let total = 0;
        ART.items.forEach((it) => {
            const px = zlib.inflateRawSync(Buffer.from(it.data, 'base64'));
            assert.strictEqual(px.length, it.w * it.h * (it.format === 'r8' ? 1 : 4), it.name);
            if (it.name !== 'atlas') { const r = it.rect; assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1920 && r.y + r.h <= 720, it.name); }
            assert.ok(it.w <= 2048 && it.h <= 2048, it.name + ' within an asset');
            if (it.name !== 'cornerR_metric') total += px.length;
        });
        total += 2 * G.RECTS.panelR.w * G.RECTS.panelR.h * 4;
        assert.ok(total <= cfg.uploadBudgetBytes, total + ' bytes');
        ['lum', 'band', 'overR', 'overL', 'atlas', 'badge', 'cornerL', 'cornerR_us', 'cornerR_metric'].forEach((n) => assert.ok(ART.items.some((i) => i.name === n), n));
        const xywh = (r) => [r.x, r.y, r.w, r.h];
        ['band', 'overR', 'overL', 'badge', 'cornerL'].forEach((n) => assert.deepStrictEqual(xywh(ART.items.filter((i) => i.name === n)[0].rect), xywh(G.RECTS[n]), n + ' rect = geom'));
    }],
    ['atlas: every gear, small and speed glyph the centre draws; mph and km/h; the drive-mode tags', () => {
        const A = ART.atlas;
        'PRND0123456789-'.split('').forEach((c) => assert.ok(A.styles.gear.glyphs[c], 'gear ' + c));
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
    ['shaders: every program declares u_alive; the glyph program sizes are the rect and the atlas', () => {
        [S.FS_BASE, S.FS_TEX, S.FS_SLATS, S.glyphFs(1, 1, 1, 1)].forEach((fs1) => assert.ok(/uniform float u_alive;/.test(fs1) && /u_alive\)/.test(fs1)));
        assert.ok(/vec2\(320\.0, 266\.0\)/.test(S.glyphFs(G.RECTS.glyphs.w, G.RECTS.glyphs.h, ART.atlas.w, ART.atlas.h)));
    }],
    ['the emulator hook: only emufeed.js reads MTRACK_EMU_FEED, loaded only when it is set; no other env var in the app', () => {
        fs.readdirSync(APP).filter((f) => /\.js$/.test(f) && f !== 'cluster_render_client.js').forEach((f) => {
            const src = fs.readFileSync(path.join(APP, f), 'utf8'), envs = src.match(/process\.env\.[A-Z_]+/g) || [];
            envs.forEach((e) => assert.ok(f === 'main.js' && (e === 'process.env.MTRACK_CR_SOCKET' || e === 'process.env.MTRACK_EMU_FEED'), f + ': ' + e));
        });
        assert.ok(/if \(process\.env\.MTRACK_EMU_FEED\) require\('\.\/emufeed'\)/.test(fs.readFileSync(path.join(APP, 'main.js'), 'utf8')));
    }],
];
