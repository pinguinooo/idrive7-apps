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
        assert.strictEqual(SPEC.version, '0.1.0');
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
    ['NOTICE credits upstream', () => {
        const n = fs.readFileSync(path.join(APP, 'NOTICE'), 'utf8');
        assert(/cauliflowermossgrape\/idrive7-apps/.test(n) && /MIT License/.test(n) && /Permission is hereby granted/.test(n));
    }],
    ['only top-level files in the app folder (build.py packs subfolders as data)', () => {
        fs.readdirSync(APP).forEach((f) => assert(fs.statSync(path.join(APP, f)).isFile(), f + ' is a folder'));
    }],
];
