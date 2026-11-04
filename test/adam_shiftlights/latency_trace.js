'use strict';
/**
 * Latency trace (Node 8): the real main.js and the real kit car.js against a fake car link and the in-process fake
 * cluster-render service. A ramp drives CDS statusEngineSpeed2 notifications; every `u_st` the service gets is
 * matched to the input before it and to the moment the rpm crossed that light's boundary.
 *
 *   node --expose-gc test/adam_shiftlights/latency_trace.js [--app <dir>] [--hz 20] [--rate 3000] [--lead 60]
 *       [--poll on|off] [--preview off|software|gpu] [--getter-ms 3] [--pulls 5] [--noise 0] [--out <file.json>]
 *   require: runTrace(opts) -> Promise<result>  (the same numbers, for stress.test.js)
 *
 * A = service receipt - the last rpm the app was handed before it (notification or getter answer): our own delay.
 * B = service receipt - when the ramp crossed each newly lit light's boundary (rising only; negative = early):
 *     what the driver sees, sampling and lead included. --app takes an older checkout (0.3.0 has no lead or poll).
 * The getter answers the ramp's current value after --getter-ms: the best case ("the car's getter is fresh").
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { createFake } = require('./fake_cluster_render');

const REPO = path.join(__dirname, '..', '..');
const KIT = path.join(REPO, 'kit', 'runtime');
const CDS = 'de.bmw.infotainment.vehicle.CDS';
const V2 = 'de.bmw.infotainment.vehicle.Vehicle2';
const T0 = process.hrtime();
const now = () => { const d = process.hrtime(T0); return d[0] * 1e3 + d[1] / 1e6; };
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const pct = (list, p) => { if (!list.length) return null; const s = list.slice().sort((a, b) => a - b); return s[Math.max(0, Math.ceil(p * s.length) - 1)]; };
const r1 = (v) => (v === null ? null : Math.round(v * 10) / 10);
const sum = (list) => ({ n: list.length, p50: r1(pct(list, 0.5)), p95: r1(pct(list, 0.95)), max: r1(pct(list, 1)) });

/** The ramp: per pull 500 ms at 5500, up at `rate` rpm/s to 7100, 1 s there, down at 3000 rpm/s to 5500. */
function ramp(rate, pulls) {
    const up = (7100 - 5500) / (rate / 1000), down = 1600 / 3, one = 500 + up + 1000 + down;
    return {
        ms: one * pulls + 300, one, up,
        at(t) {
            const k = Math.floor(t / one), x = t - k * one;
            if (k >= pulls || x < 500) return 5500;
            if (x < 500 + up) return 5500 + (x - 500) * rate / 1000;
            if (x < 1500 + up) return 7100;
            return Math.max(5500, 7100 - (x - 1500 - up) * 3);
        },
        /** When pull k's rise crosses rpm x (ms from the trace start). */
        cross: (k, x) => k * one + 500 + (x - 5500) / (rate / 1000),
    };
}

