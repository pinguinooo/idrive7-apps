'use strict';
/* main.js end to end with a fake kit ctx (settings, ui, a fake Car that hands back the drive-mode handler) and the
 * real cluster-render client against the fake service: Only in Sport+ follows the car's drive mode, the setting
 * is the fallback with no signal, "Start with the car" off waits for the screen, 0.2.x settings migrate, and the
 * settings pages are drawn only on a change (no render loop, nothing per rpm sample). */
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
const { Recorder } = require(path.join(KIT, 'record.js'));
const themes = require(path.join(KIT, 'themes.js'));
const FES = 'de.bmw.infotainment.drivingexcitement.FES';
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
async function until(fn, ms, what) {
    const end = Date.now() + (ms || 3000);
    while (Date.now() < end) { if (fn()) return; await wait(10); }
    throw new Error('timed out waiting for ' + what);
}

const CDS = 'de.bmw.infotainment.vehicle.CDS';
class FakeCar {
    constructor(ctx, groups, extra) {
        FakeCar.last = this; this.extra = extra || {};
        // with ctx.signals (a test's fake car link), the rpm comes in like the real Car's: through signals.watch
        if (ctx.signals && ctx.signals.watch) {
            ctx.signals.watch(CDS, '1', { statusEngineSpeed2: (v) => this.emit({ rpm: v.actualValueRPMEngineCrankshaft / 4, oil: 95, gear: 3 }, Date.now()) }, ctx.log);
        }
    }
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
        values, get: (k) => values[k], set, onChange: (fn) => listeners.push(fn), schema: SPEC.settings,
        cycle: (k) => { if (item(k).type === 'bool') set(k, !values[k]); },
    };
}

let seq = 0;
/**
 * main.js started on a fresh fake ctx; r.layers() = the layer ops the fake service got so far. own: the kit runs the
 * screen (the Recorder carries page targets). r.ui = what the settings pages did: images drawn, the last frame,
 * the tab handler, hidden buttons, states opened, loops asked for.
 */
