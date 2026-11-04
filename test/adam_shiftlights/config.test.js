'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const L = require('../../apps/adam_shiftlights/logic');
const config = require('../../apps/adam_shiftlights/config');

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
        hasError(bad((c) => { c.hudStyles.bracket.top = 420; }), /^hudStyles\.bracket: does not fit the hud/);
        hasError(bad((c) => { c.hud = { centerX: 700, anchorY: 260 }; }), /^hud: the HUD art does not fit the hud there \(large, classic, bar, bracket\)/);
        hasError(bad((c) => { c.hud = { centerX: 400 }; }), /^hud: centerX and anchorY/);
        hasError(bad((c) => { c.nudge = { x: [10, 20], y: [0] }; }), /^nudge:/);
        hasError(bad((c) => { c.hudStyles.bar.idle = 'yes'; }), /^hudStyles\.bar: idle must be true or false/);
        hasError(bad((c) => { c.mapOffset = { x: 416 }; }), /^mapOffset/);
    }],
    ['shapes that cannot be drawn fall back: slats over the axis, slat wider than pitch, wrong perSide', () => {
        hasError(bad((c) => { c.clusterStyles.large.shear = 40; }), /^clusterStyles\.large: shear must not pass inner/);
        hasError(bad((c) => { c.clusterStyles.classic.slat = 19; }), /^clusterStyles\.classic: slat must not be wider/);
        hasError(bad((c) => { c.hudStyles.bar.perSide = 8; }), /^hudStyles\.bar: perSide must be 7/);
        hasError(bad((c) => { c.clusterStyles.stock.reds = 4; }), /^clusterStyles\.stock: reds/);
        hasError(bad((c) => { c.clusterStyles.row.lean = 'sideways'; }), /^clusterStyles\.row: lean/);
    }],
    ['bad brightness, steps, nightDim, styles, driveMode, kill file name, hud centre fall back', () => {
        const r = bad((c) => {
            c.brightness = 2; c.sizeSteps = [90, 110]; c.brightSteps = 'x'; c.nightDim = 0; c.styles = { cluster: 'banana', hud: 'large' };
            c.driveMode = 'eco'; c.safety.killFile = '../x'; c.hud = { centerX: 'x', anchorY: 260 };
        });
        ['brightness', 'sizeSteps', 'brightSteps', 'nightDim', 'styles', 'driveMode', 'safety', 'hud'].forEach((k) => hasError(r, new RegExp('^' + k + ':')));
        assert.deepStrictEqual([r.cfg.brightness, r.cfg.sizeSteps, r.cfg.nightDim, r.cfg.styles, r.cfg.driveMode, r.cfg.safety.killFile, r.cfg.hud],
            [1, L.DEFAULTS.sizeSteps, 0.35, { cluster: 'large', hud: 'large' }, 'sport', 'DISABLE', { centerX: 400, anchorY: 260 }]);
        // an 'off' style is gone: it is the on/off settings now
        hasError(bad((c) => { c.styles = { cluster: 'off', hud: 'large' }; }), /^styles:/);
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
    ['app.json defaults match config.js (no drift); two on/off settings, no "enabled" or "display"', () => {
        const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'apps', 'adam_shiftlights', 'app.json'), 'utf8'));
        const item = (k) => spec.settings.filter((s) => s.key === k)[0];
        const def = (k) => item(k).default;
        assert.strictEqual(def('driveMode'), config.driveMode);
        assert.strictEqual(item('driveMode').label, 'Drive mode if the car does not send it');
        assert.deepStrictEqual(item('driveMode').options.map((o) => o[0]), L.MODES);
        assert.deepStrictEqual(['hudOn', 'clusterOn', 'onlySportPlus', 'autoStart'].map((k) => [item(k).type, def(k)]), [['bool', false], ['bool', false], ['bool', false], ['bool', true]]);
        assert.deepStrictEqual([item('hudOn').label, item('clusterOn').label, item('onlySportPlus').label], ['HUD', 'Instrument cluster', 'Only in Sport+']);
        // the car shows one display at a time: the HUD wins by default, the cluster is a choice, the map area is experimental
        assert.deepStrictEqual([item('bothMode').options.map((o) => o[0]), def('bothMode')], [['hud', 'cluster', 'map'], 'hud']);
        assert.deepStrictEqual(item('bothMode').options.map((o) => o[1]).slice(0, 2), ['HUD', 'Instrument cluster']);
        assert.ok(/^Experimental: /.test(item('bothMode').options[2][1]) && /one at a time/.test(item('bothMode').label));
        assert.strictEqual(item('enabled'), undefined);
        assert.strictEqual(item('display'), undefined);
        [['hudX', config.nudge.x, 'px left', 'px right'], ['hudY', config.nudge.y, 'px up', 'px down']].forEach((x) => {
            const it = item(x[0]);
            assert.deepStrictEqual([it.steps, it.default, it.labels['0']], [x[1], 0, 'Centre'], x[0]);
            x[1].forEach((v) => { if (v) assert.strictEqual(it.labels[String(v)], Math.abs(v) + ' ' + (v < 0 ? x[2] : x[3]), x[0] + ' ' + v); });
        });
        assert.deepStrictEqual(spec.screens[0].buttons.map((b) => b[0]), ['BTN_HUD', 'BTN_CLUSTER', 'BTN_SETTINGS']);
        L.MODES.forEach((m) => ['Start', 'Shift'].forEach((k) => assert.strictEqual(def(m + k), 0, m + k)));
        assert.strictEqual(def('demo'), 'auto');
    }],
    ['app.json style settings match config.js: defaults, option ids, size and brightness steps, ASCII labels', () => {
        const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'apps', 'adam_shiftlights', 'app.json'), 'utf8'));
        const item = (k) => spec.settings.filter((s) => s.key === k)[0];
        assert.strictEqual(spec.version, '0.3.0');
        assert.strictEqual(spec.mguAppStartType, 'autostart');
        assert.deepStrictEqual(spec.settings.slice(0, 16).map((s) => s.key),
            ['hudOn', 'clusterOn', 'bothMode', 'onlySportPlus', 'autoStart', 'hudStyle', 'hudSize', 'hudX', 'hudY', 'hudBright', 'hudNight',
                'clusterStyle', 'clusterSize', 'clusterBright', 'clusterNight', 'driveMode']);
        assert.strictEqual(item('clusterStyle').default, config.styles.cluster);
        assert.strictEqual(item('hudStyle').default, config.styles.hud);
        assert.deepStrictEqual(item('clusterStyle').options.map((o) => o[0]), L.CLUSTER_STYLES);
        assert.deepStrictEqual(item('hudStyle').options.map((o) => o[0]), L.HUD_STYLES);
        assert.deepStrictEqual(item('clusterStyle').options.map((o) => o[1]), ['M slats, large', 'M slats, small', 'Centre row (12 segments)', 'Stock look (one block per dial)']);
        assert.deepStrictEqual(item('hudStyle').options.map((o) => o[1]), ['Shift bar + rev bracket, large', 'Shift bar + rev bracket, small', 'Shift bar only', 'Rev bracket + gear only']);
        // plain names: no version jargon or "classic" in what Adam reads
        spec.settings.forEach((s) => [s.label].concat((s.options || []).map((o) => o[1])).forEach((t) => assert.ok(!/\bv\d|classic/i.test(t), t)));
        ['cluster', 'hud'].forEach((w) => {
            assert.deepStrictEqual([item(w + 'Size').steps, item(w + 'Size').default], [config.sizeSteps, 100]);
            assert.deepStrictEqual([item(w + 'Bright').steps, item(w + 'Bright').default], [config.brightSteps, 100]);
            assert.deepStrictEqual([item(w + 'Night').type, item(w + 'Night').default], ['bool', false]);
        });
        spec.settings.forEach((s) => assert.ok(/^[\x20-\x7e]+$/.test(s.label), s.label));
        const sig = spec.signals;
        assert.deepStrictEqual(sig['de.bmw.infrastructure.VehicleInformation'], { statusGearboxDrive: 's', DataPowerTrain2: 's' });
        assert.deepStrictEqual(sig['de.bmw.infotainment.vehicle.Vehicle2'], { statusCarSpeed2: 'rs' });
        // the drive mode: subscribe only (no getter needed) and optional, so no G01 refuses the install
        const fes = sig['de.bmw.infotainment.drivingexcitement.FES'];
        assert.strictEqual(fes.statusFESVehicleDynamicSwitchHMI, 's');
        assert.ok(typeof fes._optional === 'string' && fes._optional.length > 10);
    }],
    ['the HUD draws no speed, unit or line (the stock HUD shows the speed): none in config.js or DEFAULTS', () => {
        [config.hudStyles.bracket, L.DEFAULTS.hudStyles.bracket].forEach((B) => ['unit', 'unitAt', 'line', 'origin', 'below'].forEach((k) => assert.strictEqual(B[k], undefined, k)));
        assert.ok(!/km\/h|kph|mph/.test(fs.readFileSync(path.join(__dirname, '..', '..', 'apps', 'adam_shiftlights', 'hudart.js'), 'utf8')));
    }],
];
