'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const L = require('../apps/adam_shiftlights/logic');
const config = require('../apps/adam_shiftlights/config');

const copy = (x) => JSON.parse(JSON.stringify(x));
/** config.js with one change; returns validateConfig's result */
function bad(edit) { const c = copy(config); edit(c); return L.validateConfig(c); }
const hasError = (r, re) => assert.ok(r.errors.some((e) => re.test(e)), 'no error matching ' + re + ' in ' + JSON.stringify(r.errors));

module.exports = [
    ['a bad palette falls back for that style only', () => {
        const r = bad((c) => { c.clusterStyles.row.palette = 'yyoor'; c.clusterStyles.large.palette = 'aaaaaaaaccx'; });
        hasError(r, /^clusterStyles\.row: perSide must be 5/);
        hasError(r, /^clusterStyles\.large: palette must be 1 to 10/);
        assert.deepStrictEqual(r.cfg.clusterStyles.row, L.DEFAULTS.clusterStyles.row);
        assert.deepStrictEqual(r.cfg.clusterStyles.classic, config.clusterStyles.classic);
        hasError(bad((c) => { c.hudStyles.bar.palette = 'YYYYYOOq'; }), /^hudStyles\.bar: palette colour "q"/);
        hasError(bad((c) => { c.hudStyles.cells.palette = 'yoyoyoyr'; }), /^hudStyles\.cells: palette must be at most 3 runs/);
    }],
    ['a bad colour falls back', () => {
        const r = bad((c) => { c.colors.y = '#ggg'; c.colors.a = 5; });
        hasError(r, /^colors\.y/);
        hasError(r, /^colors\.a/);
        assert.strictEqual(r.cfg.colors.y, L.DEFAULTS.colors.y);
        assert.strictEqual(r.cfg.colors.a, L.DEFAULTS.colors.a);
    }],
    ['flashHz 0 and 3 fall back to 4 (the limiter flash at least 4 Hz); 20 is fine', () => {
        [0, 3, 3.9, 21, '8'].forEach((v) => {
            const r = bad((c) => { c.flashHz = v; });
            hasError(r, /^flashHz: must be 4 to 20/);
            assert.strictEqual(r.cfg.flashHz, 4);
        });
        assert.deepStrictEqual(bad((c) => { c.flashHz = 20; }).errors, []);
    }],
    ['start >= shift falls back for that mode only', () => {
        const r = bad((c) => { c.modes.comfort = { start: 5000, shift: 5000 }; c.modes.sport = { start: 5000, shift: 6000 }; });
        hasError(r, /^modes\.comfort/);
        assert.deepStrictEqual(r.cfg.modes.comfort, L.DEFAULTS.modes.comfort);
        assert.deepStrictEqual(r.cfg.modes.sport, { start: 5000, shift: 6000 });
    }],
    ['a style off its target, or off the map after mapOffset, falls back', () => {
        hasError(bad((c) => { c.clusterStyles.large.cx = 1800; }), /^clusterStyles\.large: does not fit panel/);
        hasError(bad((c) => { c.hudStyles.bar.cy = 470; }), /^hudStyles\.bar: does not fit hud/);
        hasError(bad((c) => { c.clusterStyles.classic.cx = 1500; }), /^clusterStyles\.classic: does not fit the map/);
        hasError(bad((c) => { c.hudStyles.bracket.origin = [600, 131]; }), /^hudStyles\.bracket: does not fit the hud/);
        hasError(bad((c) => { c.mapOffset = { x: 416 }; }), /^mapOffset/);
    }],
    ['shapes that cannot be drawn fall back: slats over the axis, slat wider than pitch, wrong perSide', () => {
        hasError(bad((c) => { c.clusterStyles.large.shear = 40; }), /^clusterStyles\.large: shear must not pass inner/);
        hasError(bad((c) => { c.clusterStyles.classic.slat = 19; }), /^clusterStyles\.classic: slat must not be wider/);
        hasError(bad((c) => { c.hudStyles.bar.perSide = 8; }), /^hudStyles\.bar: perSide must be 7/);
        hasError(bad((c) => { c.clusterStyles.stock.reds = 4; }), /^clusterStyles\.stock: reds/);
        hasError(bad((c) => { c.clusterStyles.row.lean = 'sideways'; }), /^clusterStyles\.row: lean/);
    }],
    ['bad brightness, steps, nightDim, styles, display, driveMode, kill file name fall back', () => {
        const r = bad((c) => {
            c.brightness = 2; c.sizeSteps = [90, 110]; c.brightSteps = 'x'; c.nightDim = 0; c.styles = { cluster: 'banana', hud: 'large' };
            c.display = 'dash'; c.driveMode = 'eco'; c.safety.killFile = '../x';
        });
        ['brightness', 'sizeSteps', 'brightSteps', 'nightDim', 'styles', 'display', 'driveMode', 'safety'].forEach((k) => hasError(r, new RegExp('^' + k + ':')));
        assert.deepStrictEqual([r.cfg.brightness, r.cfg.sizeSteps, r.cfg.nightDim, r.cfg.styles, r.cfg.display, r.cfg.driveMode, r.cfg.safety.killFile],
            [1, L.DEFAULTS.sizeSteps, 0.35, { cluster: 'large', hud: 'large' }, 'off', 'sport', 'DISABLE']);
    }],
    ['an empty object gives the defaults; nothing ever throws', () => {
        const r = L.validateConfig({});
        assert.deepStrictEqual(r.cfg, L.DEFAULTS);
        assert.ok(r.errors.length > 5);
        [undefined, null, 7, 'x', [], { engine: null, modes: 5, colors: 'red', clusterStyles: [], hudStyles: { bar: 5, bracket: { path: 'x' } } }].forEach((x) => {
            assert.deepStrictEqual(L.validateConfig(x).cfg, L.DEFAULTS, JSON.stringify(x));
        });
        const loop = {}; loop.self = loop;
        assert.deepStrictEqual(L.validateConfig(loop).cfg, L.DEFAULTS);
    }],
    ['modeThresholds: 0 means config, a valid override applies, an invalid pair falls back', () => {
        const cfg = L.validateConfig(config).cfg;
        const get = (v) => (k) => v[k];
        assert.deepStrictEqual(L.modeThresholds(cfg, get({}), 'comfort'), { mode: 'comfort', start: 4000, shift: 5000, overridden: false, invalid: false });
        assert.deepStrictEqual(L.modeThresholds(cfg, get({ comfortStart: 0, comfortShift: 0 }), 'comfort').start, 4000);
        assert.deepStrictEqual(L.modeThresholds(cfg, get({ comfortStart: 2000, comfortShift: 3000 }), 'comfort'), { mode: 'comfort', start: 2000, shift: 3000, overridden: true, invalid: false });
        assert.deepStrictEqual(L.modeThresholds(cfg, get({ sportShift: 6500 }), 'sport'), { mode: 'sport', start: 6000, shift: 6500, overridden: true, invalid: false });
        assert.deepStrictEqual(L.modeThresholds(cfg, get({ sportplusStart: 6500, sportplusShift: 6500 }), 'sportplus'), { mode: 'sportplus', start: 6000, shift: 6800, overridden: true, invalid: true });
        assert.deepStrictEqual(L.modeThresholds(cfg, get({ comfortShift: 6900 }), 'comfort').invalid, true);   // over limitWarm - 150
        assert.strictEqual(L.modeThresholds(cfg, get({}), 'eco').mode, 'sport');
    }],
    ['app.json defaults match config.js (no drift)', () => {
        const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps', 'adam_shiftlights', 'app.json'), 'utf8'));
        const def = (k) => spec.settings.filter((s) => s.key === k)[0].default;
        assert.strictEqual(def('display'), config.display);
        assert.strictEqual(def('driveMode'), config.driveMode);
        assert.strictEqual(def('enabled'), true);
        assert.deepStrictEqual(spec.settings.filter((s) => s.key === 'driveMode')[0].options.map((o) => o[0]), L.MODES);
        assert.deepStrictEqual(spec.settings.filter((s) => s.key === 'display')[0].options.map((o) => o[0]), L.DISPLAYS);
        L.MODES.forEach((m) => ['Start', 'Shift'].forEach((k) => assert.strictEqual(def(m + k), 0, m + k)));
        assert.strictEqual(def('demo'), 'auto');
    }],
    ['app.json style settings match config.js: defaults, option ids, size and brightness steps, ASCII labels', () => {
        const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps', 'adam_shiftlights', 'app.json'), 'utf8'));
        const item = (k) => spec.settings.filter((s) => s.key === k)[0];
        assert.strictEqual(spec.version, '0.2.0');
        assert.deepStrictEqual(spec.settings.slice(0, 10).map((s) => s.key),
            ['enabled', 'display', 'clusterStyle', 'hudStyle', 'clusterSize', 'clusterBright', 'clusterNight', 'hudSize', 'hudBright', 'hudNight']);
        assert.strictEqual(item('clusterStyle').default, config.styles.cluster);
        assert.strictEqual(item('hudStyle').default, config.styles.hud);
        assert.deepStrictEqual(item('clusterStyle').options.map((o) => o[0]), L.CLUSTER_STYLES);
        assert.deepStrictEqual(item('hudStyle').options.map((o) => o[0]), L.HUD_STYLES);
        assert.deepStrictEqual(item('clusterStyle').options.map((o) => o[1]), ['M slats large', 'M slats classic', 'Row v3', 'Stock blocks', 'Off']);
        assert.deepStrictEqual(item('hudStyle').options.map((o) => o[1]), ['Bar + bracket large', 'Bar + bracket classic', 'Bar only', 'Bracket + gear only', 'Off']);
        ['cluster', 'hud'].forEach((w) => {
            assert.deepStrictEqual([item(w + 'Size').steps, item(w + 'Size').default], [config.sizeSteps, 100]);
            assert.deepStrictEqual([item(w + 'Bright').steps, item(w + 'Bright').default], [config.brightSteps, 100]);
            assert.deepStrictEqual([item(w + 'Night').type, item(w + 'Night').default], ['bool', false]);
        });
        spec.settings.forEach((s) => assert.ok(/^[\x20-\x7e]+$/.test(s.label), s.label));
        const sig = spec.signals;
        assert.deepStrictEqual(sig['de.bmw.infrastructure.VehicleInformation'], { statusGearboxDrive: 's', DataPowerTrain2: 's' });
        assert.deepStrictEqual(sig['de.bmw.infotainment.vehicle.Vehicle2'], { statusCarSpeed2: 'rs' });
    }],
    ['the HUD unit label is mph (US car) in config.js and DEFAULTS', () => {
        assert.strictEqual(config.hudStyles.bracket.unit, 'mph');
        assert.strictEqual(L.DEFAULTS.hudStyles.bracket.unit, 'mph');
    }],
];