/** main.js of `app` with a fake mgu.run, the real kit (car.js timed around each sample listener). */
function loadApp(app, timed) {
    const realResolve = Module._resolveFilename;
    const main = path.join(app, 'main.js');
    let captured = null;
    const fakeMod = (file, exp) => { const id = path.join(KIT, file); require.cache[id] = { id, filename: id, loaded: true, exports: exp }; };
    const RealCar = require(path.join(KIT, 'car.js'));
    class TimedCar extends RealCar {
        onSample(fn, reset) { super.onSample((d, t) => { const a = now(); fn(d, t); timed.push(now() - a); }, reset); }
    }
    Module._resolveFilename = function (req, parent) {
        if (/^\.\/kit\//.test(req) && parent && parent.filename && path.dirname(parent.filename) === app) return realResolve.call(this, path.join(KIT, req.slice(6)), parent);
        return realResolve.apply(this, arguments);
    };
    try {
        fakeMod('mgu.js', { run: (a) => { captured = a; } });
        fakeMod('car.js', TimedCar);
        Object.keys(require.cache).forEach((k) => { if (k.indexOf(app + path.sep) === 0) delete require.cache[k]; });
        require(main);
    } finally {
        Module._resolveFilename = realResolve;
        delete require.cache[path.join(KIT, 'mgu.js')];
        delete require.cache[path.join(KIT, 'car.js')];
    }
    return captured;
}

async function runTrace(o) {
    const opts = Object.assign({ app: path.join(REPO, 'apps', 'adam_shiftlights'), hz: 20, rate: 3000, lead: 60, poll: true, preview: 'off', getterMs: 3, pulls: 5, noise: 0, seed: 1 }, o);
    const app = path.resolve(opts.app);
    const spec = JSON.parse(fs.readFileSync(path.join(app, 'app.json'), 'utf8'));
    const R = ramp(opts.rate, opts.pulls);
    let seed = opts.seed;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

    // the fake cluster-render service, receipts stamped on the trace clock
    const sock = path.join(os.tmpdir(), 'sl-trace-' + process.pid + '-' + Math.floor(rnd() * 1e9) + '.sock');
    const ust = [];
    const fake = createFake(sock, (m) => { if (m.op === 'uniform' && m.name === 'u_st') ust.push({ t: now(), v: m.v.split(' ').map(Number) }); });

    // settings, as the kit's Settings: app.json defaults, then the save
    const values = {}, listeners = [];
    spec.settings.forEach((s) => { values[s.key] = s.default; });
    Object.assign(values, { _settingsV: 3, clusterOn: true, clusterStyle: 'large', driveMode: 'sport', demo: 'off', leadMs: opts.lead, rpmPoll: opts.poll });
    const settings = { get: (k) => values[k], set: (k, v) => { values[k] = v; listeners.forEach((fn) => fn(k, v)); }, onChange: (fn) => listeners.push(fn), cycle() {} };

    // the car link: handlers per interface; inputs = when the app was handed an rpm (trace clock)
    const handlers = {}, inputs = [];
    let rpmNow = 5500, getterCalls = 0, start = null;
    const rpmAt = () => (start === null ? rpmNow : Math.max(0, R.at(now() - start)));      // the getter: the ramp right now
    const signals = {
        watch(iface, inst, h) {
            handlers[iface] = h;
            const proxy = {
                getValue(field) {
                    getterCalls++;
                    if (field !== 'statusEngineSpeed2') return Promise.reject(new Error('no getter'));
                    return new Promise((res) => setTimeout(() => { inputs.push(now()); res({ actualValueRPMEngineCrankshaft: Math.round(rpmAt() * 4) }); }, opts.getterMs));
                },
            };
            return Promise.resolve({ iface, available: true, proxy, error: null });
        },
    };

    // the preview: the kit's two loop paths
    const frames = [], lines = [];
    const log = { info: (m) => lines.push(m), warn: (m) => lines.push('WARN ' + m), error: (m, e) => lines.push('ERR ' + m + (e ? ' ' + e : '')) };
    const kitCanvas = require(path.join(KIT, 'canvas.js')), kitRecord = require(path.join(KIT, 'record.js')), themes = require(path.join(KIT, 'themes.js'));
    const rec = new kitRecord.Recorder(1600, 520, { textScale: 1 });
    let loopFn = null, stopped = false;
    const ctx = {
        spec, settings, log, signals, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sl-trace-data-')),
        ui: {
            isVisible: (n) => n === 'MAIN' && opts.preview !== 'off', onVisible() {}, onClick() {},
            image: (id, cv) => { if (opts.preview === 'software') cv.png(); return Promise.resolve(); },
        },
        theme: () => themes.theme('m_tricolour'),
        canvas: (w, h) => (opts.preview === 'gpu' ? rec.reset() : new kitCanvas.Canvas(w, h)),
        loop: (name, fps, fn) => { loopFn = { fps, fn }; },
    };
    const timed = [];
    const appMod = loadApp(app, timed);
    process.env.SHIFTLIGHTS_CR_SOCKET = sock;      // read by start()
    try { await appMod.start(ctx); } finally { delete process.env.SHIFTLIGHTS_CR_SOCKET; }

    if (opts.preview !== 'off' && loopFn) {
        let n = 0;
        const tick = async () => {
            if (stopped) return;
            const a = now();
            try { await loopFn.fn(); } catch (e) { lines.push('ERR loop ' + e); }
            const dt = now() - a;
            frames.push(dt);
            if (opts.preview === 'software' && ++n % 3 === 0 && typeof global.gc === 'function') global.gc();
            setTimeout(tick, opts.preview === 'gpu' ? 16 : Math.max(15, 1000 / loopFn.fps - dt));
        };
        setTimeout(tick, 0);
    }

    await wait(300);    // watches settled, the poller started, the layer made
    // event-loop lag: a 5 ms timer's lateness
    const lag = [];
    let last = now();
    const lagTimer = setInterval(() => { const t = now(); lag.push(Math.max(0, t - last - 5)); last = t; }, 5);

    start = now();
    ust.length = 0;
    inputs.length = 0;
    timed.length = 0;
    const cds = handlers[CDS], v2 = handlers[V2];
    cds.statusEngineTemperature({ temperatureEngineDrive: 90 + 48, temperatureEngineOilDrive: 95 + 48 });
    let notes = 0;
    await new Promise((done) => {
        const send = () => {
            const t = now() - start;
            if (t > R.ms) { done(); return; }
            rpmNow = Math.max(0, R.at(t) + (opts.noise ? (rnd() * 2 - 1) * opts.noise : 0));
            inputs.push(now());
            notes++;
            cds.statusEngineSpeed2({ actualValueRPMEngineCrankshaft: Math.round(rpmNow * 4) });
            setTimeout(send, Math.max(0, 1000 / opts.hz + (rnd() * 4 - 2) - (now() - start - t)));
        };
        const speed = () => { if (now() - start > R.ms) return; v2.statusCarSpeed2({ speedVehicleCentreOfGravity: 80 * 64 }); setTimeout(speed, 100); };
        if (opts.hz) send(); else setTimeout(done, R.ms);
        speed();
    });
    clearInterval(lagTimer);
    await wait(100);
    stopped = true;
    settings.set('clusterOn', false);       // the app goes idle: output closed, poller idle
    await new Promise((res) => fake.close(res));

    // lit changes on the slats layer: A from the input before, B (rising) from the boundary crossing
    const cfg = require(path.join(app, 'logic.js')).validateConfig(require(path.join(app, 'config.js'))).cfg;
    const th = { start: cfg.modes.sport.start, shift: cfg.modes.sport.shift };
    const st = cfg.clusterStyles.large, n = st.palette.length, m = n - st.reds;
    const boundary = (lit) => (lit >= n ? th.shift : th.start + (lit - 1) * (th.shift - th.start) / m);
    const A = [], B = [];
    let prev = 0, prevFlash = 0, litChanges = 0, flashChanges = 0, changes = 0, riseDrops = 0;
    ust.forEach((u) => {
        const lit = u.v[0], flash = u.v[1];
        if (flash !== prevFlash || lit !== prev) changes++;
        if (flash !== prevFlash) { flashChanges++; prevFlash = flash; }
        if (lit === prev) return;
        litChanges++;
        const ph = (u.t - start) % R.one;
        if (lit < prev && ph > 500 && ph < 1500 + R.up) riseDrops++;      // a light lost while the rpm rises or holds: flicker
        const before = inputs.filter((x) => x <= u.t);
        if (before.length) A.push(u.t - before[before.length - 1]);
        if (lit > prev && !flash) {
            const tt = u.t - start, k = Math.floor(tt / R.one);
            // every newly lit light, from its own boundary crossing in this pull's rise
            for (let i = prev + 1; i <= lit; i++) { const x = boundary(i); if (x < 7100 && k < opts.pulls) B.push(tt - R.cross(k, x)); }
        }
        prev = lit;
    });
    return {
        opts: { app: path.basename(path.dirname(path.dirname(app))) + '/' + path.basename(app), hz: opts.hz, rate: opts.rate, lead: opts.lead, poll: opts.poll, preview: opts.preview, noise: opts.noise },
        A: sum(A), B: sum(B), lag: { p99: r1(pct(lag, 0.99)), max: r1(pct(lag, 1)) }, refresh: sum(timed), frame: sum(frames),
        ust: ust.length, changes, litChanges, flashChanges, riseDrops, notifications: notes, getterCalls, refreshes: timed.length,
        errors: lines.filter((l) => /^ERR/.test(l)), lines,
    };
}

if (require.main === module) {
    const a = {}, argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
    const o = {};
    if (a.app) o.app = a.app;
    ['hz', 'rate', 'lead', 'pulls', 'noise'].forEach((k) => { if (a[k] !== undefined) o[k] = Number(a[k]); });
    if (a['getter-ms'] !== undefined) o.getterMs = Number(a['getter-ms']);
    if (a.poll) o.poll = a.poll !== 'off';
    if (a.preview) o.preview = a.preview;
    runTrace(o).then((r) => {
        const out = Object.assign({}, r, { lines: undefined });
        if (a.out) fs.writeFileSync(a.out, JSON.stringify(out) + '\n');
        const f = (s) => s.p50 + '/' + s.p95 + '/' + s.max;
        console.log([r.opts.app, 'hz ' + r.opts.hz, 'rate ' + r.opts.rate, 'lead ' + r.opts.lead, 'poll ' + r.opts.poll, 'preview ' + r.opts.preview,
            'A ' + f(r.A), 'B ' + f(r.B) + ' (n ' + r.B.n + ')', 'lag p99/max ' + r.lag.p99 + '/' + r.lag.max, 'refresh p50/max ' + r.refresh.p50 + '/' + r.refresh.max,
            'frame p50/max ' + r.frame.p50 + '/' + r.frame.max + ' (n ' + r.frame.n + ')', 'u_st ' + r.ust + ' for ' + r.changes + ' changes (lit ' + r.litChanges + ', flash ' + r.flashChanges + ')',
            'drops while rising ' + r.riseDrops, 'getter ' + r.getterCalls, 'errors ' + r.errors.length].join(' | '));
        process.exit(0);
    }, (e) => { console.error(e && e.stack || e); process.exit(1); });
}

module.exports = { runTrace, ramp };
