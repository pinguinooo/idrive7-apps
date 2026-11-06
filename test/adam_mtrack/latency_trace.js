'use strict';
/**
 * Latency trace (Node 8), test/adam_shiftlights/latency_trace.js for M Track: the real main.js and the real kit car.js
 * against a fake car link and the in-process fake cluster-render service. The cover is shown (Sport+, a speed, the
 * popup list), then a ramp drives CDS statusEngineSpeed2 notifications; every `u_fill` the service gets (the bars'
 * revs line, y = geom.yOfRpm of the shown rpm) is matched to the input before it and to the moment the ramp passed the
 * rpm it shows.
 *
 *   node test/adam_mtrack/latency_trace.js [--app <dir>] [--hz 10] [--rate 3000] [--lead 0] [--poll on|off]
 *       [--getter-ms 3] [--pulls 4] [--out <file.json>]
 *   require: runTrace(opts) -> Promise<result>  (latency.test.js)
 *
 * A = service receipt - the last rpm the app was handed before it (notification or getter answer): our own delay.
 * B = service receipt - when the ramp passed the rpm the received u_fill shows (rising only; negative = ahead, a lead):
 *     at the moment each update lands (near 0 without a lead: the app sends the sample it just got).
 * Bv = the visible lag: every ms of a rise, now - when the ramp passed the rpm the bar shows (the last u_fill received);
 *     what the driver sees, the time between samples and the lead included. The getter answers the ramp's current value after --getter-ms:
 *     the best case ("the car's getter is fresh"); the car's real rate is unmeasured until the car-day log.
 * Also: event-loop lag (a 5 ms timer's lateness), messages a second by op, and the app's own 1 s log lines (sample->send
 * and box draw maxima; the Power panel is on by default, so a box redraws every 500 ms with the rpm).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { createFake } = require('./fake_cluster_render');

const REPO = path.join(__dirname, '..', '..');
const KIT = path.join(REPO, 'kit', 'runtime');
const I = { CDS: 'de.bmw.infotainment.vehicle.CDS', V2: 'de.bmw.infotainment.vehicle.Vehicle2', FES: 'de.bmw.infotainment.drivingexcitement.FES',
    CCM: 'de.bmw.infotainment.checkcontrol.CheckControlMaster' };
const T0 = process.hrtime();
const now = () => { const d = process.hrtime(T0); return d[0] * 1e3 + d[1] / 1e6; };
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const pct = (list, p) => { if (!list.length) return null; const s = list.slice().sort((a, b) => a - b); return s[Math.max(0, Math.ceil(p * s.length) - 1)]; };
const r1 = (v) => (v === null ? null : Math.round(v * 10) / 10);
const sum = (list) => ({ n: list.length, p50: r1(pct(list, 0.5)), p95: r1(pct(list, 0.95)), max: r1(pct(list, 1)) });

/** The ramp: per pull 400 ms at 1500, up at `rate` rpm/s to 6500, 600 ms there, down at 4000 rpm/s to 1500. */
function ramp(rate, pulls) {
    const up = 5000 / (rate / 1000), down = 5000 / 4, one = 400 + up + 600 + down;
    return {
        ms: one * pulls + 300, one, up,
        at(t) {
            const k = Math.floor(t / one), x = t - k * one;
            if (k >= pulls || x < 400) return 1500;
            if (x < 400 + up) return 1500 + (x - 400) * rate / 1000;
            if (x < 1000 + up) return 6500;
            return Math.max(1500, 6500 - (x - 1000 - up) * 4);
        },
        /** When pull k's rise passes rpm x (ms from the trace start). */
        cross: (k, x) => k * one + 400 + (x - 1500) / (rate / 1000),
    };
}

/**
 * main.js of `app` with a fake mgu.run and the real kit; the config's statsLogMs shortened to 1 s for the log lines.
 * restore() after start(): main.js requires the kit's pack (the art) inside start, through the same resolve hook.
 */
