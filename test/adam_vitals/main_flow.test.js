'use strict';
/* main.js end to end on a fake kit ctx (signals, settings, ui) with fake engine-unit and gearbox reads: the warm-up
 * takeover on a cold start and its Hide button, vitals once warm, every page drawn on the GPU Recorder and the
 * software Canvas (metric and US, car and demo data, no data at all), a throwing signal handler counted not thrown,
 * the DISABLE file stopping the reads, bad saved settings falling back to their defaults, the move from 0.1.0's
 * settings, and the transmission temperature (22 6000): shown, counted, missing, stale, rate-limited, clock set back. */
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
const U = require(path.join(APP, 'units.js'));
const Demo = require(path.join(APP, 'demo.js'));
const CDS = 'de.bmw.infotainment.vehicle.CDS', FES = 'de.bmw.infotainment.drivingexcitement.FES', V2 = 'de.bmw.infotainment.vehicle.Vehicle2';
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const def = (k) => SPEC.settings.filter((s) => s.key === k)[0].default;
const F = U.fToC;

/* Date.now moved by skew (the app's wall clock): timers stay real, so a test advances the clock between polls. */
const realNow = Date.now;
let skew = 0;
async function clocked(fn) {
    skew = 0; Date.now = () => realNow() + skew;
    try { return await fn(); } finally { Date.now = realNow; skew = 0; }
}

let sink = { reads: 0 };
class FakeDiag { constructor() { this.p = {}; this.available = true; this.quiet = false; } init() { return Promise.resolve(); } }
class FakeDids {
    constructor() { this.raws = {}; this.pick = {}; this.sink = sink; }       // each app counts its own reads
    /** engine-unit values: no answer; the gearbox (egs): sink.egsFn() (null = refused NRC 31), each read's time in sink.egs */
    value(name, list) {
        this.sink.reads++;
        if (name !== 'egs') return Promise.resolve(null);
        this.sink.egs.push(Date.now());
        let v;
        try { v = this.sink.egsFn ? this.sink.egsFn() : null; } catch (e) { return Promise.reject(e); }
        const c = (list || [])[0] || {};
        this.raws[this.key(c)] = v === null ? { ok: false, why: 'NRC 31 out of range', bytes: '7F 22 31' } : { ok: true, value: v, bytes: '62 60 00 ' + (v + 40).toString(16) };
        if (v !== null) this.pick.egs = 0;
        return Promise.resolve(v);
    }
    monitor() { this.sink.reads++; return Promise.resolve(null); }
    supported() { this.sink.reads++; return Promise.resolve(null); }
    key(c) { return JSON.stringify(c); }
    monitorKey() { return 'm'; }
}
FakeDids.label = (c) => c.did || 'x';

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
    sink = { reads: 0, egs: [], egsFn: o.egs };
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
        lines, clicks, handlers, settings, dataDir, reads: () => mine.reads, egsReads: () => mine.egs,
        setEgs: (fn) => { mine.egsFn = fn; },
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
/** The gearbox read answered twice, then v2 (a change: MOVE trusts it); the Fuel page on screen kicks the polls. */
async function twoReads(r, v2) {
    for (let i = 0; i < 40 && r.egsReads().length < 1; i++) await wait(50);
    assert(r.egsReads().length >= 1, 'first gearbox read about 1 s after start');
    r.setEgs(() => v2); skew += 6000;
    await r.clicks.tab(2);
    for (let i = 0; i < 100 && r.egsReads().length < 2; i++) { await wait(50); if (i % 5 === 0) await r.draw(); }
    assert(r.egsReads().length >= 2, 'second gearbox read');
    await wait(250);                                    // a state step (200 ms) with the new reading
}

