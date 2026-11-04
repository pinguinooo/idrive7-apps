'use strict';
/* main.js end to end with a fake kit ctx (settings, ui, a fake Car that hands back the drive-mode handler) and the
 * real cluster-render client against the fake service: Only in Sport+ follows the car's drive mode, the setting
 * is the fallback with no signal, "Start with the car" off waits for the screen, and 0.2.x settings migrate. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { createFake } = require('./fake_cluster_render');

const KIT = path.join(__dirname, '..', '..', 'kit', 'runtime');
const APP = path.join(__dirname, '..', '..', 'apps', 'adam_shiftlights');
const MAIN = path.join(APP, 'main.js');
const SPEC = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));
const FES = 'de.bmw.infotainment.drivingexcitement.FES';
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
async function until(fn, ms, what) {
    const end = Date.now() + (ms || 3000);
    while (Date.now() < end) { if (fn()) return; await wait(10); }
    throw new Error('timed out waiting for ' + what);
}

class FakeCar {
    constructor(ctx, groups, extra) { FakeCar.last = this; this.extra = extra || {}; }
    onSample(fn) { this.emit = fn; }
    mode(v) { this.extra[FES].statusFESVehicleDynamicSwitchHMI({ actualValueModeDrivingExperience: v }); }
}

/** The kit's Settings, as far as main.js uses it: defaults from app.json, then the saved values. */
function settingsOf(saved) {
    const values = {}, listeners = [];
    SPEC.settings.forEach((s) => { values[s.key] = s.default; });
    Object.assign(values, saved);
    const item = (k) => SPEC.settings.filter((s) => s.key === k)[0];
    const set = (k, v) => { values[k] = v; listeners.forEach((fn) => fn(k, v)); };
    return {
        values, get: (k) => values[k], set, onChange: (fn) => listeners.push(fn),
        cycle: (k) => { if (item(k).type === 'bool') set(k, !values[k]); },
    };
}

