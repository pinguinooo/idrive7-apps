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
    ['hudStyles.smallBar (the Small style\'s bar share) outside 0.4 to 1, or not a number, falls back to 0.7', () => {
        [0, 0.39, 1.01, '0.7', null, undefined].forEach((v) => {
            const r = bad((c) => { c.hudStyles.smallBar = v; });
            hasError(r, /^hudStyles\.smallBar: /);
            assert.strictEqual(r.cfg.hudStyles.smallBar, 0.7, String(v));
        });
        [0.4, 1].forEach((v) => assert.deepStrictEqual(bad((c) => { c.hudStyles.smallBar = v; }).errors, [], String(v)));
    }],
    ['flashHz 0 and 3 fall back to 4 (the shift flash at least 4 Hz); 20 is fine', () => {
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
        hasError(bad((c) => { c.hud = Object.assign({}, c.hud, { centerX: 700 }); }), /^hud: the HUD art does not fit the hud there \(large, classic, bracket\)/);
        hasError(bad((c) => { c.hud = { centerX: 400 }; }), /^hud: centerX and anchorY/);
        hasError(bad((c) => { c.hud = Object.assign({}, c.hud, { visible: { x0: 700, y0: 90, x1: 60, y1: 390 } }); }), /^hud: visible needs/);
        hasError(bad((c) => { c.hud = Object.assign({}, c.hud, { defaults: { size: 111, x: -80, y: 60, barX: 70 } }); }), /^hud: defaults must be steps/);
        hasError(bad((c) => { c.nudge = { x: [10, 20], y: [0] }; }), /^nudge:/);
        hasError(bad((c) => { c.hudStyles.bar.idle = 'yes'; }), /^hudStyles\.bar: idle must be true or false/);
        hasError(bad((c) => { c.mapOffset = { x: 416 }; }), /^mapOffset/);
    }],
    ['shapes that cannot be drawn fall back: slats over the axis, slat wider than pitch, wrong perSide', () => {
        hasError(bad((c) => { c.clusterStyles.large.shear = 40; }), /^clusterStyles\.large: shear must not pass inner/);
        hasError(bad((c) => { c.clusterStyles.classic.slat = 19; }), /^clusterStyles\.classic: slat must not be wider/);
        hasError(bad((c) => { c.hudStyles.bar.perSide = 8; }), /^hudStyles\.bar: perSide must be 10/);
        hasError(bad((c) => { c.clusterStyles.stock.reds = 4; }), /^clusterStyles\.stock: reds/);
        hasError(bad((c) => { c.clusterStyles.row.lean = 'sideways'; }), /^clusterStyles\.row: lean/);
    }],
    ['bad brightness, steps, nightDim, styles, driveMode, kill file name, hud centre fall back', () => {
        const r = bad((c) => {
            c.brightness = 2; c.sizeSteps = [90, 110]; c.brightSteps = 'x'; c.nightDim = 0; c.styles = { cluster: 'banana', hud: 'large' };
            c.driveMode = 'eco'; c.safety.killFile = '../x'; c.hud = Object.assign({}, c.hud, { centerX: 'x' });
        });
        ['brightness', 'sizeSteps', 'brightSteps', 'nightDim', 'styles', 'driveMode', 'safety', 'hud'].forEach((k) => hasError(r, new RegExp('^' + k + ':')));
        assert.deepStrictEqual([r.cfg.brightness, r.cfg.sizeSteps, r.cfg.nightDim, r.cfg.styles, r.cfg.driveMode, r.cfg.safety.killFile, r.cfg.hud],
            [1, L.DEFAULTS.sizeSteps, 0.35, { cluster: 'large', hud: 'large' }, 'sport', 'DISABLE', L.DEFAULTS.hud]);
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
        assert.strictEqual(item('driveMode').label, 'Drive mode fallback');
        assert.deepStrictEqual(item('driveMode').options.map((o) => o[0]), L.MODES);
        assert.deepStrictEqual(['hudOn', 'clusterOn', 'onlySportPlus', 'autoStart'].map((k) => [item(k).type, def(k)]), [['bool', false], ['bool', false], ['bool', false], ['bool', true]]);
        assert.deepStrictEqual([item('hudOn').label, item('clusterOn').label, item('onlySportPlus').label], ['HUD', 'Instrument cluster', 'Only in Sport+']);
        // the car shows one display at a time: the HUD wins by default, the cluster is a choice, the map area is experimental
        assert.deepStrictEqual([item('bothMode').options.map((o) => o[0]), def('bothMode')], [['hud', 'cluster', 'map'], 'hud']);
        assert.deepStrictEqual(item('bothMode').options.map((o) => o[1]).slice(0, 2), ['HUD', 'Instrument cluster']);
        assert.deepStrictEqual([item('bothMode').label, item('bothMode').options[2][1]], ['Both on: show', 'Both (experimental centre area)']);
        assert.strictEqual(item('enabled'), undefined);
        assert.strictEqual(item('display'), undefined);
        [['hudX', config.nudge.x, 'px left', 'px right', 'Centre'], ['hudY', config.nudge.y, 'px up', 'px down', 'Centre'],
            ['clusterX', config.clusterNudge.x, 'px left', 'px right', 'Default'], ['clusterY', config.clusterNudge.y, 'px up', 'px down', 'Default']].forEach((x) => {
            const it = item(x[0]);
            const fresh = { hudX: config.hud.defaults.x, hudY: config.hud.defaults.y };   // a fresh install starts where Adam tuned it (0.4.1)
            assert.deepStrictEqual([it.steps, it.default, it.labels['0']], [x[1], fresh[x[0]] || 0, x[4]], x[0]);
            assert.strictEqual(Object.keys(it.labels).length, x[1].length, x[0]);
            x[1].forEach((v) => { if (v) assert.strictEqual(it.labels[String(v)], Math.abs(v) + ' ' + (v < 0 ? x[2] : x[3]), x[0] + ' ' + v); });
        });
        // BTN_ALL, not BTN_SETTINGS: the kit would add a sixth "Settings" header tab for BTN_SETTINGS (display.js hasSettings)
        assert.deepStrictEqual(spec.screens[0].buttons, [['BTN_HUD', 'HUD on/off'], ['BTN_CLUSTER', 'Cluster on/off'], ['BTN_ALL', 'Settings']]);
        L.MODES.forEach((m) => ['Start', 'Shift'].forEach((k) => assert.strictEqual(def(m + k), 0, m + k)));
        assert.strictEqual(def('demo'), 'auto');
    }],
    ['app.json style settings match config.js: defaults, option ids, size and brightness steps, ASCII labels', () => {
        const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'apps', 'adam_shiftlights', 'app.json'), 'utf8'));
        const item = (k) => spec.settings.filter((s) => s.key === k)[0];
        assert.strictEqual(spec.version, '0.4.5');
        assert.strictEqual(spec.mguAppStartType, 'autostart');
        // in page order (Home, HUD, Cluster, Behavior, About): the HMI's settings list reads the same way
        assert.deepStrictEqual(spec.settings.map((s) => s.key),
            ['hudOn', 'clusterOn', 'bothMode', 'hudStyle', 'hudSize', 'hudBright', 'hudNightMode', 'hudX', 'hudY', 'hudBarX',
                'clusterStyle', 'clusterSize', 'clusterBright', 'clusterNightMode', 'clusterX', 'clusterY',
                'onlySportPlus', 'autoStart', 'leadMs', 'rpmPoll', 'driveMode', 'comfortStart', 'comfortShift', 'sportStart', 'sportShift', 'sportplusStart', 'sportplusShift',
                'layout', 'renderer', 'demo', 'flashMode']);
        assert.strictEqual(item('clusterStyle').default, config.styles.cluster);
        assert.strictEqual(item('hudStyle').default, config.styles.hud);
        assert.deepStrictEqual(item('clusterStyle').options.map((o) => o[0]), L.CLUSTER_STYLES);
        assert.deepStrictEqual(item('hudStyle').options.map((o) => o[0]), L.HUD_STYLES);
        assert.deepStrictEqual(item('clusterStyle').options.map((o) => o[1]), ['Large M slats', 'Small M slats', 'Centre row (12 lights)', 'Stock look (one block per dial)']);
        assert.deepStrictEqual(item('hudStyle').options.map((o) => o[1]), ['Large: shift bar + rev bracket', 'Small: smaller shift bar + rev bracket', 'Shift bar only', 'Rev bracket + gear only']);
        // plain names: no version jargon or "classic" in what Adam reads
        spec.settings.forEach((s) => [s.label].concat((s.options || []).map((o) => o[1])).forEach((t) => assert.ok(!/\bv\d|classic/i.test(t), t)));
        ['cluster', 'hud'].forEach((w) => {
            assert.deepStrictEqual([item(w + 'Size').steps, item(w + 'Size').default], [config.sizeSteps, w === 'hud' ? config.hud.defaults.size : 100]);
            assert.deepStrictEqual([item(w + 'Bright').steps, item(w + 'Bright').default], [config.brightSteps, 100]);
            // 0.4.3: Auto / On / Off (Auto follows the car's day / night), default Auto
            assert.deepStrictEqual([item(w + 'NightMode').type, item(w + 'NightMode').default, item(w + 'NightMode').options.map((o) => o[0])], ['choice', 'auto', L.NIGHT_MODES]);
        });
        spec.settings.forEach((s) => assert.ok(/^[\x20-\x7e]+$/.test(s.label), s.label));
        const sig = spec.signals;
        assert.deepStrictEqual(sig['de.bmw.infrastructure.VehicleInformation'], { statusGearboxDrive: 's', DataPowerTrain2: 's' });
        assert.deepStrictEqual(sig['de.bmw.infotainment.vehicle.Vehicle2'], { statusCarSpeed2: 'rs' });
        // the drive mode: subscribe only (no getter needed) and optional, so no G01 refuses the install
        const fes = sig['de.bmw.infotainment.drivingexcitement.FES'];
        assert.strictEqual(fes.statusFESVehicleDynamicSwitchHMI, 's');
        assert.ok(typeof fes._optional === 'string' && fes._optional.length > 10);
        // 0.4.3: the day / night (getter + notifier, as Cluster Info installs it on a G05), optional: a unit without the
        // interface still installs the app (Night dim Auto then stays at full brightness)
        const veh = sig['de.bmw.infotainment.vehicle.Vehicle'];
        assert.deepStrictEqual(Object.keys(veh).sort(), ['_optional', 'statusDayNightChangeOver']);
        assert.strictEqual(veh.statusDayNightChangeOver, 'rs');
        assert.ok(typeof veh._optional === 'string' && /full brightness/.test(veh._optional));
        assert.deepStrictEqual([item('flashMode').type, item('flashMode').default, item('flashMode').options.map((o) => o[0])], ['choice', 'app', L.FLASH_MODES]);
    }],
    ['app.json lead and Fast RPM settings match config.js; bad rpm values fall back; no preview setting left', () => {
        const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'apps', 'adam_shiftlights', 'app.json'), 'utf8'));
        const item = (k) => spec.settings.filter((s) => s.key === k)[0];
        assert.deepStrictEqual([item('leadMs').type, item('leadMs').steps, item('leadMs').default, item('leadMs').unit, item('leadMs').labels['0']],
            ['number', L.LEAD_STEPS, config.rpm.leadMs, 'ms', 'Off']);
        assert.deepStrictEqual([item('rpmPoll').type, item('rpmPoll').default], ['bool', true]);
        [[(c) => { c.rpm.pollMs = 5; }, /^rpm: pollMs must be a whole number 20 to 1000/], [(c) => { c.rpm.minSlope = 0; }, /^rpm: every value/],
            [(c) => { c.rpm.leadMs = 55; }, /^rpm: leadMs must be one of/], [(c) => { c.rpm.maxSlope = 2; }, /^rpm: maxSlope/],
            [(c) => { c.rpm.pollMaxBackoffMs = 30; }, /^rpm: pollMaxBackoffMs/], [(c) => { c.rpm.pollTimeoutMs = 5000; }, /^rpm: pollTimeoutMs/],
            [(c) => { c.rpm = null; }, /^rpm: every value/]].forEach((x) => {
            const r = bad(x[0]);
            hasError(r, x[1]);
            assert.deepStrictEqual(r.cfg.rpm, L.DEFAULTS.rpm);
        });
        hasError(bad((c) => { c.clusterNudge = { x: [5, 10], y: [0] }; }), /^clusterNudge: x and y must be whole numbers/);
        assert.strictEqual(config.previewFps, undefined);
        assert.strictEqual(L.DEFAULTS.previewFps, undefined);
    }],
    ['the HUD draws no speed, unit or line (the stock HUD shows the speed): none in config.js or DEFAULTS', () => {
        [config.hudStyles.bracket, L.DEFAULTS.hudStyles.bracket].forEach((B) => ['unit', 'unitAt', 'line', 'origin', 'below'].forEach((k) => assert.strictEqual(B[k], undefined, k)));
        assert.ok(!/km\/h|kph|mph/.test(fs.readFileSync(path.join(__dirname, '..', '..', 'apps', 'adam_shiftlights', 'hudart.js'), 'utf8')));
    }],
    ['persisted shape unchanged since 0.3.1: every key, type, default, steps, option ids and value labels (old saves keep working)', () => {
        const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'apps', 'adam_shiftlights', 'app.json'), 'utf8'));
        const was = JSON.parse(fs.readFileSync(path.join(__dirname, 'settings_shape_0.3.1.json'), 'utf8'));
        const now = spec.settings.slice().sort((a, b) => (a.key < b.key ? -1 : 1)).map((x) => {
            const e = { key: x.key, type: x.type, default: x.default };
            if (x.steps) e.steps = x.steps;
            if (x.options) e.optionIds = x.options.map((o) => o[0]);
            if (x.labels) e.labelKeys = Object.keys(x.labels).sort();
            if (x.unit) e.unit = x.unit;
            if (x.markDefault !== undefined) e.markDefault = x.markDefault;
            return e;
        });
        // 0.4.1 on purpose: a fresh install starts at Adam's tuned HUD (size, x, y defaults), the shift bar got its own move,
        // and the three shift (all red) settings go in 100 rpm steps (every old step is still one). 0.4.3: the HUD's move
        // steps say which is the default, the bar's own move defaults to 0, the manual night dim (a bool) is replaced by
        // Night dim Auto / On / Off under new keys (a saved true moves to On once: migrateSettings), and Flash mode is new.
        // Nothing else moved: every other key keeps its type, default, steps and option ids.
        const NEW = ['hudBarX', 'hudNightMode', 'clusterNightMode', 'flashMode'], GONE = ['hudNight', 'clusterNight'];
        const evolved = now.filter((e) => NEW.indexOf(e.key) < 0);
        const old = (k) => was.filter((e) => e.key === k)[0];
        assert.deepStrictEqual(evolved.map((e) => e.key), was.map((e) => e.key).filter((k) => GONE.indexOf(k) < 0));
        assert.deepStrictEqual(now.filter((e) => e.key === 'hudBarX').map((e) => [e.default, e.markDefault]), [[0, true]]);
        evolved.forEach((e) => {
            const o = old(e.key);
            if (e.key === 'hudSize') assert.deepStrictEqual(e, Object.assign({}, o, { default: 110 }));
            else if (e.key === 'hudX') assert.deepStrictEqual(e, Object.assign({}, o, { default: -80, markDefault: true }));
            else if (e.key === 'hudY') assert.deepStrictEqual(e, Object.assign({}, o, { default: 60, markDefault: true }));
            else if (/Shift$/.test(e.key)) {
                assert.deepStrictEqual(Object.assign({}, e, { steps: 0 }), Object.assign({}, o, { steps: 0 }), e.key);
                o.steps.filter((v) => v <= 6800).forEach((v) => assert.ok(e.steps.indexOf(v) >= 0, e.key + ' keeps ' + v));
            } else assert.deepStrictEqual(e, o, e.key);
        });
        assert.strictEqual(L.SETTINGS_V, 4, 'one migration since 0.3.1: 0.4.3 (old HUD defaults, night dim)');
    }],
    ['0.4.4 hudCheck: whole numbers in range; a bad value falls back to the defaults with an error line', () => {
        assert.deepStrictEqual(L.validateConfig(copy(config)).cfg.hudCheck, { statusMs: 30000, verifyMs: 5000, gapMs: 3500, maxAuto: 2, wakeGapMs: 30000, manualCooldownMs: 10000, backoffMs: 60000 });
        [['statusMs', 4999], ['statusMs', 300001], ['verifyMs', 1999], ['gapMs', 1000], ['gapMs', 1500.5], ['maxAuto', 6], ['maxAuto', -1], ['wakeGapMs', 9999],
            ['manualCooldownMs', 2999], ['verifyMs', '5000'], ['gapMs', NaN], ['backoffMs', 9999], ['backoffMs', 600001], ['backoffMs', undefined]].forEach((b) => {
            const r = bad((c) => { c.hudCheck[b[0]] = b[1]; });
            hasError(r, new RegExp('^hudCheck: ' + b[0] + ' must be a whole number .*\\(using the default\\)$'));
            assert.deepStrictEqual(r.cfg.hudCheck, L.DEFAULTS.hudCheck, JSON.stringify(b));
        });
        const lo = bad((c) => { c.hudCheck = { statusMs: 5000, verifyMs: 2000, gapMs: 1500, maxAuto: 0, wakeGapMs: 10000, manualCooldownMs: 3000, backoffMs: 10000 }; });
        assert.deepStrictEqual([lo.errors, lo.cfg.hudCheck.maxAuto], [[], 0], 'the low ends are allowed (maxAuto 0: no self-heal)');
        hasError(bad((c) => { delete c.hudCheck; }), /^hudCheck: missing \(using the default\)/);
        hasError(bad((c) => { c.hudCheck = 5; }), /^hudCheck: must be an object/);
    }],
];