module.exports = [
    ['cold start: the warm-up view with Hide; Hide (bar button or on-page) shows the vitals; warm stays vitals', async () => {
        const r = await start();
        r.rpm(800); r.temps(15, 20);
        await wait(450);
        let t = await r.text();
        assert(t.indexOf('HIDE WARM-UP') >= 0, 'takeover: ' + t);
        assert(t.indexOf('READY IN') >= 0 && t.indexOf('OIL') >= 0 && t.indexOf('SAFE REV LIMIT') >= 0, t);
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
        r.temps(108, 106); await wait(450);                         // 226 F oil, 223 F coolant: over the 220 F marks
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
        w.temps(95, 90); await wait(450);
        assert((await w.text()).indexOf('HIDE WARM-UP') >= 0, '203 / 194 F: 0.1.0 called that warm, 0.2.0 does not');
        w.temps(108, 106); await wait(450);
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
        const r = await start({ units: 'xyz', warmOil: 999, _settingsV: 2 });      // (a 0.2.0 file: nothing to move)
        assert.strictEqual(r.settings.get('units'), 'us');
        assert.strictEqual(r.settings.get('warmOil'), def('warmOil'));
        assert.strictEqual(r.lines.filter((l) => /^WARN settings: bad saved/.test(l)).length, 2, r.lines.join('\n'));
        r.rpm(5000); r.torque(450); r.temps(108, 106); await wait(250);
        assert((await r.text()).indexOf('psi') >= 0);
    }],
    ['settings saved by 0.1.0 move once (logged): oil and coolant warm at 220 F, oil warning 275 F; the rest kept', async () => {
        const r = await start({ warmOil: 80, warmCoolant: 85, oilWarn: 125, page: 'thermal', peaks: false });     // no _settingsV: 0.1.0
        assert.strictEqual(r.settings.get('warmOil'), def('warmOil'));
        assert.strictEqual(r.settings.get('warmCoolant'), def('warmCoolant'));
        assert.strictEqual(r.settings.get('oilWarn'), def('oilWarn'));
        assert.strictEqual(r.settings.get('page'), 'thermal'); assert.strictEqual(r.settings.get('peaks'), false);
        assert.strictEqual(r.settings.get('_settingsV'), 2);
        assert(r.lines.indexOf('settings: warmOil 80 -> ' + def('warmOil') + ' (moved to this version)') >= 0, r.lines.join('\n'));
        assert.strictEqual(r.lines.filter((l) => /bad saved/.test(l)).length, 0, 'no 0.1.0 value is bad');
        // the next start with what was saved: nothing moves again, a 0.2.0 choice stays
        const again = await start(Object.assign({}, r.settings.values, { warmOil: 98.9 }));
        assert.strictEqual(again.settings.get('warmOil'), 98.9);
        assert.strictEqual(again.lines.filter((l) => /moved to this version/.test(l)).length, 0);
    }],
    ['the transmission (gearbox unit 22 6000): once it changed it shows on Warm-up, Main, Thermals and Cool down; replies logged', async () => {
        await clocked(async () => {
            const r = await start({}, { egs: () => 20 });
            r.rpm(800); r.temps(108, 106);
            await wait(300);                                // a state step: warm by oil and coolant before trans counts
            for (let i = 0; i < 40 && r.egsReads().length < 1; i++) await wait(50);
            await r.clicks.tab(4);
            assert(!/TRANS/.test(await r.text()), 'Auto: not shown before it changed once');
            await twoReads(r, 22);
            await r.clicks.tab(4);
            let t = await r.text();
            assert(/TRANS/.test(t) && t.indexOf('72') >= 0, 'Warm-up (22 C = 72 F): ' + t);
            assert(t.indexOf('160°F') >= 0, 'its mark in F: ' + t);
            await r.clicks.tab(0); t = await r.text();
            assert(t.indexOf('TRANSMISSION') >= 0 && t.indexOf('72') >= 0, 'Main: ' + t);
            await r.clicks.tab(1); t = await r.text();
            assert(t.indexOf('72') >= 0, 'Thermals: ' + t);
            await r.clicks.tab(5); t = await r.text();
            assert(t.indexOf('TRANS') >= 0, 'Cool down legend: ' + t);
            assert(r.lines.some((l) => /^raw EGS 6000: "62 60 00/.test(l)), 'reply logged: ' + r.lines.filter((l) => /EGS/.test(l)).join(' / '));
            assert.strictEqual(r.lines.filter((l) => /^gearbox unit identification \(22 F150\): no answer/.test(l)).length, 1, 'identification asked once');
            assert.deepStrictEqual(errors(r), []);
        });
    }],
    ['takeover with the transmission: oil and coolant warm but trans cold keeps it; Include off or a missing reading does not', async () => {
        await clocked(async () => {
            const r = await start({}, { egs: () => 20 });
            r.rpm(800); r.temps(20, 25);
            await twoReads(r, 25);
            r.temps(108, 106); await wait(300);
            await r.clicks.tab(0);
            let t = await r.text();
            assert(t.indexOf('HIDE WARM-UP') >= 0, 'oil 226 F, coolant 223 F, trans 77 F: still the warm-up view: ' + t);
            r.settings.set('transWarmup', false); await wait(300);
            t = await r.text();
            assert(t.indexOf('HIDE WARM-UP') < 0, 'Include transmission off: warm by oil and coolant');
            assert(r.lines.some((l) => /warm-up view hidden: warm/.test(l)), r.lines.join('\n'));
            // the same with the gauge set to Hide: its last reading is dropped at once, not 20 s later
            const o = await start({}, { egs: () => 20 });
            o.rpm(800); o.temps(20, 25);
            await twoReads(o, 25);
            o.temps(108, 106); await wait(300);
            await o.clicks.tab(0);
            assert((await o.text()).indexOf('HIDE WARM-UP') >= 0, 'trans cold: the view');
            o.settings.set('showEgs', 'off');
            assert((await o.text()).indexOf('HIDE WARM-UP') < 0, 'Hide: warm by oil and coolant at once');
            // no gearbox reading at all (it refuses 22 6000): oil and coolant decide, Auto hides the gauge
            const n = await start({});
            n.rpm(800); n.temps(20, 25);
            await wait(1400);
            assert(n.egsReads().length >= 1, 'it was asked');
            n.temps(108, 106); await wait(300);
            await n.clicks.tab(0); t = await n.text();
            assert(t.indexOf('HIDE WARM-UP') < 0 && t.indexOf('TRANSMISSION') < 0, 'no reading: warm, no row: ' + t);
            await n.clicks.tab(4); t = await n.text();
            assert(!/TRANS/.test(t), 'Auto hides it on Warm-up: ' + t);
            // Show: drawn with -- and why
            n.settings.set('showEgs', 'on'); t = await n.text();
            assert(/TRANS/.test(t) && t.indexOf('not available on this car') >= 0, 'Show: ' + t);
            // Hide: the gearbox is never asked, nothing shows
            const h = await start({ showEgs: 'off' }, { egs: () => 50 });
            h.rpm(800); h.temps(20, 25);
            await wait(1400);
            await h.clicks.tab(2); await h.draw(); await wait(300);
            assert.strictEqual(h.egsReads().length, 0, 'Hide: no gearbox reads');
            await h.clicks.tab(4); t = await h.text();
            assert(!/TRANS/.test(t), 'Hide: no row: ' + t);
            assert.deepStrictEqual(errors(r).concat(errors(n), errors(h)), []);
        });
    }],
    ['the gearbox is asked at most every 5 s, every 30 s after 3 failures, and at once after the clock is set back (KB-ANY-204)', async () => {
        await clocked(async () => {
            let ok = true;
            const r = await start({}, { egs: () => (ok ? 30 : null) });
            r.rpm(2000); r.temps(108, 106);
            await r.clicks.tab(2);
            const drive = async (realMs) => {       // Fuel page on screen (fast polls), the clock ~10x real time
                for (let i = 0, end = realNow() + realMs; realNow() < end; i++) { skew += 500; await wait(50); if (i % 4 === 0) await r.draw(); }
            };
            await drive(2000);
            const gaps = (a) => a.slice(1).map((x, i) => x - a[i]);
            let reads = r.egsReads().slice();
            assert(reads.length >= 3, 'reads: ' + reads.length);
            assert(gaps(reads).every((g) => g >= 5000), 'never under 5 s apart: ' + gaps(reads));
            ok = false;
            const from = r.egsReads().length;
            await drive(9000);
            reads = r.egsReads().slice(from);
            const g = gaps(reads);
            assert(reads.length >= 5, 'failing reads: ' + reads.length);
            assert(g.slice(0, 2).every((x) => x >= 5000 && x < 30000), 'the first 3 failures 5 s apart: ' + g);
            assert(g.slice(2).every((x) => x >= 30000), 'then every 30 s: ' + g);
            // a clock set back an hour: asked again at once, not an hour later
            ok = true;
            const n0 = r.egsReads().length;
            skew -= 3600000;
            for (let i = 0; i < 40 && r.egsReads().length === n0; i++) { await wait(50); if (i % 4 === 0) await r.draw(); }
            assert(r.egsReads().length > n0, 'read after the clock went back');
            assert.deepStrictEqual(errors(r), []);
        });
    }],
    ['a gearbox reading that stops shows -- after 20 s, never the old number; a throwing read is logged, never thrown', async () => {
        await clocked(async () => {
            const r = await start({ showEgs: 'on' }, { egs: () => 60 });
            r.rpm(800); r.temps(108, 106);
            await twoReads(r, 62);
            await r.clicks.tab(4);
            let t = await r.text();
            const old = String(Math.round(U.cToF(62)));
            assert(t.indexOf(old) >= 0, 'fresh: ' + t);
            r.setEgs(() => null); skew += 21000;
            await wait(200);
            t = await r.text();
            assert(t.indexOf(old) < 0 && t.indexOf('no reading for 20 s') >= 0, 'stale: ' + t);
            // a read that throws: logged by the poll, the app keeps running
            r.setEgs(() => { throw new Error('tasu boom'); }); skew += 31000;
            await r.clicks.tab(2);
            for (let i = 0; i < 60 && !r.lines.some((l) => /tasu boom/.test(l)); i++) { await wait(50); if (i % 5 === 0) await r.draw(); }
            assert(r.lines.some((l) => /^WARN engine unit poll: Error: tasu boom/.test(l)), r.lines.filter((l) => /WARN|ERR/.test(l)).join('\n'));
            await r.clicks.tab(0);
            assert((await r.text()).indexOf('TRANSMISSION') >= 0, 'still drawing');
            assert.deepStrictEqual(errors(r), []);
        });
    }],
    ['too hot says so on the Gear card: oil over its warning, coolant from 260 F, transmission from 250 F', async () => {
        await clocked(async () => {
            const r = await start({}, { egs: () => 90 });
            r.rpm(2000); r.temps(108, 106);
            await wait(300);
            await twoReads(r, 92);
            await r.clicks.tab(0);
            let t = await r.text();
            assert(t.indexOf('READY') >= 0 && !/HOT/.test(t), 'normal: ' + t);
            r.temps(108, 127); t = await r.text();
            assert(t.indexOf('COOLANT HOT - EASE OFF') >= 0, 'coolant 261 F: ' + t);
            r.temps(136, 106); t = await r.text();
            assert(t.indexOf('OIL HOT - EASE OFF') >= 0, 'oil 277 F: ' + t);
            r.temps(108, 106); r.setEgs(() => 122); skew += 6000;
            await r.clicks.tab(2);
            for (let i = 0; i < 60 && r.egsReads().length < 3; i++) { await wait(50); if (i % 5 === 0) await r.draw(); }
            await r.clicks.tab(0); t = await r.text();
            assert(t.indexOf('TRANS HOT - EASE OFF') >= 0, 'trans 252 F: ' + t);
            assert.deepStrictEqual(errors(r), []);
        });
    }],
    ['demo data: a cold start that warms oil, coolant and transmission past their marks', async () => {
        await clocked(async () => {
            const d = new Demo(), at = (s) => { skew = s * 1000; return d.sample(); };
            const c = at(5);
            assert(c.oil < 40 && c.coolant < 40 && c.egs < 40, 'cold: ' + JSON.stringify([c.oil, c.coolant, c.egs]));
            const w = at(150);
            assert(w.coolant < def('warmCoolant') && w.oil < def('warmOil') && w.egs < def('warmTrans'), 'warming at 2.5 min');
            for (let s = 330; s < 720; s += 7) {
                const x = at(s);
                assert(x.oil >= def('warmOil') && x.coolant >= def('warmCoolant') && x.egs >= def('warmTrans'), s + ' s: ' + JSON.stringify([x.oil, x.coolant, x.egs]));
                assert(x.oil < F(250) && x.coolant < F(250) && x.egs < F(230), 'never hot');
            }
            skew = -60000;
            const b = d.sample();
            assert(b.rpm >= 1500 && b.speed > 0 && b.coolant >= 20, 'a clock set back: the start again, not a negative rpm: ' + JSON.stringify([b.rpm, b.speed]));
        });
    }],
];
