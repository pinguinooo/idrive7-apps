'use strict';
/* main.js end to end on a fake kit ctx (signals, settings, ui) with fake engine-unit reads: the warm-up takeover
 * on a cold start and its Hide button, vitals once warm, every page drawn on the GPU Recorder and the software
 * Canvas (metric and US, car and demo data, no data at all), a throwing signal handler counted not thrown,
 * the DISABLE file stopping engine-unit reads, and bad saved settings falling back to their defaults. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const KIT = path.join(__dirname, '..', '..', 'kit', 'runtime');
const APP = path.join(__dirname, '..', '..', 'apps', 'adam_vitals');
const MAIN = path.join(APP, 'main.js');
const SPEC = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));
const { Recorder, play } = require(path.join(KIT, 'record.js'));
const { Canvas } = require(path.join(KIT, 'canvas.js'));
const themes = require(path.join(KIT, 'themes.js'));
const CDS = 'de.bmw.infotainment.vehicle.CDS', FES = 'de.bmw.infotainment.drivingexcitement.FES', V2 = 'de.bmw.infotainment.vehicle.Vehicle2';
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

let sink = { reads: 0 };
class FakeDiag { constructor() { this.p = {}; this.available = true; this.quiet = false; } init() { return Promise.resolve(); } }
class FakeDids {
    constructor() { this.raws = {}; this.pick = {}; this.sink = sink; }       // each app counts its own reads
    value() { this.sink.reads++; return Promise.resolve(null); }
    monitor() { this.sink.reads++; return Promise.resolve(null); }
    supported() { this.sink.reads++; return Promise.resolve(null); }
    key(c) { return JSON.stringify(c); }
    monitorKey() { return 'm'; }
}
FakeDids.label = () => 'x';

function settingsOf(saved) {
    const values = {}, listeners = [];
    SPEC.settings.forEach((s) => { values[s.key] = s.default; });
    Object.assign(values, saved);
    const set = (k, v) => { values[k] = v; listeners.forEach((fn) => fn(k, v)); };
    return { values, schema: SPEC.settings, get: (k) => values[k], set, onChange: (fn) => listeners.push(fn), cycle: () => {} };
}

const W_ = 1600, H_ = 520;
/** main.js on a fresh ctx; canvas: 'gpu' (page buttons drawn: cv.own) or 'sw' (played back into a software Canvas) */
async function start(saved, opts) {
    const o = opts || {};
    const lines = [], clicks = {}, handlers = {};
    const settings = settingsOf(Object.assign({ demo: 'off' }, saved));
    const log = { info: (m) => lines.push(m), warn: (m) => lines.push('WARN ' + m), error: (m) => lines.push('ERR ' + m), debug() {} };
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitals-main-'));
    if (o.disable) fs.writeFileSync(path.join(dataDir, 'DISABLE'), '');
    let frame = null, last = null, kind = o.canvas || 'gpu';
    const ctx = {
        settings, log, dataDir, spec: SPEC,
        ui: { onClick: (id, fn) => { clicks[id] = fn; }, image: () => Promise.resolve() },
        loop: (name, fps, fn) => { frame = fn; }, onTab: (fn) => { clicks.tab = fn; }, hideButton: () => {},
        theme: () => themes.theme('m_tricolour'),
        canvas: (w, h) => {
            // the kit always hands a Recorder: drawn by the GPU renderer (the kit runs the screen: page buttons),
            // or played back into a software Canvas as a PNG (the HMI's bar has the buttons)
            const cv = new Recorder(w, h, { textScale: 1 }).reset();
            cv.own = kind === 'gpu';
            const text = cv.text.bind(cv);
            cv.texts = [];
            cv.text = function (s) { cv.texts.push(String(s)); return text.apply(null, arguments); };
            last = cv;
            return cv;
        },
        signals: { watch: (iface, ver, h) => { handlers[iface] = h; return Promise.resolve({ iface, available: true }); } },
    };
    let app = null;
    sink = { reads: 0 };
    const mine = sink;
    const realResolve = Module._resolveFilename;
    Module._resolveFilename = function (req, parent) {
        if (/^\.\/kit\//.test(req) && parent && parent.filename && path.dirname(parent.filename) === APP) return realResolve.call(this, path.join(KIT, req.slice(6)), parent);
        return realResolve.apply(this, arguments);
    };
    const fake = (file, exp) => { const id = path.join(KIT, file); require.cache[id] = { id, filename: id, loaded: true, exports: exp }; };
    try {
        fake('mgu.js', { run: (a) => { app = a; } });
        fake('diag.js', { Diag: FakeDiag });
        fake('dids.js', { DidReader: FakeDids });
        [MAIN, 'pages.js'].forEach((f) => { delete require.cache[path.resolve(APP, f)]; });
        require(MAIN);
    } finally {
        Module._resolveFilename = realResolve;
        ['mgu.js', 'diag.js', 'dids.js'].forEach((f) => { delete require.cache[path.join(KIT, f)]; });
    }
    await app.start(ctx);
    const r = {
        lines, clicks, handlers, settings, dataDir, reads: () => mine.reads,
        use: (k) => { kind = k; },
        temps: (oil, coolant) => handlers[CDS].statusEngineTemperature({ temperatureEngineDrive: coolant + 48, temperatureEngineOilDrive: oil + 48 }),
        rpm: (rpm) => handlers[CDS].statusEngineSpeed2({ actualValueRPMEngineCrankshaft: rpm * 4 }),
        torque: (nm) => handlers[FES].statusActualValueTorque2({ actualValueTorqueCrankshaft: Math.round((nm + 1023.5) / 0.5) }),
        speed: (kmh) => handlers[V2].statusCarSpeed2({ speedVehicleCentreOfGravity: Math.round(kmh / 0.015625) }),
        draw: async () => { await frame(); if (kind === 'sw') play(last.words(), new Canvas(W_, H_)); return last; },
        text: async () => (await r.draw()).texts.join(' | '),
    };
    return r;
}
const errors = (r) => r.lines.filter((l) => /^ERR /.test(l));

module.exports = [
    ['cold start: the warm-up view with Hide; Hide (bar button or on-page) shows the vitals; warm stays vitals', async () => {
        const r = await start();
        r.rpm(800); r.temps(15, 20);
        await wait(450);
        let t = await r.text();
        assert(t.indexOf('HIDE WARM-UP') >= 0, 'takeover: ' + t);
        assert(t.indexOf('OIL READY IN') >= 0 && t.indexOf('SAFE REV LIMIT') >= 0, t);
        assert(r.lines.indexOf('warm-up view shown') >= 0, r.lines.join('\n'));
        // the on-page button's target runs the same dismiss as the bar button
        const cv = await r.draw(), tg = cv.targets.filter((x) => x.key === 'BTN_HIDE_WARMUP')[0];
        assert(tg, 'the page has a Hide target');
        await tg.run();
        t = await r.text();
        assert(t.indexOf('HIDE WARM-UP') < 0, 'hidden: ' + t);
        ['TORQUE', 'OIL', 'COOLANT', 'POWER (TORQUE X RPM)'].forEach((w) => assert(t.indexOf(w) >= 0, w + ' in ' + t));
        assert(/WARMING/.test(t), 'status says warming: ' + t);
        assert(t.indexOf('rpm') < 0 || t.indexOf('keep under') >= 0, 'no rpm readout');
        assert(r.lines.some((l) => /hidden: dismissed/.test(l)));
        assert(t.indexOf('km/h') < 0 && t.indexOf('mph') < 0, 'no speed');
        r.temps(95, 90); await wait(450);
        t = await r.text();
        assert(t.indexOf('HIDE WARM-UP') < 0 && t.indexOf('READY') >= 0, 'warm: ' + t);
        assert.deepStrictEqual(errors(r), []);
    }],
    ['the bar button Hide works too, and warm hides the view by itself', async () => {
        const r = await start();
        r.rpm(800); r.temps(15, 20); await wait(450);
        assert((await r.text()).indexOf('HIDE WARM-UP') >= 0);
        await r.clicks.BTN_HIDE_WARMUP();
        assert((await r.text()).indexOf('HIDE WARM-UP') < 0);
        const w = await start();
        w.rpm(800); w.temps(15, 20); await wait(450);
        w.temps(90, 85); await wait(450);
        assert((await w.text()).indexOf('HIDE WARM-UP') < 0);
        assert(w.lines.some((l) => /hidden: warm/.test(l)), w.lines.join('\n'));
    }],
    ['setting off: never the takeover', async () => {
        const r = await start({ showWarmup: false });
        r.rpm(800); r.temps(15, 20); await wait(450);
        assert((await r.text()).indexOf('HIDE WARM-UP') < 0);
    }],
    ['every page draws on the Recorder and the software Canvas, in US, metric and with no data, without an error', async () => {
        for (const units of ['us', 'metric', 'car']) {
            for (const fed of [true, false]) {
                const r = await start({ units, showWarmup: false });
                if (fed) { r.rpm(5200); r.torque(450); r.speed(100); r.temps(100, 92); }
                await wait(250);
                for (const k of ['gpu', 'sw']) {
                    r.use(k);
                    for (let i = 0; i < 6; i++) {
                        await r.clicks.tab(i);
                        const t = await r.text();
                        assert(/^[\x20-\x7e°·]*$/.test(t), 'ASCII only on page ' + i + ': ' + t.replace(/[\x20-\x7e°·]/g, ''));
                        if (i === 0 && units === 'us' && fed) ['psi', 'hp', 'lb-ft', '°F'].forEach((w) => assert(t.indexOf(w) >= 0, w + ' on Main: ' + t));
                        if (i === 0 && units === 'metric' && fed) ['bar', 'kW', 'Nm', '°C'].forEach((w) => assert(t.indexOf(w) >= 0, w + ' on Main: ' + t));
                    }
                }
                assert.deepStrictEqual(errors(r), [], units + ' ' + fed);
            }
        }
        const d = await start({ demo: 'on' });
        for (let i = 0; i < 6; i++) { await d.clicks.tab(i); await d.draw(); }
        assert.deepStrictEqual(errors(d), []);
    }],
    ['hard driving then gentle: the Cool down page counts down', async () => {
        const r = await start({ showWarmup: false });
        r.temps(100, 92); r.speed(100); r.torque(450); r.rpm(5500);
        await wait(9500);                                          // over 8 s hard
        r.rpm(1500); r.torque(60); r.speed(30);
        await wait(450);
        await r.clicks.tab(5);
        const t = await r.text();
        assert(/KEEP DRIVING GENTLY ~\d+ s/.test(t), t);
        assert.deepStrictEqual(errors(r), []);
    }],
    ['a throwing signal handler is logged and counted, never thrown', async () => {
        const r = await start();
        assert.doesNotThrow(() => r.handlers[CDS].statusEngineTemperature(undefined));
        assert(r.lines.some((l) => /^ERR error in CDS\.statusEngineTemperature/.test(l)), r.lines.join('\n'));
        r.temps(15, 20); r.rpm(800); await wait(300);
        assert((await r.text()).indexOf('HIDE WARM-UP') >= 0, 'still running');
    }],
    ['the DISABLE file stops engine unit reads (control: without it the app reads)', async () => {
        const off = await start({}, { disable: true });
        await wait(1400);
        assert.strictEqual(off.reads(), 0, 'reads with DISABLE');
        await off.clicks.tab(0);
        const t = await off.text();
        assert(t.indexOf('Engine unit reads off (DISABLE file)') >= 0 && t.indexOf('OFF') >= 0, t);
        assert(off.lines.some((l) => /kill switch file .*DISABLE/.test(l)));
        const on = await start();
        await wait(1400);
        assert(on.reads() > 0, 'control: reads without DISABLE');
    }],
    ['bad saved settings fall back to their defaults, logged and saved', async () => {
        const r = await start({ units: 'xyz', warmOil: 999 });
        assert.strictEqual(r.settings.get('units'), 'us');
        assert.strictEqual(r.settings.get('warmOil'), 80);
        assert.strictEqual(r.lines.filter((l) => /^WARN settings: bad saved/.test(l)).length, 2, r.lines.join('\n'));
        r.rpm(5000); r.torque(450); r.temps(100, 92); await wait(250);
        assert((await r.text()).indexOf('psi') >= 0);
    }],
];