function loadApp(app) {
    const realResolve = Module._resolveFilename;
    let captured = null, cfgWas = null;
    const mgu = path.join(KIT, 'mgu.js'), cfgId = path.join(app, 'config.js');
    Module._resolveFilename = function (req, parent) {
        if (/^\.\/kit\//.test(req) && parent && parent.filename && path.dirname(parent.filename) === app) return realResolve.call(this, path.join(KIT, req.slice(6)), parent);
        return realResolve.apply(this, arguments);
    };
    try {
        require.cache[mgu] = { id: mgu, filename: mgu, loaded: true, exports: { run: (a) => { captured = a; } } };
        Object.keys(require.cache).forEach((k) => { if (k.indexOf(app + path.sep) === 0) delete require.cache[k]; });
        cfgWas = require(cfgId);
        require.cache[cfgId].exports = Object.assign({}, cfgWas, { statsLogMs: 1000 });
        require(path.join(app, 'main.js'));
    } finally {
        delete require.cache[mgu];
    }
    return { mod: captured, restore: () => { Module._resolveFilename = realResolve; require.cache[cfgId].exports = cfgWas; } };
}

async function runTrace(o) {
    const opts = Object.assign({ app: path.join(REPO, 'apps', 'adam_mtrack'), hz: 10, rate: 3000, lead: 0, poll: true, getterMs: 3, pulls: 4, seed: 1 }, o);
    const app = path.resolve(opts.app);
    const spec = JSON.parse(fs.readFileSync(path.join(app, 'app.json'), 'utf8'));
    const G = require(path.join(app, 'geom.js')), cfg = require(path.join(app, 'config.js'));
    const R = ramp(opts.rate, opts.pulls);
    let seed = opts.seed;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

    // the fake cluster-render service, receipts stamped on the trace clock
    const sock = path.join(os.tmpdir(), 'mt-trace-' + process.pid + '-' + Math.floor(rnd() * 1e9) + '.sock');
    const fills = [], msgs = [];
    let shown = false, tachs = null;
    const fake = createFake(sock, (m) => {
        const t = now();
        msgs.push({ t, op: m.op || m.ev || '?' });
        if (m.op === 'layer' && m.z === cfg.build.z) tachs = m.ref;
        if (m.op === 'uniform' && m.ref === tachs && m.name === 'u_alive' && m.v === '1') shown = true;
        if (m.op === 'uniform' && m.name === 'u_fill') fills.push({ t, y: Number(m.v.split(' ')[0]) });
    }, null, { lingerMs: 300 });

    // settings, as the kit's Settings: app.json defaults, then the save
    const values = {}, listeners = [];
    spec.settings.forEach((s) => { values[s.key] = s.default; });
    Object.assign(values, { _settingsV: 2, coverOn: true, demo: 'off' });
    if (spec.settings.some((s) => s.key === 'tachLead')) values.tachLead = opts.lead;
    const settings = { get: (k) => values[k], set: (k, v) => { values[k] = v; listeners.forEach((fn) => fn(k, v)); }, onChange: (fn) => listeners.push(fn), cycle() {}, schema: spec.settings };

    // the car link: handlers per interface; inputs = when the app was handed an rpm (trace clock)
    const handlers = {}, inputs = [];
    let rpmNow = 1500, getterCalls = 0, start = null;
    const rpmAt = () => (start === null ? rpmNow : Math.max(0, R.at(now() - start)));
    const signals = {
        watch(iface, inst, h) {
            (handlers[iface] = handlers[iface] || []).push(h);
            const proxy = {
                getValue(field) {
                    getterCalls++;
                    if (field !== 'statusEngineSpeed2' || !opts.poll) return Promise.reject(new Error('no getter'));
                    return new Promise((res) => setTimeout(() => { inputs.push(now()); res({ actualValueRPMEngineCrankshaft: Math.round(rpmAt() * 4) }); }, opts.getterMs));
                },
            };
            return Promise.resolve({ iface, available: true, proxy, error: null });
        },
    };
    const feed = (iface, field, v) => (handlers[iface] || []).forEach((h) => { if (h[field]) h[field](v); });
    const lines = [];
    const log = { info: (m) => lines.push({ t: now(), m }), warn: (m) => lines.push({ t: now(), m: 'WARN ' + m }), error: (m) => lines.push({ t: now(), m: 'ERR ' + m }) };
    const themes = require(path.join(KIT, 'themes.js')), rec = require(path.join(KIT, 'record.js'));
    const ctx = {
        spec, settings, log, signals, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mt-trace-data-')),
        ui: { isVisible: () => false, onVisible() {}, onClick() {}, image: () => Promise.resolve(), open: () => Promise.resolve() },
        theme: () => themes.theme('m_tricolour'), canvas: (w, h) => new rec.Recorder(w, h, { textScale: 1 }).reset(), loop: () => {},
    };
    const loaded = loadApp(app);
    process.env.MTRACK_CR_SOCKET = sock;      // read by start()
    try { await loaded.mod.start(ctx); } finally { delete process.env.MTRACK_CR_SOCKET; loaded.restore(); }

    // the cover's conditions: Sport+, a speed every 100 ms, the popup list, temperatures and torque (the Power panel)
    let speedOn = true;
    const speed = () => { if (!speedOn) return; feed(I.V2, 'statusCarSpeed2', { speedVehicleCentreOfGravity: 80 * 64 }); setTimeout(speed, 100); };
    speed();
    feed(I.FES, 'statusFESVehicleDynamicSwitchHMI', { actualValueModeDrivingExperience: 2 });
    feed(I.CCM, 'basicList', []);
    feed(I.CDS, 'statusEngineTemperature', { temperatureEngineDrive: 90 + 48, temperatureEngineOilDrive: 95 + 48 });
    feed(I.CDS, 'statusEngineSpeed2', { actualValueRPMEngineCrankshaft: 1500 * 4 });
    const end0 = now() + 8000;
    while (!shown && now() < end0) await wait(10);
    if (!shown) throw new Error('the cover never showed: ' + lines.slice(-5).map((l) => l.m).join(' / '));
    await wait(300);

    const lag = [];
    let last = now();
    const lagTimer = setInterval(() => { const t = now(); lag.push(Math.max(0, t - last - 5)); last = t; }, 5);
    start = now();
    fills.length = 0; inputs.length = 0;
    const m0 = msgs.length;
    let notes = 0;
    await new Promise((done) => {
        const send = () => {
            const t = now() - start;
            if (t > R.ms) { done(); return; }
            rpmNow = Math.max(0, R.at(t));
            inputs.push(now());
            notes++;
            feed(I.CDS, 'statusEngineSpeed2', { actualValueRPMEngineCrankshaft: Math.round(rpmNow * 4) });
            feed(I.FES, 'statusActualValueTorque2', { actualValueTorqueCrankshaft: Math.round((200 + rpmNow / 20 + 1023.5) / 0.5) });
            setTimeout(send, Math.max(0, 1000 / opts.hz + (rnd() * 4 - 2) - (now() - start - t)));
        };
        if (opts.hz) send(); else setTimeout(done, R.ms);
    });
    clearInterval(lagTimer);
    const end = now();
    await wait(100);
    speedOn = false;
    settings.set('coverOn', false);
    await new Promise((res) => fake.close(res));

    // rpm shown by a u_fill: geom.yOfRpm inverted by bisection (y falls as the rpm rises)
    const rpmOfY = (y) => { let lo = 0, hi = cfg.tach.max; for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (G.yOfRpm(mid, cfg.tach) > y) lo = mid; else hi = mid; } return (lo + hi) / 2; };
    const A = [], B = [];
    fills.forEach((f) => {
        const before = inputs.filter((x) => x <= f.t);
        if (before.length) A.push(f.t - before[before.length - 1]);
        const tt = f.t - start, k = Math.floor(tt / R.one), x = tt - k * R.one, r = rpmOfY(f.y);
        if (k < opts.pulls && x > 400 && x < 400 + R.up && r > 1550 && r < 6450) B.push(tt - R.cross(k, r));   // rising only
    });
    const Bv = [];
    let fi = -1;
    for (let t = start; t <= end; t += 1) {
        while (fi + 1 < fills.length && fills[fi + 1].t <= t) fi++;
        const tt = t - start, k = Math.floor(tt / R.one), x = tt - k * R.one;
        if (fi < 0 || k >= opts.pulls || x <= 400 + 150 || x >= 400 + R.up) continue;       // rising, past its first 150 ms
        Bv.push(tt - R.cross(k, Math.max(1500, rpmOfY(fills[fi].y))));
    }
    const mean = (l) => (l.length ? r1(l.reduce((a, b) => a + b, 0) / l.length) : null);
    const secs = (end - start) / 1000, byOp = {};
    msgs.slice(m0).filter((m) => m.t <= end).forEach((m) => { byOp[m.op] = (byOp[m.op] || 0) + 1; });
    Object.keys(byOp).forEach((k) => { byOp[k] = r1(byOp[k] / secs); });
    // the app's own 1 s lines inside the trace (the first one after start also covers the build: skipped)
    const stat = lines.filter((l) => l.t > start + 1100 && l.t <= end + 50 && /^rpm notified\/s/.test(l.m)).map((l) => l.m);
    const maxOf = (re) => stat.reduce((a, s) => { const m = re.exec(s); return m && m[1] !== '-' ? Math.max(a, Number(m[1])) : a; }, 0);
    return {
        opts: { app: path.basename(path.dirname(path.dirname(app))) + '/' + path.basename(app), hz: opts.hz, rate: opts.rate, lead: opts.lead, poll: opts.poll },
        A: sum(A), B: sum(B), Bv: Object.assign(sum(Bv), { mean: mean(Bv) }), lag: { p99: r1(pct(lag, 0.99)), max: r1(pct(lag, 1)) }, perSec: byOp, fills: fills.length, notifications: notes, getterCalls,
        sendMax: maxOf(/sample->send max (\S+) ms/), boxMax: maxOf(/box draw max (\S+) ms/), statLines: stat,
        errors: lines.filter((l) => /^ERR/.test(l.m)).map((l) => l.m),
    };
}

