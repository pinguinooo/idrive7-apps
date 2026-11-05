'use strict';
/* app.json: identity apart from M Vitals and Warm-Up, the buttons, and the tabs. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..', '..', 'apps', 'adam_vitals');
const SPEC = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));

module.exports = [
    ['identity: id, version, loggingId, a title of its own', () => {
        assert.strictEqual(SPEC.id, path.basename(APP));
        assert.strictEqual(SPEC.version, '0.2.0');
        assert.strictEqual(SPEC.loggingId, 'OAD2');
        assert(['M Vitals', 'Warm-Up'].indexOf(SPEC.title) < 0, SPEC.title);
        assert.strictEqual(SPEC.screens[0].title, SPEC.title);
    }],
    ['buttons: Hide warm-up and Settings', () => {
        const ids = SPEC.screens[0].buttons.map((b) => b[0]);
        ['BTN_PAGE', 'BTN_PREV', 'BTN_HIDE_WARMUP', 'BTN_SETTINGS'].forEach((b) => assert(ids.indexOf(b) >= 0, b));
    }],
    ['six page tabs, the start page setting lists the same pages', () => {
        // (pages.js needs the kit, so its PAGES / TABS are read from the source)
        const src = fs.readFileSync(path.join(APP, 'pages.js'), 'utf8');
        const pages = JSON.parse(src.match(/const PAGES = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
        const tabs = JSON.parse(src.match(/const TABS = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
        assert.strictEqual(tabs.length, 6);
        assert.deepStrictEqual(SPEC.settings.filter((s) => s.key === 'page')[0].options.map((o) => o[0]), pages);
    }],
    ['the transmission read is Transmission Config\'s (zf8hp): gearbox unit 0x18, 22 6000, 1 byte, deg C + 40, its timeouts; nothing unconfirmed', () => {
        const e = SPEC.config.dme.egs;
        assert.strictEqual(e.length, 1, 'one candidate: an unconfirmed DID could show a wrong number the warm-up counts');
        assert.deepStrictEqual([e[0].ecu, e[0].did, e[0].bytes, e[0].at, e[0].factor, e[0].offset], [0x18, '6000', 1, 0, 1, -40]);
        assert.strictEqual(e[0].timeoutMs, 1800);
        assert.deepStrictEqual(e[0].diagOpts, { maxRetries: 0, callTimeoutMs: 2500, hardTimeoutMs: 6500, pendingTimeoutMs: 2500 });
        assert.deepStrictEqual([e[0].min, e[0].max], [-40, 160]);
        const id = SPEC.config.dme.egsId;
        assert.deepStrictEqual([id.length, id[0].ecu, id[0].did, id[0].bytes], [1, 0x18, 'F150', 3]);
    }],
    ['NOTICE credits upstream', () => {
        const n = fs.readFileSync(path.join(APP, 'NOTICE'), 'utf8');
        assert(/cauliflowermossgrape\/idrive7-apps/.test(n) && /MIT License/.test(n) && /Permission is hereby granted/.test(n));
    }],
    ['only top-level files in the app folder (build.py packs subfolders as data)', () => {
        fs.readdirSync(APP).forEach((f) => assert(fs.statSync(path.join(APP, f)).isFile(), f + ' is a folder'));
    }],
];