function start(saved, visible, signals, own) {
    const sock = path.join(os.tmpdir(), 'sl-main-' + process.pid + '-' + (++seq) + '.sock');
    const msgs = [], lines = [], vis = [], clicks = {};
    const U = { images: 0, frame: null, tab: null, layout: null, hidden: [], opened: [], loops: 0 };
    const fake = createFake(sock, (m) => msgs.push(m));
    const settings = settingsOf(saved);
    const log = { info: (m) => lines.push(m), warn: (m) => lines.push('WARN ' + m), error: (m) => lines.push('ERR ' + m) };
    const ctx = {
        settings, log, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sl-main-data-')),
        spec: SPEC,
        ui: {
            isVisible: (n) => n === 'MAIN' && !!visible, onVisible: (fn) => vis.push(fn), onClick: (id, fn) => { clicks[id] = fn; },
            image: (id, cv) => { U.images++; U.frame = cv; return Promise.resolve(); }, open: (n) => { U.opened.push(n); return Promise.resolve(); },
        },
        loop: () => { U.loops++; }, theme: () => themes.theme('m_tricolour'), signals,
        canvas: (w, h) => { const r = new Recorder(w, h, { textScale: 1 }).reset(); r.own = !!own; r.chrome = own ? { tabs: null } : null; return r; },
        onTab: (fn) => { U.tab = fn; }, onLayout: (fn) => { U.layout = fn; }, hideButton: (id) => U.hidden.push(id),
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
        settings, lines, clicks, car: FakeCar.last, msgs, ui: U,
        press: (key) => U.frame.targets.filter((g) => g.key === key)[0].run(),
        layers: () => msgs.filter((m) => m.op === 'layer' && !msgs.some((d) => d.op === 'drop' && d.ref === m.ref && d.conn === m.conn)),
        show: (v) => { visible = v; vis.forEach((fn) => fn('MAIN', v)); },
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
    ['a 0.3.0 save (no leadMs, no rpmPoll) starts with lead 60 ms and the rpm poll on; garbage leadMs warns once, no ERR', async () => {
        const r = await start({ _settingsV: 3, hudOn: true, hudStyle: 'bar', leadMs: undefined, rpmPoll: undefined });
        assert.ok(r.lines.some((l) => /^started: .*, lead 60 ms, rpm poll on$/.test(l)), r.lines.join('\n'));
        r.sample(6500);
        await until(() => r.layers().length === 1, 3000, 'a layer');
        await r.done();
        const g = await start({ _settingsV: 3, hudOn: true, hudStyle: 'bar', leadMs: 'fast', rpmPoll: 'x' });
        for (let i = 0; i < 5; i++) g.sample(6000 + i * 100);
        await until(() => g.layers().length === 1, 3000, 'a layer');
        assert.ok(g.lines.some((l) => /, lead 60 ms, rpm poll on$/.test(l)), g.lines.join('\n'));
        assert.strictEqual(g.lines.filter((l) => /^WARN settings: leadMs: "fast"/.test(l)).length, 1, g.lines.join('\n'));
        assert.ok(!g.lines.some((l) => /^ERR/.test(l)), g.lines.join('\n'));
        await g.done();
    }],
    ['Fast RPM: with no notifications the getter feeds Car\'s own rpm handler; off, it is never called', async () => {
        const run = async (poll) => {
            const calls = [];
            const signals = { watch: () => Promise.resolve({ available: true, proxy: { getValue: (f) => { calls.push(f); return Promise.resolve({ actualValueRPMEngineCrankshaft: 6500 * 4 }); } } }) };
            const r = await start({ _settingsV: 3, hudOn: true, hudStyle: 'bar', rpmPoll: poll }, false, signals);
            await wait(300);
            const lit = r.msgs.filter((m) => m.op === 'uniform' && m.name === 'u_st' && Number(m.v.split(' ')[0]) > 0).length;
            const out = { calls: calls.length, lit, field: calls[0], lines: r.lines };
            await r.done();
            return out;
        };
        const on = await run(true);
        assert.ok(on.calls >= 3 && on.field === 'statusEngineSpeed2', JSON.stringify(on));
        assert.ok(on.lit >= 1, 'the polled 6500 rpm lit the bar');
        const off = await run(false);
        assert.deepStrictEqual([off.calls, off.lit], [0, 0]);
        assert.ok(off.lines.some((l) => /rpm poll off$/.test(l)));
    }],
    ['no timer redraws the settings pages: one draw per change, none for rpm samples or idle; no ctx.loop', async () => {
        const r = await start({ _settingsV: 3, hudOn: true, clusterOn: true, hudStyle: 'bar' }, true, undefined, true);
        await until(() => r.ui.images >= 1, 3000, 'the first draw');
        await wait(50);
        const n0 = r.ui.images;
        assert.ok(n0 <= 2, 'start draws once (a coalesced change): ' + n0);
        const t0 = Date.now();
        while (Date.now() - t0 < 1000) { r.sample(3000 + (Date.now() - t0) * 3); await wait(20); }      // 50 Hz for 1 s
        await wait(1500);
        assert.strictEqual(r.ui.images, n0, 'no draw from rpm samples or idle time');
        assert.strictEqual(r.ui.loops, 0, 'no ctx.loop');
        const one = async (what, fn) => { const a = r.ui.images; fn(); await wait(40); assert.strictEqual(r.ui.images, a + 1, what); };
        await one('a setting', () => r.settings.set('hudSize', 110));
        await one('a page button', () => r.press('home:bothMode:cluster'));
        assert.strictEqual(r.settings.get('bothMode'), 'cluster');
        await one('a tab', () => r.ui.tab(2));
        assert.deepStrictEqual(r.ui.frame.chrome.tabs.sel, 2);
        await one('the car\'s drive mode', () => r.car.mode(2));
        await one('the layout', () => r.ui.layout());
        // several changes at once: one draw
        await one('three settings in a row', () => { r.settings.set('hudSize', 120); r.settings.set('hudBright', 80); r.settings.set('hudNight', true); });
        // hidden: nothing drawn, shown again: drawn
        const before = r.ui.images;
        r.show(false);
        r.settings.set('hudSize', 100);
        await wait(40);
        assert.strictEqual(r.ui.images, before, 'nothing drawn while hidden');
        await one('shown again', () => r.show(true));
        assert.ok(!r.lines.some((l) => /^ERR/.test(l)), r.lines.join('\n'));
        await r.done();
    }],
    ['the pages do the bar\'s jobs where the kit runs the screen: three bar buttons hidden; BTN_ALL opens the settings list', async () => {
        const r = await start({ _settingsV: 3 }, true, undefined, true);
        assert.deepStrictEqual(r.ui.hidden, ['BTN_HUD', 'BTN_CLUSTER', 'BTN_ALL']);
        r.clicks.BTN_ALL();
        assert.deepStrictEqual(r.ui.opened, ['SETTINGS']);
        await until(() => r.ui.images >= 1, 3000, 'a draw');
        await wait(30);
        r.press('home:hudOn');
        assert.strictEqual(r.settings.get('hudOn'), true);
        r.press('home:alloff');
        assert.deepStrictEqual([r.settings.get('hudOn'), r.settings.get('clusterOn')], [false, false]);
        await r.done();
    }],
    ['a 0.3.1 save with every key (garbage too) and a 0.2.x save start without an ERR and draw every page', async () => {
        const saved031 = { _settingsV: 3, hudOn: 'yes', clusterOn: true, bothMode: 'x', hudStyle: {}, hudSize: 999, hudBright: 'x', hudNight: null, hudX: 'far', hudY: 7,
            clusterStyle: 'classic', clusterSize: -1, clusterX: 3, clusterY: 'x', onlySportPlus: 'x', autoStart: 0, leadMs: 'fast', rpmPoll: 'x', driveMode: 9,
            comfortStart: 'x', comfortShift: 999, sportStart: null, sportShift: 6800, sportplusStart: 6500, sportplusShift: 6500, layout: 'x', renderer: 7, demo: null };
        for (const saved of [saved031, { enabled: true, display: 'both', hudStyle: 'off', clusterStyle: 'row' }]) {
            const r = await start(saved, true, undefined, true);
            await until(() => r.ui.images >= 1, 3000, 'a draw');
            for (let i = 0; i < 5; i++) {
                const a = r.ui.images;
                r.ui.tab(i);
                await until(() => r.ui.images > a, 3000, 'page ' + i);
                assert.ok(r.ui.frame.targets.length > 0 || i === 1 || i === 2, 'page ' + i + ' has targets');
            }
            assert.ok(!r.lines.some((l) => /^ERR/.test(l)), r.lines.join('\n'));
            await r.done();
        }
    }],
];