let seq = 0;
/** main.js started on a fresh fake ctx; r.layers() = the layer ops the fake service got so far. */
function start(saved, visible) {
    const sock = path.join(os.tmpdir(), 'sl-main-' + process.pid + '-' + (++seq) + '.sock');
    const msgs = [], lines = [], vis = [], clicks = {};
    const fake = createFake(sock, (m) => msgs.push(m));
    const settings = settingsOf(saved);
    const log = { info: (m) => lines.push(m), warn: (m) => lines.push('WARN ' + m), error: (m) => lines.push('ERR ' + m) };
    const ctx = {
        settings, log, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sl-main-data-')),
        ui: { isVisible: (n) => n === 'MAIN' && !!visible, onVisible: (fn) => vis.push(fn), onClick: (id, fn) => { clicks[id] = fn; }, image: () => Promise.resolve() },
        loop: () => {}, theme: () => ({}), canvas: () => null,
    };
    const realResolve = Module._resolveFilename;
    Module._resolveFilename = function (req, parent) {
        if (/^\.\/kit\//.test(req) && parent && parent.filename && path.dirname(parent.filename) === APP) return realResolve.call(this, path.join(KIT, req.slice(6)), parent);
        return realResolve.apply(this, arguments);
    };
    let app = null;
    const fakeMod = (file, exp) => { const id = path.join(KIT, file); require.cache[id] = { id, filename: id, loaded: true, exports: exp }; };
    try {
        process.env.SHIFTLIGHTS_CR_SOCKET = sock;
        fakeMod('mgu.js', { run: (a) => { app = a; } });
        fakeMod('car.js', FakeCar);
        delete require.cache[MAIN];
        require(MAIN);
    } finally {
        Module._resolveFilename = realResolve;
        delete require.cache[path.join(KIT, 'mgu.js')];
        delete require.cache[path.join(KIT, 'car.js')];
    }
    const started = Promise.resolve(app.start(ctx));      // reads SHIFTLIGHTS_CR_SOCKET
    delete process.env.SHIFTLIGHTS_CR_SOCKET;
    return started.then(() => ({
        settings, lines, clicks, car: FakeCar.last, msgs,
        layers: () => msgs.filter((m) => m.op === 'layer' && !msgs.some((d) => d.op === 'drop' && d.ref === m.ref && d.conn === m.conn)),
        show: (v) => vis.forEach((fn) => fn('MAIN', v)),
        sample: (rpm) => FakeCar.last.emit({ rpm, oil: 95, gear: 3 }),
        done: () => new Promise((res) => { settings.set('hudOn', false); settings.set('clusterOn', false); setTimeout(() => fake.close(res), 50); }),
    }));
}

module.exports = [
    ['Only in Sport+: nothing in Sport (setting), the HUD lights once the car says Sport+, gone again in Sport', async () => {
        const r = await start({ _settingsV: 3, hudOn: true, onlySportPlus: true, driveMode: 'sport', hudStyle: 'bar' });
        r.sample(3000);
        await wait(150);
        assert.strictEqual(r.layers().length, 0, 'held in Sport');
        r.car.mode(2);
        r.sample(3000);
        await until(() => r.layers().length === 1, 3000, 'HUD bar in Sport+');
        assert.strictEqual(r.layers()[0].target, 'hud');
        assert.ok(r.lines.some((l) => /car drive mode 2 -> sportplus/.test(l)), r.lines.join('\n'));
        r.car.mode('SPORT_DYNAMIC');
        await until(() => r.layers().length === 0, 3000, 'dropped in Sport');
        r.car.mode(0);          // the car sends no mode: back to the setting
        r.settings.set('driveMode', 'sportplus');
        await until(() => r.layers().length === 1, 3000, 'setting fallback Sport+');
        await r.done();
    }],
    ['no drive-mode signal at all: the setting decides; the HUD and cluster buttons toggle each display alone', async () => {
        const r = await start({ _settingsV: 3, onlySportPlus: true, driveMode: 'sportplus', hudStyle: 'bracket', clusterStyle: 'row' });
        r.sample(3000);
        await wait(100);
        assert.strictEqual(r.layers().length, 0, 'both off');
        r.clicks.BTN_HUD();
        await until(() => r.layers().length === 2, 3000, 'HUD on');
        assert.deepStrictEqual([r.settings.get('hudOn'), r.settings.get('clusterOn')], [true, false]);
        r.clicks.BTN_CLUSTER();
        await wait(150);
        assert.deepStrictEqual(r.layers().map((m) => m.target).sort(), ['hud', 'hud'], 'both on: the HUD wins by default');
        r.settings.set('bothMode', 'cluster');
        await until(() => r.layers().length === 1 && r.layers()[0].target === 'panel', 3000, 'both on, the cluster wins: the panel');
        r.settings.set('bothMode', 'hud');
        await until(() => r.layers().length === 2 && r.layers().every((m) => m.target === 'hud'), 3000, 'back to the HUD');
        r.clicks.BTN_HUD();
        await until(() => r.layers().length === 1 && r.layers()[0].target === 'panel', 3000, 'cluster alone, on the panel');
        assert.deepStrictEqual([r.settings.get('hudOn'), r.settings.get('clusterOn')], [false, true]);
        await r.done();
    }],
    ['Start with the car off: nothing is sent until the app screen was shown once', async () => {
        const r = await start({ _settingsV: 3, hudOn: true, autoStart: false, hudStyle: 'bar' });
        r.sample(3000);
        await wait(150);
        assert.strictEqual(r.layers().length, 0);
        r.show(true);
        await until(() => r.layers().length === 1, 3000, 'shown after the screen opened');
        r.show(false);
        r.sample(3100);
        await wait(100);
        assert.strictEqual(r.layers().length, 1, 'stays on after the screen closes');
        await r.done();
        const a = await start({ _settingsV: 3, hudOn: true, hudStyle: 'bar' });   // on (the default): at once
        a.sample(3000);
        await until(() => a.layers().length === 1, 3000, 'autostart on');
        await a.done();
    }],
    ['0.2.x settings migrate on start (no crash, saved once); garbage falls back', async () => {
        const r = await start({ enabled: true, display: 'both', hudStyle: 'off', clusterStyle: 'row' });
        assert.deepStrictEqual(['hudOn', 'clusterOn', 'hudStyle', 'clusterStyle', '_settingsV'].map(r.settings.get), [false, true, 'large', 'row', 3]);
        assert.ok(r.lines.some((l) => /^settings migrated to v3/.test(l)));
        r.sample(3000);
        await until(() => r.layers().length === 1 && r.layers()[0].target === 'panel', 3000, 'cluster row on the panel');
        await r.done();
        const g = await start({ enabled: 'x', display: 7, hudStyle: {}, clusterStyle: null, hudOn: 'yes', hudX: 'far', driveMode: 9 });
        g.sample(3000);
        await wait(100);
        assert.deepStrictEqual([g.settings.get('hudOn'), g.settings.get('clusterOn'), g.layers().length], [false, false, 0]);
        assert.ok(!g.lines.some((l) => /^ERR/.test(l)), g.lines.join('\n'));
        await g.done();
        const again = await start({ _settingsV: 3, enabled: false, display: 'off', hudOn: true });   // migrated already: untouched
        assert.strictEqual(again.settings.get('hudOn'), true);
        assert.ok(!again.lines.some((l) => /migrated/.test(l)));
        await again.done();
    }],
];
