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
const L = require(path.join(APP, 'logic.js'));
const cfg = L.validateConfig(require(path.join(APP, 'config.js'))).cfg;
const FES = 'de.bmw.infotainment.drivingexcitement.FES';
const VEHICLE = 'de.bmw.infotainment.vehicle.Vehicle';
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
        // with ctx.signals (a test's fake car link), the rpm comes in like the real Car's: through signals.watch, and so
        // does every extra interface (the drive mode, the day / night)
        if (ctx.signals && ctx.signals.watch) {
            ctx.signals.watch(CDS, '1', { statusEngineSpeed2: (v) => this.emit({ rpm: v.actualValueRPMEngineCrankshaft / 4, oil: 95, gear: 3 }, Date.now()) }, ctx.log);
            Object.keys(this.extra).forEach((iface) => ctx.signals.watch(iface, '1', this.extra[iface], ctx.log));
        }
    }
    onSample(fn) { this.emit = fn; }
    mode(v) { this.extra[FES].statusFESVehicleDynamicSwitchHMI({ actualValueModeDrivingExperience: v }); }
    /** The car's day / night as the binding hands it over (seen on a G05: the enum's name) */
    dayNight(v) { this.extra[VEHICLE].statusDayNightChangeOver({ dayNightChangeOver: v }); }
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
function start(saved, visible, signals, own, more) {
    const sock = path.join(os.tmpdir(), 'sl-main-' + process.pid + '-' + (++seq) + '.sock');
    const msgs = [], lines = [], vis = [], clicks = {}, x = more || {};
    const U = { images: 0, frame: null, tab: null, layout: null, hidden: [], opened: [], loops: 0 };
    const fake = createFake(sock, (m) => msgs.push(Object.assign({ t: Date.now() }, m)), null, { mode: x.mode });
    // 0.4.4: shorter HUD check timings (config.js swapped for this start only; the object is put back, never deleted)
    const CFG = path.join(APP, 'config.js'), realCfg = require(CFG);
    if (x.hudCheck) require.cache[CFG].exports = Object.assign({}, realCfg, { hudCheck: Object.assign({}, realCfg.hudCheck, x.hudCheck) });
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
        canvas: (w, h) => {
            const r = new Recorder(w, h, { textScale: 1 }).reset(), text = r.text;
            r.own = !!own; r.chrome = own ? { tabs: null } : null; r.texts = [];
            r.text = function (str) { r.texts.push(String(str)); return text.apply(this, arguments); };   // what the page says
            return r;
        },
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
    require.cache[CFG].exports = realCfg;
    return started.then(() => ({
        settings, lines, clicks, car: FakeCar.last, msgs, ui: U, fake,
        press: (key) => U.frame.targets.filter((g) => g.key === key)[0].run(),
        layers: () => msgs.filter((m) => m.op === 'layer' && !msgs.some((d) => d.op === 'drop' && d.ref === m.ref && d.conn === m.conn)),
        show: (v) => { visible = v; vis.forEach((fn) => fn('MAIN', v)); },
        sample: (rpm) => FakeCar.last.emit({ rpm, oil: 95, gear: 3 }),
        done: () => new Promise((res) => { settings.set('hudOn', false); settings.set('clusterOn', false); setTimeout(() => fake.close(res), 50); }),
    }));
}