if (require.main === module) {
    const a = {}, argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
    const o = {};
    if (a.app) o.app = a.app;
    ['hz', 'rate', 'lead', 'pulls'].forEach((k) => { if (a[k] !== undefined) o[k] = Number(a[k]); });
    if (a['getter-ms'] !== undefined) o.getterMs = Number(a['getter-ms']);
    if (a.poll) o.poll = a.poll !== 'off';
    runTrace(o).then((r) => {
        if (a.out) fs.writeFileSync(a.out, JSON.stringify(r) + '\n');
        const f = (s) => s.p50 + '/' + s.p95 + '/' + s.max;
        console.log([r.opts.app, 'hz ' + r.opts.hz, 'lead ' + r.opts.lead, 'poll ' + r.opts.poll, 'A p50/p95/max ' + f(r.A) + ' (n ' + r.A.n + ')', 'B ' + f(r.B) + ' (n ' + r.B.n + ')', 'Bv mean/p95/max ' + r.Bv.mean + '/' + r.Bv.p95 + '/' + r.Bv.max,
            'loop lag p99/max ' + r.lag.p99 + '/' + r.lag.max, 'msgs/s ' + JSON.stringify(r.perSec), 'sample->send max ' + r.sendMax, 'box draw max ' + r.boxMax,
            'getter ' + r.getterCalls, 'errors ' + r.errors.length].join(' | '));
        process.exit(0);
    }, (e) => { console.error(e && e.stack || e); process.exit(1); });
}

module.exports = { runTrace, ramp };