/** Date.now moved forward by add(ms) (a jump under wakeGapMs is not a wake); restore() puts the real one back. */
function fakeClock() {
    const realNow = Date.now;
    let off = 0;
    Date.now = () => realNow() + off;
    return { add: (ms) => { off += ms; }, restore: () => { Date.now = realNow; } };
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
        assert.deepStrictEqual(['hudOn', 'clusterOn', 'hudStyle', 'clusterStyle', '_settingsV'].map(r.settings.get), [false, true, 'large', 'row', L.SETTINGS_V]);
        assert.ok(r.lines.some((l) => /^settings migrated to v4/.test(l)));
        r.sample(3000);
        await until(() => r.layers().length === 1 && r.layers()[0].target === 'panel', 3000, 'cluster row on the panel');
        await r.done();
        const g = await start({ enabled: 'x', display: 7, hudStyle: {}, clusterStyle: null, hudOn: 'yes', hudX: 'far', driveMode: 9 });
        g.sample(3000);
        await wait(100);
        assert.deepStrictEqual([g.settings.get('hudOn'), g.settings.get('clusterOn'), g.layers().length], [false, false, 0]);
        assert.ok(!g.lines.some((l) => /^ERR/.test(l)), g.lines.join('\n'));
        await g.done();
        const again = await start({ _settingsV: L.SETTINGS_V, enabled: false, display: 'off', hudOn: true });   // migrated already: untouched
        assert.strictEqual(again.settings.get('hudOn'), true);
        assert.ok(!again.lines.some((l) => /migrated/.test(l)));
        await again.done();
    }],
    ['a 0.3.0 save (no leadMs, no rpmPoll) starts with lead 60 ms and the rpm poll on; garbage leadMs warns once, no ERR', async () => {
        const r = await start({ _settingsV: 3, hudOn: true, hudStyle: 'bar', leadMs: undefined, rpmPoll: undefined });
        assert.ok(r.lines.some((l) => /^started: .*, lead 60 ms, rpm poll on, hudcheck verify \d+ gap \d+ max \d+ backoff \d+$/.test(l)), r.lines.join('\n'));
        r.sample(6500);
        await until(() => r.layers().length === 1, 3000, 'a layer');
        await r.done();
        const g = await start({ _settingsV: 3, hudOn: true, hudStyle: 'bar', leadMs: 'fast', rpmPoll: 'x' });
        for (let i = 0; i < 5; i++) g.sample(6000 + i * 100);
        await until(() => g.layers().length === 1, 3000, 'a layer');
        assert.ok(g.lines.some((l) => /, lead 60 ms, rpm poll on, hudcheck /.test(l)), g.lines.join('\n'));
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
        assert.ok(off.lines.some((l) => /rpm poll off, hudcheck verify 5000 gap 3500 max 2 backoff 60000$/.test(l)));
    }],
    ['no timer redraws the settings pages: one draw per change, none for rpm samples or idle; no ctx.loop', async () => {
        const r = await start({ _settingsV: 3, hudOn: true, clusterOn: true, hudStyle: 'bar' }, true, undefined, true);
        await until(() => r.ui.images >= 1, 3000, 'the first draw');
        await wait(50);
        // start draws once (a coalesced change); 0.4.4: the renderer's first answers (target event, read-back) may add two
        assert.ok(r.ui.images <= 4, 'start draws once, plus the renderer\'s answers: ' + r.ui.images);
        // 0.4.4: the renderer's answers redraw the card until the read-back confirms it (then idle again)
        await until(() => r.ui.frame.texts.indexOf('Showing: the renderer drew it') >= 0, 3000, 'the read-back verdict');
        await wait(50);
        const n0 = r.ui.images;
        const t0 = Date.now();
        while (Date.now() - t0 < 1000) { r.sample(3000 + (Date.now() - t0) * 3); await wait(20); }      // 50 Hz for 1 s
        await wait(1500);
        assert.strictEqual(r.ui.images, n0, 'no draw from rpm samples or idle time');
        assert.strictEqual(r.ui.loops, 0, 'no ctx.loop');
        // 0.4.4: a change that makes new layers is drawn once, then at most twice more as the renderer's answers change what
        // the card says (the target event, then the status read-back); then nothing more (a reply redraws only when the page would change)
        const one = async (what, fn, layers) => {
            const a = r.ui.images;
            fn();
            await wait(40);
            if (!layers) { assert.strictEqual(r.ui.images, a + 1, what); return; }
            await wait(800);
            assert.ok(r.ui.images >= a + 1 && r.ui.images <= a + 3, what + ': ' + (r.ui.images - a) + ' draws');
        };
        await one('a setting', () => r.settings.set('hudSize', 110), true);
        await one('a page button', () => r.press('home:bothMode:cluster'), true);
        assert.strictEqual(r.settings.get('bothMode'), 'cluster');
        await one('a tab', () => r.ui.tab(2));
        assert.deepStrictEqual(r.ui.frame.chrome.tabs.sel, 2);
        await one('the car\'s drive mode', () => r.car.mode(2));
        await one('the layout', () => r.ui.layout());
        // several changes at once: one draw
        await one('three settings in a row', () => { r.settings.set('hudSize', 120); r.settings.set('hudBright', 80); r.settings.set('hudNight', true); }, true);
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
    ['0.4.2 (Flash mode Renderer): at the shift point every effect layer on both targets gets flash 1 and all lights in one step, every HUD style; 1 rpm under none; off 50 under', async () => {
        const r = await start({ _settingsV: 3, hudOn: true, clusterOn: true, bothMode: 'map', driveMode: 'sportplus', leadMs: 0, flashMode: 'renderer' });
        const key = (m) => m.conn + ':' + m.ref, ops = (op, l) => r.msgs.filter((m) => m.op === op && key(m) === key(l));
        const effects = () => r.layers().filter((m) => m.kind === 'effect');
        const st = (l) => { const u = ops('uniform', l).filter((m) => m.name === 'u_st').pop(); return u ? u.v.split(' ').map(Number) : []; };
        // lights a style shows (0.4.3: the HUD bar is the cluster's Large M slats, 10 with 2 reds)
        const lt = (l) => L.lightsOf(cfg, l.target === 'hud' ? 'hud' : 'cluster', 'large');
        const fill = (l) => /u_path/.test(l.fs), n = (l) => lt(l).count, reds = (l) => lt(l).reds;
        // flash 1: every light (cluster large 10, HUD bar 8); flash 0 here: all but the reds (just under the shift point, or
        // just after the flash ended); the fill's end is past 0 once the rpm got there; one running animation per flashing layer
        const settled = (flash) => effects().length && effects().every((l) => st(l)[1] === flash && ops('animate', l).length - ops('stop', l).length === flash &&
            (fill(l) ? st(l)[0] > 0 : st(l)[0] === (flash ? n(l) : n(l) - reds(l))));
        const at = async (rpm, flash, what) => { r.sample(rpm); await until(() => settled(flash), 3000, what + ': flash ' + flash); };
        /** a setting that makes new layers: wait until every live effect layer is a new one */
        const swap = async (k, v) => { const old = effects().map(key); r.settings.set(k, v); await until(() => effects().length && effects().every((l) => old.indexOf(key(l)) < 0), 3000, k + ' ' + v); };
        await at(6799, 0, 'large / large at 6799');
        assert.deepStrictEqual(effects().map((l) => l.target).sort(), ['hud', 'hud', 'map']);
        await at(6800, 1, 'large / large at 6800');
        assert.ok(r.msgs.filter((m) => m.op === 'animate').every((a) => a.keys === '0:1 125:0 250:1'), 'the 4 Hz step animation');
        await at(6750, 1, 'held at 6750');
        await at(6749, 0, 'off at 6749');
        for (const h of ['classic', 'bar', 'bracket']) {
            await swap('hudStyle', h);
            await at(6799, 0, h + ' at 6799');
            await at(6800, 1, h + ' at 6800');
            await at(6749, 0, h + ' off at 6749');      // under the hysteresis before the next style (a new style starts from off)
        }
        await swap('hudOn', false);             // the cluster alone, on its own panel target
        await at(6799, 0, 'panel at 6799');
        assert.deepStrictEqual(effects().map((l) => l.target), ['panel']);
        await at(6800, 1, 'panel at 6800');
        const states = r.lines.filter((l) => /^state /.test(l));
        assert.ok(states.some((l) => /"red":true,"flash":true/.test(l)) && !states.some((l) => /"red":true,"flash":false|"red":false,"flash":true/.test(l)), states.join('\n'));
        assert.ok(!r.lines.some((l) => /^ERR/.test(l)), r.lines.join('\n'));
        await r.done();
    }],
    ['0.4.3 Flash mode App (default): u_on 1 before the flash u_st on every layer, then 1 / 0 every 125 ms, all in step, no animation; it stops the moment the flash ends', async () => {
        const r = await start({ _settingsV: L.SETTINGS_V, hudOn: true, clusterOn: true, bothMode: 'map', driveMode: 'sportplus', leadMs: 0 });
        const key = (m) => m.conn + ':' + m.ref, effects = () => r.layers().filter((m) => m.kind === 'effect');
        r.sample(6799);
        await until(() => effects().length === 3, 3000, 'three effect layers (map slats, HUD slats, HUD fill)');
        await wait(100);
        const n0 = r.msgs.length;
        r.sample(6800);
        await wait(700);
        r.sample(6749);
        await wait(500);
        const after = r.msgs.slice(n0), runs = [];
        effects().forEach((l) => {
            const mine = after.filter((m) => m.op === 'uniform' && key(m) === key(l));
            const iFlash = mine.findIndex((m) => m.name === 'u_st' && m.v.split(' ')[1] === '1');
            const iEnd = mine.findIndex((m, i) => i > iFlash && m.name === 'u_st' && m.v.split(' ')[1] === '0');
            const ons = mine.filter((m, i) => m.name === 'u_on' && i < iEnd);
            const what = l.target + ' ' + (/u_path/.test(l.fs) ? 'fill' : 'slats') + ': ' + mine.map((m) => m.name + '=' + m.v).join(' | ');
            // lit from the first frame: its u_on 1 went before the u_st that starts the flash (a 0.4.2 layer starts at 1 already)
            const iOn = mine.findIndex((m) => m.name === 'u_on');
            assert.ok(iFlash >= 0 && iEnd > iFlash && (iOn < 0 || iOn < iFlash || mine[iOn].v === '0'), what);
            assert.ok(ons.length >= 4 && ons.length <= 8, ons.length + ' toggles in 700 ms: ' + what);
            ons.forEach((m, i) => assert.strictEqual(m.v, i % 2 ? '1' : '0', 'starts lit (the layer\'s 1), then 0, 1, ...: ' + what));
            for (let i = 1; i < ons.length; i++) assert.ok(ons[i].t - ons[i - 1].t >= 100, 'never faster than every 125 ms: ' + (ons[i].t - ons[i - 1].t));
            assert.ok(!mine.some((m, i) => m.name === 'u_on' && i > iEnd), 'no u_on after the flash ended: ' + what);
            runs.push(ons.map((m) => m.v).join(''));
        });
        assert.ok(runs.every((x) => x === runs[0]), 'every layer in step: ' + runs.join(' / '));
        // the next flash starts lit again, whatever half the last one ended in: the newest u_on before its u_st is 1
        const n1 = r.msgs.length;
        r.sample(6800);
        await wait(60);
        effects().forEach((l) => {
            const all = r.msgs.filter((m) => m.op === 'uniform' && key(m) === key(l));
            const iFlash2 = all.findIndex((m) => r.msgs.indexOf(m) >= n1 && m.name === 'u_st' && m.v.split(' ')[1] === '1');
            const lastOn = all.slice(0, iFlash2).filter((m) => m.name === 'u_on').pop();
            assert.ok(iFlash2 > 0 && lastOn && lastOn.v === '1', l.target + ': ' + (lastOn && lastOn.v));
        });
        r.sample(6000);
        assert.strictEqual(after.filter((m) => m.op === 'animate').length, 0, 'no renderer animation');
        assert.ok(r.lines.some((l) => /^started: .*, flash app, night dim hud auto cluster auto, lead 0 ms/.test(l)), r.lines.join('\n'));
        await r.done();
    }],
    ['0.4.3 Night dim Auto: the car\'s NACHT dims at once, TAG goes back only after it held 5 s; On / Off ignore the car; the page says which and the last value', async () => {
        const realNow = Date.now;
        let skew = 0;
        Date.now = () => realNow() + skew;
        try {
            const r = await start({ _settingsV: L.SETTINGS_V, hudOn: true, hudStyle: 'bar' }, true, undefined, true);
            r.sample(3000);
            await until(() => r.layers().length === 1, 3000, 'the HUD bar');
            const level = () => { const l = r.layers()[0], u = r.msgs.filter((m) => m.op === 'uniform' && m.name === 'u_st' && m.ref === l.ref && m.conn === l.conn).pop(); return u ? Number(u.v.split(' ')[2]) : NaN; };
            const says = async (text) => { r.ui.tab(1); await until(() => r.ui.frame && r.ui.frame.texts.indexOf(text) >= 0, 3000, '"' + text + '" in ' + (r.ui.frame && r.ui.frame.texts.join(' | '))); };
            await until(() => level() === 1, 3000, 'full brightness with no signal');
            await says('Auto, no day / night signal from the car yet: full brightness');
            r.car.dayNight('NACHT');
            await until(() => level() === cfg.nightDim, 3000, 'dimmed at once (the first word)');
            assert.ok(r.lines.indexOf('car day/night {"dayNightChangeOver":"NACHT"} -> night') >= 0, r.lines.join('\n'));
            assert.ok(r.lines.indexOf('night dim auto: the car says night ("NACHT")') >= 0, r.lines.join('\n'));
            await says('Auto, car says night (NACHT): dimmed to 35%');
            r.car.dayNight('TAG');
            await wait(1300);                       // the 1 s timer ran: the hold keeps it dimmed
            assert.strictEqual(level(), cfg.nightDim, 'held');
            skew += cfg.nightHoldMs;
            await until(() => level() === 1, 3000, 'full again once TAG held 5 s');
            r.car.dayNight(1);                      // the number form: still day, nothing changes
            r.car.dayNight('KEINE_AENDERUNG');      // no change: keeps day
            await wait(50);
            assert.strictEqual(level(), 1);
            await says('Auto, car says no day / night word (KEINE_AENDERUNG): full brightness');
            r.settings.set('hudNightMode', 'on');
            await until(() => level() === cfg.nightDim, 3000, 'On: dimmed in daylight');
            await says('On: dimmed to 35% (car says no day / night word (KEINE_AENDERUNG))');
            r.settings.set('hudNightMode', 'off');
            r.car.dayNight(2);
            skew += cfg.nightHoldMs;
            await wait(1300);
            assert.strictEqual(level(), 1, 'Off: never dimmed, night or not');
            r.settings.set('hudNightMode', 'auto');
            await until(() => level() === cfg.nightDim, 3000, 'Auto again: the car says night');
            assert.ok(!r.lines.some((l) => /^ERR/.test(l)), r.lines.join('\n'));
            await r.done();
        } finally { Date.now = realNow; }
    }],
    ['0.4.3 Night dim Auto with no day / night interface on the unit (the watch fails): full brightness, the page says so, no ERR', async () => {
        const signals = { watch: (iface) => Promise.resolve(iface === VEHICLE ? { available: false, error: 'Error: no SOME/IP config for ' + VEHICLE } : { available: false, error: null }) };
        const r = await start({ _settingsV: L.SETTINGS_V, hudOn: true, hudStyle: 'bar' }, true, signals, true);
        r.sample(3000);
        await until(() => r.layers().length === 1, 3000, 'the HUD bar');
        r.ui.tab(1);
        await until(() => r.ui.frame && r.ui.frame.texts.indexOf('Auto, this car sends no day / night signal: full brightness') >= 0, 3000, 'the missing line');
        const u = r.msgs.filter((m) => m.op === 'uniform' && m.name === 'u_st').pop();
        assert.strictEqual(Number(u.v.split(' ')[2]), 1);
        assert.ok(!r.lines.some((l) => /^ERR/.test(l)), r.lines.join('\n'));
        await r.done();
    }],
    ['0.4.3 a 0.4.2 save holding the old defaults moves to today\'s once; chosen values stay; Reset HUD to defaults asks first, then sets size, move and bar move back', async () => {
        const r = await start({ _settingsV: 3, hudOn: true, hudSize: 100, hudX: 0, hudY: 0, hudBarX: 70, hudNight: true, clusterNight: false, clusterSize: 120 }, true, undefined, true);
        const D = cfg.hud.defaults;
        assert.deepStrictEqual(['hudSize', 'hudX', 'hudY', 'hudBarX', 'hudNightMode', 'clusterNightMode', 'clusterSize', '_settingsV'].map(r.settings.get),
            [D.size, D.x, D.y, D.barX, 'on', 'auto', 120, L.SETTINGS_V]);
        assert.ok(r.lines.some((l) => /^settings migrated to v4: .*"hudSize",110.*"hudX",-80.*"hudY",60.*"hudBarX",0.*"hudNightMode","on"/.test(l)), r.lines.join('\n'));
        const chosen = await start({ _settingsV: 3, hudOn: true, hudSize: 120, hudX: -40, hudY: 30, hudBarX: 15 }, true, undefined, true);
        assert.deepStrictEqual(['hudSize', 'hudX', 'hudY', 'hudBarX'].map(chosen.settings.get), [120, -40, 30, 15], 'chosen values stay');
        // the reset: dimmed at the defaults, a press arms it ("Confirm reset", nothing saved), the second press saves
        chosen.ui.tab(1);
        await until(() => chosen.ui.frame && chosen.ui.frame.targets.some((g) => g.key === 'hud:reset'), 3000, 'the reset button');
        assert.ok(chosen.ui.frame.texts.indexOf('RESET HUD TO DEFAULTS') >= 0, chosen.ui.frame.texts.join(' | '));
        chosen.press('hud:reset');
        await until(() => chosen.ui.frame.texts.indexOf('CONFIRM RESET') >= 0, 3000, 'armed');
        assert.deepStrictEqual(['hudSize', 'hudX', 'hudY', 'hudBarX'].map(chosen.settings.get), [120, -40, 30, 15], 'the first press saves nothing');
        chosen.press('hud:reset');
        await until(() => chosen.settings.get('hudSize') === D.size, 3000, 'reset');
        assert.deepStrictEqual(['hudSize', 'hudX', 'hudY', 'hudBarX'].map(chosen.settings.get), [D.size, D.x, D.y, D.barX]);
        await until(() => chosen.ui.frame.texts.indexOf('RESET HUD TO DEFAULTS') >= 0 && !chosen.ui.frame.targets.some((g) => g.key === 'hud:reset'), 3000, 'dimmed again at the defaults');
        assert.ok(!r.lines.concat(chosen.lines).some((l) => /^ERR/.test(l)));
        await r.done();
        await chosen.done();
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
    // ---- 0.4.4: the HUD check end to end (verify 2 s, gap 1.5 s: the shortest config.js allows) ----
    ['0.4.4 (a) the renderer says rendered: the Home card says "Showing: the renderer drew it", no rebuild', async () => {
        const r = await start({ _settingsV: 4, hudOn: true, hudStyle: 'bar' }, true, undefined, true, { hudCheck: { verifyMs: 2000, gapMs: 1500 } });
        r.sample(3000);
        await until(() => r.layers().length === 1, 3000, 'a layer');
        await until(() => r.ui.frame && r.ui.frame.texts.indexOf('Showing: the renderer drew it') >= 0, 5000, 'the read-back verdict');
        await wait(1200);
        assert.ok(!r.lines.some((l) => /hud check: rebuild/.test(l)), r.lines.join('\n'));
        assert.ok(r.lines.some((l) => /^hud check: hud ok: Showing: the renderer drew it \(Shown, the renderer drew it \(subscribed \d+ s\) on hud\)$/.test(l)), 'the verdict is logged for car-logs');
        r.ui.tab(5);
        await until(() => r.ui.frame.texts.indexOf('HUD: Showing: the renderer drew it') >= 0, 3000, 'the Check tab');
        assert.ok(r.ui.frame.texts.some((t) => /^target hud: slot 0x323 .*rendered: renderer .* at \d\d:\d\d:\d\d$/.test(t)), r.ui.frame.texts.join(' | '));
        assert.ok(!r.lines.some((l) => /^ERR/.test(l)), r.lines.join('\n'));
        await r.done();
    }],
    ['0.4.4 (b) "renderer not subscribed": exactly 2 rebuilds, each a gap of 1.5 s+ before the layer comes back, then it gives up', async () => {
        const r = await start({ _settingsV: 4, hudOn: true, hudStyle: 'bar' }, true, undefined, true, { mode: 'unsubscribed', hudCheck: { verifyMs: 2000, gapMs: 1500, manualCooldownMs: 3000, backoffMs: 10000 } });
        const clk = fakeClock();
        try {
            r.sample(3000);
            // 0.4.5: the second automatic rebuild waits backoffMs (10 s): the clock skips it once the first rebuild is made again
            await until(() => r.msgs.filter((m) => m.op === 'layer').length === 2, 8000, 'the first rebuild made again');
            await wait(2500);
            assert.strictEqual(r.lines.filter((l) => /rebuild \(stuck\)/.test(l)).length, 1, 'the back-off holds the second: ' + r.lines.join('\n'));
            clk.add(10000);
            await until(() => r.lines.some((l) => /hud check: gave up after 2 automatic rebuilds/.test(l)), 8000, 'gave up');
            const rebuilds = r.lines.filter((l) => /^WARN hud check: rebuild \(stuck\)/.test(l));
            assert.strictEqual(rebuilds.length, 2, r.lines.join('\n'));
            const conns = r.msgs.filter((m) => m.ev === 'close').map((m) => m.t);
            const made = r.msgs.filter((m) => m.op === 'layer');
            assert.strictEqual(made.length, 3, 'the first layer and two rebuilds');
            conns.slice(0, 2).forEach((t, i) => assert.ok(made[i + 1].t - t >= 1500 - 30, 'gap ' + i + ': ' + (made[i + 1].t - t) + ' ms'));
            await wait(2500);
            assert.strictEqual(r.lines.filter((l) => /rebuild \(stuck\)/.test(l)).length, 2, 'no third');
            r.ui.tab(5);
            await until(() => r.ui.frame.texts.some((t) => /gave up after 2: try Reset HUD drawing/.test(t)), 3000, 'the Check tab says it gave up');
            assert.ok(r.ui.frame.texts.indexOf('HUD: Sent, not confirmed drawn') >= 0, r.ui.frame.texts.join(' | '));
            assert.ok(r.ui.frame.texts.some((t) => /^2 of 2 automatic rebuilds used; last: stuck at .*; gave up$/.test(t)), r.ui.frame.texts.join(' | '));
            // Reset HUD drawing still works once (3 s after the last rebuild here), then is dimmed (no target) for the cooldown
            await until(() => r.ui.frame.targets.some((g) => g.key === 'check:reset'), 4000, 'Reset HUD drawing pressable');
            r.press('check:reset');
            await until(() => r.lines.some((l) => /rebuild \(manual\)/.test(l)), 2000, 'manual rebuild');
            await wait(50);
            assert.ok(!r.ui.frame.targets.some((g) => g.key === 'check:reset'), 'greyed in the cooldown');
        } finally {
            clk.restore();
        }
        await r.done();
    }],
    ['0.4.4 (c) M Track Cluster on the panel: the card names it, zero rebuilds', async () => {
        const r = await start({ _settingsV: 4, hudOn: true, hudStyle: 'bar' }, true, undefined, true, { mode: 'mtrack-on-panel', hudCheck: { verifyMs: 2000, gapMs: 1500 } });
        r.sample(3000);
        await until(() => r.ui.frame && r.ui.frame.texts.indexOf('Blocked: M Track Cluster holds the scene') >= 0, 6000, 'the otherapp verdict');
        await wait(3000);
        assert.ok(!r.lines.some((l) => /hud check: rebuild/.test(l)), r.lines.join('\n'));
        assert.strictEqual(r.msgs.filter((m) => m.op === 'layer').length, 1);
        await r.done();
    }],
    ['0.4.4 (d) a wake (the clock jumps 60 s between ticks): one rebuild; the clock set back 1 h: no wake', async () => {
        const realNow = Date.now;
        let off = 0;
        const r = await start({ _settingsV: 4, hudOn: true, hudStyle: 'bar' }, true, undefined, true, { hudCheck: { verifyMs: 2000, gapMs: 1500 } });
        try {
            Date.now = () => realNow() + off;
            r.sample(3000);
            await until(() => r.ui.frame && r.ui.frame.texts.indexOf('Showing: the renderer drew it') >= 0, 5000, 'confirmed first');
            await wait(1100);           // at least one 1 s tick on the real clock first, so the next one sees the jump back
            off = -3600000;
            await wait(1300);
            assert.ok(!r.lines.some((l) => /hud check: wake/.test(l)), 'a clock set back is not a wake');
            off = 60000;
            await until(() => r.lines.some((l) => /^WARN hud check: rebuild \(wake\)/.test(l)), 3000, 'the wake rebuild');
            assert.ok(r.lines.some((l) => /^hud check: wake \(6\d s with no tick\)/.test(l)) || r.lines.some((l) => /^hud check: wake \(\d+ s with no tick\)/.test(l)), r.lines.join('\n'));
            await until(() => r.layers().length === 1 && r.msgs.filter((m) => m.op === 'layer').length === 2, 4000, 'made again after the gap');
            await wait(2500);
            assert.strictEqual(r.lines.filter((l) => /hud check: rebuild/.test(l)).length, 1, r.lines.join('\n'));
        } finally {
            Date.now = realNow;
        }
        await r.done();
    }],
    // ---- 0.4.5: the renderer's mapping guard end to end (job 11092256, the car on 2026-11-09) ----
    ['0.4.5 (A) the car state: link ready, the guard disabled the HUD: verdict disabled, zero rebuilds over 120 s, Reset dimmed, guard line and one full dump logged', async () => {
        const r = await start({ _settingsV: 4, hudOn: true, hudStyle: 'bracket' }, true, undefined, true, { mode: 'guard-disabled', hudCheck: { verifyMs: 2000, gapMs: 1500, backoffMs: 10000 } });
        const clk = fakeClock();
        try {
            r.sample(3000);
            await until(() => r.ui.frame && r.ui.frame.texts.indexOf('Blocked: the renderer turned the HUD off') >= 0, 5000, 'the disabled verdict on Home');
            assert.ok(r.lines.some((l) => l === 'hud check: hud disabled: Blocked: the renderer turned the HUD off (cluster-render disabled hud after 2 strikes. Fix: Store > Cluster renderer > Update, or guard-reset)'), r.lines.join('\n'));
            // 120 s on the app's clock, 20 s a tick (under wakeGapMs: no wake), with the 1 s tick running in between
            for (let i = 0; i < 6; i++) { await wait(1100); clk.add(20000); }
            await wait(1100);
            assert.ok(!r.lines.some((l) => /hud check: (rebuild|wake|gave up)/.test(l)), r.lines.join('\n'));
            assert.strictEqual(r.msgs.filter((m) => m.op === 'layer').length, 2, 'the bracket\'s two layers, made once');
            assert.ok(r.lines.some((l) => /^cluster-render status: .*target hud: slot 0x323 scene 0x1000400 800x480: idle \| guard: hud 0x323 0x1000400 0: disabled, 2 strikes \| dcsm: Dcsm2 available$/.test(l)), r.lines.join('\n'));
            assert.strictEqual(r.lines.filter((l) => /^cluster-render status \(full\): .*guard: hud 0x323 0x1000400 0: disabled, 2 strikes/.test(l)).length, 1, r.lines.join('\n'));
            r.ui.tab(5);
            await until(() => r.ui.frame.texts.indexOf('HUD: Blocked: the renderer turned the HUD off') >= 0, 3000, 'the Check tab');
            assert.ok(r.ui.frame.texts.indexOf('HUD off after 2 strikes: Store > Cluster renderer > Update, or guard-reset') >= 0, r.ui.frame.texts.join(' | '));
            assert.ok(r.ui.frame.texts.some((t) => /^Dcsm2 up since \d\d:\d\d:\d\d; slot table at \d\d:\d\d:\d\d$/.test(t)), r.ui.frame.texts.join(' | '));
            assert.ok(r.ui.frame.targets.some((g) => g.key === 'check:refresh') && !r.ui.frame.targets.some((g) => g.key === 'check:reset'), 'Reset HUD drawing dimmed (it cannot ask for a disabled mapping)');
            assert.ok(!r.lines.some((l) => /^ERR/.test(l)), r.lines.join('\n'));
        } finally {
            clk.restore();
        }
        await r.done();
    }],
    ['0.4.5 (B) idle with no guard line: at most 2 automatic rebuilds backoffMs apart, then it gives up; a service restart re-arms it', async () => {
        const r = await start({ _settingsV: 4, hudOn: true, hudStyle: 'bar' }, true, undefined, true, { mode: 'idle', hudCheck: { verifyMs: 2000, gapMs: 1500, backoffMs: 10000 } });
        const clk = fakeClock();
        try {
            r.sample(3000);
            await until(() => r.msgs.filter((m) => m.op === 'layer').length === 2, 8000, 'the first rebuild made again');
            await wait(2500);
            assert.strictEqual(r.lines.filter((l) => /rebuild \(stuck\)/.test(l)).length, 1, 'held by the back-off');
            clk.add(10000);
            await until(() => r.lines.some((l) => /hud check: gave up after 2 automatic rebuilds/.test(l)), 8000, 'gave up');
            const closes = r.msgs.filter((m) => m.ev === 'close').map((m) => m.t);
            assert.strictEqual(r.lines.filter((l) => /rebuild \(stuck\)/.test(l)).length, 2);
            assert.ok(closes[1] - closes[0] >= 10000, 'backoffMs apart: ' + (closes[1] - closes[0]));
            assert.ok(r.lines.some((l) => /^WARN hud check: rebuild \(stuck\): .*, guard none$/.test(l)), r.lines.join('\n'));
            r.ui.tab(5);
            await until(() => r.ui.frame.texts.indexOf('Target hud idle, layer slats waiting; the renderer has not asked for the slot (Dcsm2 up). Self-heal gave up after 2: try Reset HUD drawing') >= 0,
                3000, 'the Check tab detail names Dcsm2');
            assert.ok(r.ui.frame.texts.indexOf('no strikes') >= 0, r.ui.frame.texts.join(' | '));
            const n0 = r.msgs.length;
            await new Promise((res) => r.fake.restart(res));
            await until(() => r.lines.some((l) => l === 'hud check: renderer restarted: self-heal re-armed'), 6000, 're-armed');
            assert.ok(r.msgs.slice(n0).some((m) => m.op === 'layer'), 'the client made the layers again on the new connection');
            assert.ok(!r.lines.some((l) => /^ERR/.test(l)), r.lines.join('\n'));
        } finally {
            clk.restore();
        }
        await r.done();
    }],
    ['0.4.5 (C) recovery: guard-disabled, then a guard-reset (the service restarts with no guard): the verdict reaches ok with no app restart', async () => {
        const r = await start({ _settingsV: 4, hudOn: true, hudStyle: 'bar' }, true, undefined, true, { mode: 'guard-disabled', hudCheck: { verifyMs: 2000, gapMs: 1500, backoffMs: 10000 } });
        r.sample(3000);
        await until(() => r.ui.frame && r.ui.frame.texts.indexOf('Blocked: the renderer turned the HUD off') >= 0, 5000, 'disabled first');
        r.fake.mode('ok');
        await new Promise((res) => r.fake.restart(res));
        await until(() => r.ui.frame.texts.indexOf('Showing: the renderer drew it') >= 0, 8000, 'ok after the reset');
        assert.ok(r.lines.some((l) => l === 'hud check: renderer restarted: self-heal re-armed'), r.lines.join('\n'));
        assert.ok(r.lines.some((l) => /^hud check: hud ok: Showing: the renderer drew it/.test(l)), r.lines.join('\n'));
        assert.ok(!r.lines.some((l) => /hud check: rebuild/.test(l)), 'no rebuild needed: the client replays the layers');
        assert.ok(r.lines.filter((l) => /^started: /.test(l)).length === 1, 'one app start');
        await r.done();
    }],
];
