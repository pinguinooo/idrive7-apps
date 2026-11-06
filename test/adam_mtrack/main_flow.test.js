'use strict';
/* main.js end to end: the kit's real Car on a fake signal link, the real cluster-render client against the fake
 * service. A default install never connects; the cover builds only after every condition held 1 s, stage by stage
 * (4 layers, each made hidden, confirmed and written before the next), and shows with u_alive 1; each drop condition
 * removes every layer within one tick; exit closes the connection; the dead-man is re-armed every ~60 ms with a new
 * animation while shown; assets go once per arm, never again on a drop and a re-show; a refused stage stops the build
 * and the Safety page says which and why; the 3.5 s hand-over after Shift Lights' HUD. The Safety settings: no popup
 * signal (Adam's car) shows with Use if sent and stays off with Require; Ignore; a popup signal not answered yet; drop
 * if no drive mode; the speed timeout; a hand-edited settings file cannot switch an always-on guard off; 0.1.0
 * settings migrate; the trip disarms; no art never arms. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { createFake } = require('./fake_cluster_render');
const { ClusterRender } = require('../../apps/adam_mtrack/cluster_render_client');

const KIT = path.join(__dirname, '..', '..', 'kit', 'runtime');
const APP = path.join(__dirname, '..', '..', 'apps', 'adam_mtrack');
const MAIN = path.join(APP, 'main.js');
const SPEC = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));
const cfg = require(path.join(APP, 'config.js'));
const { Recorder } = require(path.join(KIT, 'record.js'));
const themes = require(path.join(KIT, 'themes.js'));
const I = {
    CDS: 'de.bmw.infotainment.vehicle.CDS', V2: 'de.bmw.infotainment.vehicle.Vehicle2', FES: 'de.bmw.infotainment.drivingexcitement.FES',
    CCM: 'de.bmw.infotainment.checkcontrol.CheckControlMaster', KI2: 'de.bmw.infotainment.KombiInterface_2',
    VI: 'de.bmw.infrastructure.VehicleInformation',
};
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
async function until(fn, ms, what) {
    const end = Date.now() + (ms || 3000);
    while (Date.now() < end) { if (fn()) return; await wait(5); }
    throw new Error('timed out waiting for ' + what);
}
process.setMaxListeners(100);

/** The kit's Settings (defaults under the saved values); raw: only the saved values, as a bare settings.json reads. */
function settingsOf(saved, raw) {
    const values = {}, listeners = [];
    if (!raw) SPEC.settings.forEach((s) => { values[s.key] = s.default; });
    Object.assign(values, saved);
    const item = (k) => SPEC.settings.filter((s) => s.key === k)[0];
    const set = (k, v) => { values[k] = v; listeners.forEach((fn) => fn(k, v)); };
    return { values, get: (k) => values[k], set, onChange: (fn) => listeners.push(fn), schema: SPEC.settings, cycle: (k) => { if (item(k).type === 'bool') set(k, !values[k]); } };
}

let seq = 0;
/**
 * main.js on a fresh fake ctx. r.feed(iface, field, value) is a car notification; r.speed(kmh|null) keeps a speed coming.
 * opts: unavailable [ifaces] (the watch settles, the provider never answers), delay { iface: ms } (the watch settles
 * that late; -1 never), raw (settingsOf raw), noArt (the art pack fails to open), lingerMs (the fake's panel linger,
 * 300 ms here), own (the kit runs the screen: r.page(i) opens a tab, r.screen() is its text, r.press(key) presses a control),
 * cfg (config.js values replaced for this run, e.g. a short statsLogMs).
 */
async function start(saved, opts) {
    const o = opts || {};
    const sock = path.join(os.tmpdir(), 'mt-main-' + process.pid + '-' + (++seq) + '.sock');
    const msgs = [], lines = [], subs = {};
    const fake = createFake(sock, (m) => msgs.push(m), null, { lingerMs: o.lingerMs !== undefined ? o.lingerMs : 300 });
    let lastCv = null, tabFn = null;
    const settings = settingsOf(saved, o.raw);
    const log = { info: (m) => lines.push(m), warn: (m) => lines.push('WARN ' + m), error: (m) => lines.push('ERR ' + m) };
    const signals = {
        watch: (iface, inst, handlers) => {
            const res = { iface, available: o.unavailable && o.unavailable.indexOf(iface) >= 0 ? false : true, proxy: null, error: null };
            (subs[iface] = subs[iface] || []).push(handlers);
            const ms = o.delay && o.delay[iface];
            if (ms === -1) return new Promise(() => {});
            return ms ? new Promise((res2) => setTimeout(() => res2(res), ms)) : Promise.resolve(res);
        },
    };
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-main-data-'));
    const ctx = {
        settings, log, dataDir, spec: SPEC, signals,
        ui: { isVisible: () => !!o.own, onVisible: () => {}, onClick: () => {}, image: (n, cv) => { lastCv = cv; return Promise.resolve(); }, open: () => Promise.resolve() },
        loop: () => {}, theme: () => themes.theme('m_tricolour'), onTab: (fn) => { tabFn = fn; },
        canvas: (w, h) => {
            const r = new Recorder(w, h, { textScale: 1 }).reset();
            if (!o.own) return r;
            r.own = true; r.chrome = { tabs: null }; r.drawn = [];
            const text = r.text.bind(r);
            r.text = function (str) { r.drawn.push(String(str)); return text.apply(null, arguments); };
            return r;
        },
    };
    const realResolve = Module._resolveFilename;
    Module._resolveFilename = function (req, parent) {
        if (/^\.\/kit\//.test(req) && parent && parent.filename && path.dirname(parent.filename) === APP) return realResolve.call(this, path.join(KIT, req.slice(6)), parent);
        return realResolve.apply(this, arguments);
    };
    let app = null;
    const id = path.join(KIT, 'mgu.js'), packId = path.join(KIT, 'pack.js'), cfgId = path.join(APP, 'config.js');
    const cfgWas = require.cache[cfgId].exports;
    try {
        if (o.cfg) require.cache[cfgId].exports = Object.assign({}, cfgWas, o.cfg);   // main.js reads it once, in start()
        process.env.MTRACK_CR_SOCKET = sock;
        require.cache[id] = { id, filename: id, loaded: true, exports: { run: (a) => { app = a; } } };
        if (o.noArt) require.cache[packId] = { id: packId, filename: packId, loaded: true, exports: { open: () => { throw new Error('no art (test)'); } } };
        delete require.cache[MAIN];
        require(MAIN);
        await app.start(ctx);
    } finally {
        Module._resolveFilename = realResolve;
        require.cache[cfgId].exports = cfgWas;
        delete require.cache[id];
        if (o.noArt) delete require.cache[packId];
        delete process.env.MTRACK_CR_SOCKET;
    }
    const feed = (iface, field, value) => (subs[iface] || []).forEach((h) => { if (h[field]) h[field](value); });
    let kmh = null;
    const timer = setInterval(() => { if (kmh !== null) feed(I.V2, 'statusCarSpeed2', { speedVehicleCentreOfGravity: Math.round(kmh / 0.015625) }); }, 50);
    const r = {
        settings, lines, msgs, fake, dataDir, feed, sock,
        speed: (x) => { kmh = x; },
        mode: (raw) => feed(I.FES, 'statusFESVehicleDynamicSwitchHMI', { actualValueModeDrivingExperience: raw }),
        rpm: (x) => feed(I.CDS, 'statusEngineSpeed2', { actualValueRPMEngineCrankshaft: x * 4 }),
        layerOps: () => msgs.filter((m) => m.op === 'layer'),
        live: () => msgs.filter((m) => m.op === 'layer' && !msgs.some((d) => d.op === 'drop' && d.ref === m.ref && d.conn === m.conn)),
        drops: () => msgs.filter((m) => m.op === 'drop'),
        app: (conn) => { const h = msgs.filter((m) => m.conn === conn && m.op === 'hello')[0]; return h ? h.app : ''; },
        page: async (i) => { tabFn(i); await wait(30); },
        screen: () => (lastCv && lastCv.drawn ? lastCv.drawn.join('\n') : ''),
        press: (key) => { const t = lastCv && lastCv.targets.filter((x) => x.key === key)[0]; if (!t) throw new Error('no control ' + key); t.run(); },
        done: () => new Promise((res) => { clearInterval(timer); kmh = null; settings.set('coverOn', false); setTimeout(() => fake.close(res), 30); }),
    };
    return r;
}
/** The cover's own live layers (not another app's, not a test step's). */
const mine = (r) => r.live().filter((m) => r.app(m.conn) === 'adam_mtrack');
/** The cover's live tachs layer (stage 1) and when it got u_alive 1 (it is shown last): null while not shown. */
function shownAt(r) {
    const t = mine(r).filter((l) => l.z === cfg.build.z)[0];
    const m = t && r.msgs.filter((x) => x.conn === t.conn && x.ref === t.ref && x.op === 'uniform' && x.name === 'u_alive' && x.v === '1')[0];
    return m ? m.t : null;
}
const coverUp = (r) => shownAt(r) !== null;
/** Cover on, Sport+, speed and Check Control there: resolves once the cover is shown; t0 = when the conditions started. */
async function shownApp(saved, opts) {
    const r = await start(Object.assign({ coverOn: true }, saved), opts);
    r.speed(0); r.mode(2); r.feed(I.CCM, 'basicList', []);
    const t0 = Date.now();
    await until(() => coverUp(r), 5000, 'the cover');
    r.shownAt = shownAt(r); r.t0 = t0;
    return r;
}
/** Another app's client (Shift Lights) with one effect layer on target. */
function otherApp(r, target) {
    const c = new ClusterRender('adam_shiftlights', r.sock);
    c.on('ready', () => c.effect({ target, klass: 'overlay', x: 700, y: 200, w: 520, h: 80, fs: 'void main() {}' }));
    c.connect();
    return c;
}
/** Every live layer is dropped within ms of cause() (fake-service timestamps). */
async function dropsWithin(r, cause, ms, what) {
    const refs = r.live().map((m) => m.ref);
    assert.ok(refs.length >= 4, 'layers before ' + what + ': ' + refs.length);
    const t = Date.now();
    await cause();
    await until(() => refs.every((ref) => r.drops().some((d) => d.ref === ref)), 2500, what + ' to drop every layer');
    const last = Math.max.apply(null, refs.map((ref) => r.drops().filter((d) => d.ref === ref)[0].t));
    assert.ok(last - t <= ms, what + ': dropped after ' + (last - t) + ' ms');
    return last - t;
}

module.exports = [
    ['default install: never connects to cluster-render, no layer, coverOn false', async () => {
        const r = await start({});
        r.speed(0); r.mode(2); r.feed(I.CCM, 'basicList', []);
        await wait(1400);
        assert.strictEqual(r.settings.get('coverOn'), false);
        assert.ok(!r.msgs.some((m) => m.ev === 'connect'), 'connected: ' + JSON.stringify(r.msgs.slice(0, 3)));
        assert.ok(r.lines.some((l) => /^kill switch file: /.test(l)));
        await r.done();
    }],
    ['builds only after 1 s of every condition: 4 layers (content z 90 to 93, never exclusive), each made hidden after its assets and lifted; 11 assets under the memory budget; shown with u_alive 1', async () => {
        const r = await shownApp({});
        const L4 = mine(r);
        assert.ok(L4[0].t - r.t0 >= 950, 'first layer after ' + (L4[0].t - r.t0) + ' ms');
        assert.deepStrictEqual(L4.map((l) => [l.target, l.class, l.z, l.exclusive, l.visible]), [90, 91, 92, 93].map((z) => ['panel', 'content', z, 0, 0]));
        L4.forEach((l) => assert.ok(r.msgs.some((m) => m.conn === l.conn && m.op === 'set' && m.ref === l.ref && m.visible === 1 && m.t >= l.t), 'lifted: z ' + l.z));
        const assets = r.msgs.filter((m) => m.op === 'asset');
        assert.strictEqual(assets.length, 11);
        const mem = assets.reduce((b, a) => b + a.w * a.h * (a.format === 'r8' ? 1 : 4) * 2, 0);
        assert.ok(mem <= cfg.memoryBudgetBytes, 'renderer memory ' + mem);
        const frames = r.msgs.filter((m) => m.op === 'frame');
        assert.ok(assets.every((a) => frames.some((f) => f.ref === a.ref && f.t <= r.shownAt)), 'every asset\'s pixels before the show');
        assert.ok(L4.every((l) => r.msgs.some((m) => m.conn === l.conn && m.ref === l.ref && m.op === 'uniform' && m.name === 'u_alive' && m.v === '1')), 'u_alive 1 on every layer');
        assert.ok(r.lines.some((l) => /^cover: shown \(4 layers, 11 assets, 3\.0 MiB of renderer memory, built in \d+ ms\)$/.test(l)), r.lines.join('\n'));
        await r.done();
    }],
    ['drop: Sport+ to Sport (Sport+ only), within one tick; back after 1 s in Sport+', async () => {
        const r = await shownApp({});
        await dropsWithin(r, () => r.mode('SPORT_DYNAMIC'), 150, 'Sport');
        r.mode('SPORT_EXPERT');
        const t = Date.now();
        await until(() => r.live().length > 0, 3000, 'back in Sport+');
        assert.ok(Date.now() - t >= 950);
        await r.done();
    }],
    ['drop: Cover the cluster off disarms at once (layers dropped, connection closed)', async () => {
        const r = await shownApp({});
        await dropsWithin(r, () => r.settings.set('coverOn', false), 60, 'cover off');
        await until(() => r.msgs.some((m) => m.ev === 'close'), 1000, 'close');
        await r.done();
    }],
    ['drop: no speed for over 1 s (dropped by 1.1 s), never while it keeps coming', async () => {
        const r = await shownApp({});
        await wait(600);
        assert.strictEqual(r.drops().length, 0, 'speed flowing: no drop');
        const ms = await dropsWithin(r, () => r.speed(null), 1150, 'speed stale');
        assert.ok(ms >= 900, 'dropped too early: ' + ms + ' ms');
        await r.done();
    }],
    ['drop: an error inside a guarded callback drops at once', async () => {
        const r = await shownApp({});
        const bad = {};
        Object.defineProperty(bad, 'displayBoostPressure', { get() { throw new Error('test throw'); } });
        await dropsWithin(r, () => r.feed(I.FES, 'statusSwitchDriveDynamicSport2', bad), 60, 'error');
        assert.ok(r.lines.some((l) => /ERR error in boost/.test(l)));
        await r.done();
    }],
    ['drop: the kill file, within one tick', async () => {
        const r = await shownApp({});
        await dropsWithin(r, () => fs.writeFileSync(path.join(r.dataDir, cfg.safety.killFile), ''), 150, 'kill file');
        assert.ok(r.lines.some((l) => /kill file found/.test(l)));
        fs.unlinkSync(path.join(r.dataDir, cfg.safety.killFile));
        await r.done();
    }],
    ['drop: an active Check Control message; a new one holds it off 1 s after it clears', async () => {
        const r = await shownApp({});
        await dropsWithin(r, () => r.feed(I.CCM, 'basicList', [{ ccmId: 7, activeState: 'AKTIV' }]), 60, 'check control');
        r.feed(I.CCM, 'basicList', [{ ccmId: 7, activeState: 'INAKTIV' }]);
        await until(() => coverUp(r), 4000, 'back after the message');
        await dropsWithin(r, () => r.feed(I.KI2, 'newCCMessage', { cCIdentifier: 1 }), 60, 'new check control');
        await r.done();
    }],
    ['drop: BMW holds the panel (target waiting, holder stock)', async () => {
        const r = await shownApp({});
        await dropsWithin(r, () => r.fake.target('panel', 'waiting', 'stock'), 150, 'BMW holds the panel');
        await r.done();
    }],
    ['drop: demo data (demo on); never shows on demo data', async () => {
        const r = await shownApp({});
        await dropsWithin(r, () => r.settings.set('demo', 'on'), 250, 'demo');
        await wait(1300);
        assert.strictEqual(r.live().length, 0, 'shown on demo data');
        await r.done();
    }],
    ['the speed sentinel 65535 is no value: never alive, the cover never shows', async () => {
        const r = await start({ coverOn: true });
        r.mode(2); r.feed(I.CCM, 'basicList', []);
        const tm = setInterval(() => r.feed(I.V2, 'statusCarSpeed2', { speedVehicleCentreOfGravity: 65535 }), 50);
        await wait(1500);
        clearInterval(tm);
        assert.strictEqual(r.layerOps().length, 0);
        await r.done();
    }],
    ['no popup signal (CheckControlMaster never answers, Adam\'s car), default BMW popups = Use if sent: the cover shows', async () => {
        const r = await start({ coverOn: true }, { unavailable: [I.CCM] });
        r.speed(0); r.mode(2);
        await until(() => coverUp(r), 5000, 'the cover without a popup signal');
        assert.ok(r.lines.indexOf('BMW popup signal (CheckControlMaster): missing') >= 0, r.lines.join('\n'));
        assert.ok(r.lines.some((l) => /^signals after the watches: Signals: speed .*, BMW popups missing \(no answer\)$/.test(l)), r.lines.join('\n'));
        await r.done();
    }],
    ['Require: no popup signal keeps the cover off (why logged); Use if sent shows it; back to Require drops it at once', async () => {
        const r = await start({ coverOn: true, popupGuard: 'require' }, { unavailable: [I.CCM] });
        r.speed(0); r.mode(2);
        await wait(1500);
        assert.strictEqual(r.layerOps().length, 0, 'the 0.1.0 rule');
        assert.ok(r.lines.some((l) => /^why off: BMW popups \(Require\): the popup signal is missing \(no answer\)$/.test(l)), r.lines.join('\n'));
        r.settings.set('popupGuard', 'auto');
        await until(() => coverUp(r), 4000, 'shown with Use if sent');
        await dropsWithin(r, () => r.settings.set('popupGuard', 'require'), 60, 'back to Require');
        await r.done();
    }],
    ['Ignore: a Check Control message (list or new-message event) does not drop the cover; BMW holding the panel still does', async () => {
        const r = await shownApp({ popupGuard: 'ignore' });
        r.feed(I.CCM, 'basicList', [{ ccmId: 7, activeState: 'AKTIV' }]);
        r.feed(I.KI2, 'newCCMessage', { cCIdentifier: 1 });
        await wait(400);
        assert.strictEqual(r.drops().length, 0, 'a popup with Ignore');
        await dropsWithin(r, () => r.fake.target('panel', 'waiting', 'stock'), 150, 'BMW holds the panel with Ignore');
        await r.done();
    }],
    ['Use if sent waits for a popup signal whose watch has not settled, and shows 1 s after it answers', async () => {
        const r = await start({ coverOn: true }, { delay: { [I.CCM]: 1500 } });
        const t0 = Date.now();
        r.speed(0); r.mode(2);
        await until(() => coverUp(r), 6000, 'shown after the popup signal answered');
        assert.ok(r.live()[0].t - t0 >= 2300, 'shown ' + (r.live()[0].t - t0) + ' ms after start: it waited');
        assert.ok(r.lines.indexOf('BMW popup signal (CheckControlMaster): waiting') >= 0 && r.lines.indexOf('BMW popup signal (CheckControlMaster): present') >= 0);
        await r.done();
    }],
    ['Use if sent: a popup signal that never answers counts as missing after signalWaitMs (monotonic), then the cover shows', async () => {
        const realHr = process.hrtime;
        let shift = 0;
        process.hrtime = function (prev) { const x = realHr.call(process, prev); if (prev) x[0] += shift; return x; };
        try {
            const r = await start({ coverOn: true }, { delay: { [I.CCM]: -1 } });
            r.speed(0); r.mode(2);
            await wait(1400);
            assert.strictEqual(r.layerOps().length, 0, 'waits while the popup signal may still answer');
            assert.ok(r.lines.some((l) => /^why off: BMW popups: waiting for the popup signal/.test(l)), r.lines.join('\n'));
            shift = Math.ceil(cfg.safety.signalWaitMs / 1000);
            await until(() => coverUp(r), 4000, 'shown once the wait ran out');
            assert.ok(r.lines.indexOf('BMW popup signal (CheckControlMaster): missing') >= 0);
            await r.done();
        } finally { process.hrtime = realHr; }
    }],
    ['Drop if no drive mode: on keeps Always off with no drive mode (why logged); off shows it; on again drops it', async () => {
        const r = await start({ coverOn: true, whenToShow: 'always', modeMissingDrop: true });
        r.speed(0); r.feed(I.CCM, 'basicList', []);
        await wait(1500);
        assert.strictEqual(r.layerOps().length, 0, 'no drive mode, Drop if missing on');
        assert.ok(r.lines.some((l) => /^why off: Drop if no drive mode \(on\): the drive-mode signal is missing \(no mode sent yet\)$/.test(l)), r.lines.join('\n'));
        r.settings.set('modeMissingDrop', false);
        await until(() => coverUp(r), 4000, 'Always without a drive mode');
        r.mode(0);
        await wait(300);
        assert.strictEqual(r.drops().length, 0, 'a value with no mode, Drop if missing off: stays');
        await dropsWithin(r, () => r.settings.set('modeMissingDrop', true), 60, 'Drop if missing turned on');
        await r.done();
    }],
    ['Speed timeout 0.5 s: no speed drops the cover by about 0.6 s', async () => {
        const r = await shownApp({ speedStaleMs: 500 });
        const ms = await dropsWithin(r, () => r.speed(null), 700, 'speed stale at 0.5 s');
        assert.ok(ms >= 400, 'dropped too early: ' + ms + ' ms');
        await r.done();
    }],
    ['a hand-edited settings file with bad values cannot switch an always-on guard off (speed timeout, kill file)', async () => {
        const r = await shownApp({ popupGuard: 'off', modeMissingDrop: 'no', speedStaleMs: 999999, whenToShow: 'never',
            requireCheckControl: false, killFile: '', errorLimit: 1e9, speedStaleMinMs: 0, safety: { speedStaleMs: 1e9 } });
        ['popupGuard', 'modeMissingDrop', 'speedStaleMs', 'whenToShow'].forEach((k) => assert.ok(r.lines.some((l) => l.indexOf('WARN settings: ' + k + ' was not valid') === 0), k));
        assert.ok(r.lines.some((l) => /BMW popups require, drop if no drive mode true, speed timeout 1000 ms/.test(l)), 'read as the strict side');
        const ms = await dropsWithin(r, () => r.speed(null), 1150, 'speed stale with 999999 saved');
        assert.ok(ms >= 900, 'dropped too early: ' + ms + ' ms');
        r.speed(0);
        await until(() => coverUp(r), 4000, 'back');
        await dropsWithin(r, () => fs.writeFileSync(path.join(r.dataDir, cfg.safety.killFile), ''), 150, 'kill file with a bad killFile saved');
        fs.unlinkSync(path.join(r.dataDir, cfg.safety.killFile));
        await r.done();
    }],
    ['settings saved by 0.1.0 (no Safety keys, _settingsV 1) migrate to v2, and the cover shows on a car with no popup signal', async () => {
        const r = await start({ coverOn: true, whenToShow: 'sportplus', units: 'us', _settingsV: 1 }, { raw: true, unavailable: [I.CCM] });
        const V = r.settings.values;
        assert.deepStrictEqual([V.popupGuard, V.modeMissingDrop, V.speedStaleMs, V._settingsV, V.coverOn], ['auto', false, 1000, 2, true]);
        assert.ok(r.lines.some((l) => /^settings migrated to v2: /.test(l)), r.lines.join('\n'));
        r.speed(0); r.mode(2);
        await until(() => coverUp(r), 5000, 'the cover after the migration');
        await r.done();
    }],
    ['5 errors in 10 s: the trip disarms (connection closed), the cover stays off until Cover the cluster goes off and on', async () => {
        const r = await shownApp({});
        const bad = {};
        Object.defineProperty(bad, 'displayBoostPressure', { get() { throw new Error('test throw'); } });
        for (let i = 0; i < cfg.safety.errorLimit; i++) r.feed(I.FES, 'statusSwitchDriveDynamicSport2', bad);
        await until(() => r.msgs.some((m) => m.ev === 'close'), 1000, 'disarmed on the trip');
        assert.ok(r.lines.some((l) => /^ERR STOPPED after /.test(l)));
        await wait(1300);
        assert.strictEqual(r.live().length, 0, 'stays off after the trip');
        r.settings.set('coverOn', false); r.settings.set('coverOn', true);
        await until(() => coverUp(r), 5000, 'back after off and on');
        await r.done();
    }],
    ['no art: the cover never arms or connects, and says why', async () => {
        const r = await start({ coverOn: true }, { noArt: true });
        r.speed(0); r.mode(2); r.feed(I.CCM, 'basicList', []);
        await wait(1400);
        assert.ok(!r.msgs.some((m) => m.ev === 'connect'), 'connected without art');
        assert.ok(r.lines.some((l) => /art\/art\.json is missing or damaged/.test(l)));
        assert.ok(r.lines.some((l) => /^why off: Art check: the art file is missing or damaged/.test(l)), r.lines.join('\n'));
        await r.done();
    }],
    ['Always shows in Comfort; Sport and above shows in Sport individual (3), not in Comfort', async () => {
        const r = await start({ coverOn: true, whenToShow: 'always' });
        r.speed(0); r.mode(4); r.feed(I.CCM, 'basicList', []);
        await until(() => r.live().length > 0, 3000, 'Always in Comfort');
        r.settings.set('whenToShow', 'sport');
        await until(() => r.live().length === 0, 500, 'dropped in Comfort');
        r.mode(3);
        await until(() => r.live().length > 0, 3000, 'Sport individual');
        await r.done();
    }],
    ['dead-man: u_alive 1 while shown (never 0 after the show), a new animation every ~60 ms then the old one stopped; none after the drop; the art never sent again on a drop and a re-show', async () => {
        const r = await shownApp({});
        await wait(700);
        const tachs = mine(r).filter((l) => l.z === cfg.build.z)[0];
        const an = r.msgs.filter((m) => m.op === 'animate' && m.ref === tachs.ref && m.conn === tachs.conn && m.name === 'u_alive');
        assert.ok(an.length >= 7, 'animates: ' + an.length);
        assert.ok(an.every((m, i) => m.anim === i + 1 && m.keys === cfg.safety.aliveKeys), 'a new number each time: ' + an.map((m) => m.anim).join(' '));
        const gaps = an.slice(1).map((m, i) => m.t - an[i].t);
        assert.ok(gaps.every((g) => g >= 40 && g <= 200), 'gaps ' + gaps.join(' '));
        const stops = r.msgs.filter((m) => m.op === 'stop' && m.ref === tachs.ref && m.conn === tachs.conn);
        assert.ok(stops.length >= an.length - 2 && stops.every((m, i) => m.anim === i + 1), 'each old one stopped after the new one: ' + stops.map((m) => m.anim).join(' '));
        assert.deepStrictEqual(r.msgs.filter((m) => m.ref === tachs.ref && m.conn === tachs.conn && m.op === 'uniform' && m.name === 'u_alive').map((m) => m.v), ['0', '1'], 'clear while lifted, then 1 for good');
        r.mode(1);
        await until(() => r.live().length === 0, 500, 'drop');
        const n = r.msgs.filter((m) => m.op === 'animate' && m.name === 'u_alive').length;
        await wait(400);
        assert.strictEqual(r.msgs.filter((m) => m.op === 'animate' && m.name === 'u_alive').length, n, 'animates after the drop');
        r.mode(2);
        await until(() => coverUp(r), 4000, 'shown again');
        assert.strictEqual(r.msgs.filter((m) => m.op === 'asset').length, 11, 'the art went once');
        assert.strictEqual(r.msgs.filter((m) => m.op === 'frame' && m.t > r.shownAt && r.msgs.some((a) => a.op === 'asset' && a.ref === m.ref && a.w !== 520 && a.w !== 900 && a.w !== 680)).length, 0, 'static art re-sent');
        await r.done();
    }],
    ['exit: process exit disarms (the service sees the connection close)', async () => {
        const r = await shownApp({});
        process.emit('exit', 0);
        await until(() => r.msgs.some((m) => m.ev === 'close'), 1000, 'close on exit');
        await r.done();
    }],
    ['another app on the shared scene (Shift Lights\' HUD): no cover layer, Home and Safety say so and name it; the cover shows once the HUD lets go', async () => {
        const r = await start({ coverOn: true }, { own: true });
        const other = otherApp(r, 'hud');
        await until(() => r.fake.state('hud').state === 'shown', 2000, 'the HUD shown');
        r.speed(0); r.mode(2); r.feed(I.CCM, 'basicList', []);
        await wait(1600);
        assert.strictEqual(mine(r).length, 0, 'a cover layer while the HUD holds the scene');
        assert.ok(r.lines.some((l) => /^why off: Another app is using the cluster: turn off Shift Lights cluster\/HUD$/.test(l)), r.lines.join('\n'));
        assert.ok(r.lines.some((l) => l === 'WARN cover: another app is using the cluster (the HUD is shown): the cover waits'), r.lines.join('\n'));
        assert.ok(r.lines.some((l) => /^cluster-render status \(another app: the HUD is shown\): .*adam_shiftlights effect on hud shown/.test(l)), r.lines.join('\n'));
        await r.page(0);
        assert.ok(/Why the cover is off right now: Another app is using the cluster: turn off Shift Lights cluster\/HUD/.test(r.screen()), r.screen());
        await r.page(3);
        assert.ok(/Cluster renderer: another app is using the cluster \(adam_shiftlights on hud\)/.test(r.screen()), r.screen());
        const tc = Date.now();
        other.close();
        await until(() => mine(r).length > 0, 9000, 'the cover once the HUD let go');
        assert.ok(mine(r)[0].t - tc >= cfg.build.handoverMs - 100, 'first layer ' + (mine(r)[0].t - tc) + ' ms after the HUD let go: the 3.5 s hand-over');
        assert.ok(r.lines.some((l) => /^cover: waiting \d\.\d s for the HUD to let go of the shared scene$/.test(l)), r.lines.join('\n'));
        await until(() => coverUp(r), 4000, 'shown');
        await r.done();
    }],
    ['another app\'s layer on the panel (Shift Lights\' cluster slats): the cover refuses too, and shows once it goes', async () => {
        const r = await start({ coverOn: true });
        const other = otherApp(r, 'panel');
        await until(() => r.fake.state('panel').state === 'shown', 2000, 'their panel');
        r.speed(0); r.mode(2); r.feed(I.CCM, 'basicList', []);
        await wait(1600);
        assert.strictEqual(mine(r).length, 0);
        assert.ok(r.lines.some((l) => l === 'WARN cover: another app is using the cluster (the panel is shown for another app): the cover waits'), r.lines.join('\n'));
        other.close();
        await until(() => coverUp(r), 9000, 'shown after they left');
        await r.done();
    }],
    ['Cover off: dropped and closed at once, then a watcher that only says hello and asks the status confirms the panel idle', async () => {
        const r = await shownApp({});
        await dropsWithin(r, () => r.settings.set('coverOn', false), 60, 'cover off');
        await until(() => r.lines.some((l) => /^release confirmed \(cover off\): panel idle .* s after, the renderer status lists none of our layers$/.test(l)), 3000, 'the release confirmed');
        const watch = r.msgs.filter((m) => m.op === 'hello' && m.app === 'adam_mtrack-watch').map((m) => m.conn);
        assert.strictEqual(watch.length, 1);
        assert.ok(r.msgs.filter((m) => m.conn === watch[0] && m.op).every((m) => m.op === 'hello' || m.op === 'status'), 'the watcher makes nothing');
        await r.done();
    }],
    ['a guard drop (Sport+ to Sport) keeps the connection; the panel going idle is confirmed on it with the status', async () => {
        const r = await shownApp({});
        const conn = mine(r)[0].conn;
        await dropsWithin(r, () => r.mode('SPORT_DYNAMIC'), 150, 'Sport');
        const t = Date.now();
        await until(() => r.lines.some((l) => /^release confirmed \(mode\): panel idle/.test(l)), 3000, 'confirmed');
        assert.ok(r.msgs.some((m) => m.conn === conn && m.op === 'status' && m.t >= t - 500), 'asked on the cover connection');
        assert.ok(!r.msgs.some((m) => m.conn === conn && m.ev === 'close'), 'the connection stays');
        await r.done();
    }],
    ['Cover off while another app keeps the panel: "release NOT confirmed" names it (our layers gone)', async () => {
        const r = await shownApp({});
        const other = otherApp(r, 'panel');
        await wait(300);
        r.settings.set('coverOn', false);
        await until(() => r.lines.some((l) => /^WARN release NOT confirmed \(cover off\): our layers gone, panel shown, adam_shiftlights on panel after 6\.\d s$/.test(l)), 9000, 'NOT confirmed');
        other.close();
        await r.done();
    }],
    ['a renderer error event: the cover drops (an error) and the error reaches the Safety page and the diag log', async () => {
        const r = await start({ coverOn: true }, { own: true });
        r.speed(0); r.mode(2); r.feed(I.CCM, 'basicList', []);
        await until(() => coverUp(r), 5000, 'the cover');
        const base = mine(r)[0];
        await dropsWithin(r, () => r.fake.error('layer', base.ref, 'fs: refused by the test'), 150, 'an error event');
        assert.ok(r.lines.some((l) => /^ERR error in cluster-render: Error: cluster-render refused layer \d+: fs: refused by the test/.test(l)), r.lines.join('\n'));
        await r.page(3);
        assert.ok(/Cluster renderer: .*error: fs: refused by the test/.test(r.screen()), r.screen());
        const d = fs.readFileSync(path.join(r.dataDir, 'mtrack-diag.log'), 'utf8');
        assert.ok(/< \{"ev":"error","op":"layer","ref":\d+,"reason":"fs: refused by the test"\}/.test(d), d.slice(-2000));
        await r.done();
    }],
    ['BMW holds the panel: dropped, and asked for again only after the 10 s backoff (no map / unmap churn on slot 0x203)', async () => {
        const r = await shownApp({});
        await dropsWithin(r, () => r.fake.target('panel', 'waiting', 'stock'), 150, 'BMW holds the panel');
        const t = Date.now();
        r.fake.target('panel', 'shown');
        await wait(2500);
        assert.strictEqual(r.live().length, 0, 'back within 2.5 s');
        assert.ok(r.lines.some((l) => /^cover: BMW took the panel \(.+\): asking again in 10 s$/.test(l)), r.lines.join('\n'));
        await until(() => coverUp(r), 14000, 'back after the backoff');
        assert.ok(Date.now() - t >= 9500, 'back after ' + (Date.now() - t) + ' ms');
        await r.done();
    }],
    ['the diag log: what was sent (hello, asset bytes, layers with shader lengths, binds, drops) and what came back (targets, layers, the status)', async () => {
        const r = await shownApp({});
        r.mode(1);
        await until(() => r.live().length === 0, 1000, 'drop');
        await until(() => r.lines.some((l) => /^release confirmed \(mode\)/.test(l)), 3000, 'release');
        const d = fs.readFileSync(path.join(r.dataDir, 'mtrack-diag.log'), 'utf8');
        [new RegExp('start: M Track ' + SPEC.version.replace(/\./g, '\\.') + ', node v'), /> \{"op":"hello","app":"adam_mtrack","proto":1\}/, /> pixels bgR2 \(asset \d+, r8 480x360\): 172800 B/,
            /> \{"op":"layer","ref":\d+,"target":"panel","kind":"effect","class":"content","z":90,"x":0,"y":0,"w":1920,"h":720,"visible":0,"exclusive":0,"contend":0,"fs":"\d+ chars"\}/,
            /cover: stage 1 TACHS made hidden \(layer \d+, 5 assets, 882448 B\)/, /> \{"op":"set","ref":\d+,"visible":1\}/, /> \{"op":"bind",/,
            /cover: stage 1 TACHS confirmed and written: bound/, /cover: stage 4 SLATS confirmed and written: bound/,
            /< \{"ev":"hello"/, /< \{"ev":"target","target":"panel","state":"shown"/, /< \{"ev":"layer","ref":\d+,"state":"shown"/,
            /< status: upload: cap .* \| target panel: /, /> \{"op":"drop","ref":\d+\}/, /release confirmed \(mode\): panel idle/].forEach((re) => assert.ok(re.test(d), re + '\n' + d.slice(0, 2500)));
        assert.ok(!/"op":"uniform"/.test(d) && !/"name":"u_alive"/.test(d) && !/"op":"stop"/.test(d), 'uniforms, alive re-arms and stops are counted, not logged one by one');
        await r.done();
    }],
    ['test pattern from the Safety page pill: refused while the cover is on (says so); step 1 KNOWN with the cover off and parked: one layer and its 1024 x 576 card on adam_mtrack-test, built, shown 10 s, removed, release confirmed', async () => {
        const r = await start({ coverOn: true }, { own: true });
        r.speed(0); r.mode(2); r.feed(I.CCM, 'basicList', []);
        await r.page(3);
        r.press('safety:test:1');
        await wait(100);
        assert.ok(r.lines.indexOf('test: step 1 KNOWN refused: turn Cover the cluster off first') >= 0, r.lines.join('\n'));
        r.settings.set('coverOn', false);
        await r.page(3);
        assert.ok(/Step 1 KNOWN refused: turn Cover the cluster off first/.test(r.screen()), r.screen());
        r.press('safety:test:1');
        await until(() => r.msgs.some((m) => m.op === 'layer' && r.app(m.conn) === 'adam_mtrack-test'), 3000, 'the test layer');
        const layers = r.msgs.filter((m) => m.op === 'layer' && r.app(m.conn) === 'adam_mtrack-test'), conn = layers[0].conn;
        assert.deepStrictEqual(layers.map((l) => [l.w, l.h, l.class, l.z, l.visible]), [[1920, 720, 'content', 90, 0]]);
        assert.deepStrictEqual(r.msgs.filter((m) => m.op === 'asset' && m.conn === conn).map((a) => [a.format, a.w, a.h, a.sampling]), [['r8', 1024, 576, 'bilinear']]);
        await until(() => r.msgs.some((m) => m.conn === conn && m.op === 'uniform' && m.name === 'u_alive' && m.v === '1'), 3000, 'shown');
        const t0 = Date.now();
        for (let i = 0; i < 20 && !/Step 1 KNOWN showing/.test(r.screen()); i++) await r.page(3);
        assert.ok(/Step 1 KNOWN showing: \d+ s left\. Watch the cluster/.test(r.screen()) && /Test pattern: what cluster-render said/.test(r.screen()), r.screen());
        await until(() => r.msgs.some((m) => m.ev === 'close' && m.conn === conn), 12000, 'removed after 10 s');
        assert.ok(Date.now() - t0 >= 9700, 'removed after ' + (Date.now() - t0) + ' ms');
        await until(() => r.lines.some((l) => /^release confirmed \(test step 1\): panel idle/.test(l)), 3000, 'released');
        await r.page(3);
        assert.ok(/Step 1 KNOWN done: released/.test(r.screen()) && /Released: panel idle/.test(r.screen()), r.screen());
        await r.done();
    }],
    ['a guard failing while the cover builds drops what the build made, within one tick (the renderer not writing: the build waits at stage 1)', async () => {
        const r = await start({ coverOn: true }, { own: true });
        r.fake.writes(false);
        r.speed(0); r.mode(2); r.feed(I.CCM, 'basicList', []);
        await until(() => mine(r).length === 1 && r.msgs.some((m) => m.op === 'set' && m.visible === 1), 5000, 'stage 1 made and lifted');
        await wait(300);
        assert.strictEqual(shownAt(r), null, 'never shown: its art is not written');
        await r.page(3);
        assert.ok(/Cover build: stage 1 of 4 TACHS: waiting for the renderer to write its art/.test(r.screen()), r.screen());
        const ref = mine(r)[0].ref, t = Date.now();
        r.mode('SPORT_DYNAMIC');
        await until(() => r.drops().some((d) => d.ref === ref), 1000, 'the build dropped');
        assert.ok(r.drops().filter((d) => d.ref === ref)[0].t - t <= 150, 'within one tick');
        assert.ok(r.lines.some((l) => /^cover: build dropped at stage 1 \(mode\)$/.test(l)), r.lines.join('\n'));
        r.fake.writes(true);
        await r.done();
    }],
    ['a refused stage stops the cover\'s build there: Home and Safety say which stage and why; it builds again after the error hold', async () => {
        const r = await start({ coverOn: true }, { own: true });
        r.speed(0); r.mode(2); r.feed(I.CCM, 'basicList', []);
        await until(() => mine(r).some((l) => l.z === cfg.build.z + 1), 5000, 'stage 2 made');
        const ref = mine(r).filter((l) => l.z === cfg.build.z + 1)[0].ref;
        r.fake.error('layer', ref, 'refused by the test');
        await until(() => r.lines.some((l) => l === 'WARN cover: build stopped at stage 2 of 4 PANELS: refused: layer: refused by the test'), 2000, 'stopped');
        assert.ok(r.lines.some((l) => /^ERR error in cluster-render: Error: cluster-render refused layer \d+: refused by the test \(stage 2 PANELS\)/.test(l)), 'one error counted');
        assert.strictEqual(mine(r).length, 0, 'the stopped build\'s layers dropped');
        await r.page(3);
        assert.ok(/Cover build: stopped at stage 2 of 4 PANELS: refused: layer: refused by the test/.test(r.screen()), r.screen());
        assert.ok(/(Cover build|last build) stopped at stage 2 of 4 PANELS/.test(r.screen()), 'the why line names it: ' + r.screen());
        await until(() => coverUp(r), 6000, 'built again and shown');
        await r.done();
    }],
    ['rpm moves the fill line (u_fill) and the slats light near the shift point', async () => {
        const r = await shownApp({});
        r.rpm(6900);
        await until(() => r.msgs.some((m) => m.op === 'uniform' && m.name === 'u_st' && /^10 /.test(m.v)), 1000, 'all slats lit');
        const fills = r.msgs.filter((m) => m.op === 'uniform' && m.name === 'u_fill').map((m) => Number(m.v.split(' ')[0]));
        assert.ok(fills[fills.length - 1] < 230, 'fill line at ' + fills[fills.length - 1]);
        await r.done();
    }],
    ['0.1.6 gear: the engaged gear\'s digit in the gear spot (DataPowerTrain2 _4 draws 4, statusGearboxDrive D + G6 draws 6), P a letter; the raw gearbox values logged', async () => {
        const art = JSON.parse(fs.readFileSync(path.join(APP, 'art', 'art.json'), 'utf8')), gs = art.atlas.styles.gear.glyphs;
        const r = await shownApp({});
        const centre = mine(r).filter((l) => l.z === cfg.build.z + 2)[0];
        const gearSrc = () => { const u = r.msgs.filter((m) => m.conn === centre.conn && m.ref === centre.ref && m.op === 'uniform' && m.name === 'u_src'); return u.length ? u[u.length - 1].v.split(' ').slice(0, 2).map(Number) : null; };
        const shows = (c) => { const g = gearSrc(); return !!g && g[0] === gs[c].x && g[1] === gs[c].y; };
        r.feed(I.VI, 'DataPowerTrain2', { statusGearSelectionDrive: '_4' });
        r.rpm(2000);
        await until(() => shows('4'), 1500, 'the digit 4');
        const gb = { statusActualStageDrive: 'D', statusActualGearDrive: 'G6' };
        r.feed(I.VI, 'statusGearboxDrive', gb);
        r.rpm(2100);
        await until(() => shows('6'), 1500, 'the digit 6');
        r.feed(I.VI, 'statusGearboxDrive', { statusActualStageDrive: 'P', statusActualGearDrive: 'N_OR_P' });
        r.rpm(800);
        await until(() => shows('P'), 1500, 'P');
        assert.ok(r.lines.indexOf('gearbox: ' + JSON.stringify(gb)) >= 0, r.lines.filter((l) => /gear/.test(l)).join('\n'));
        assert.ok(r.lines.indexOf('gear selection: "_4"') >= 0, 'the kit logs DataPowerTrain2');
        r.feed(I.VI, 'statusGearboxDrive', gb);
        assert.strictEqual(r.lines.filter((l) => l === 'gearbox: ' + JSON.stringify(gb)).length, 1, 'each distinct value once');
        await r.done();
    }],
    ['0.1.6 log: every statsLogMs the rpm path line (notified, poll, sample->send, box draw, socket blocked, tach lead)', async () => {
        const r = await shownApp({}, { cfg: { statsLogMs: 300 } });
        r.rpm(3000);
        const re = /^rpm notified\/s \d+\.\d \(gap p50\/p90 \S+\/\S+ ms\), rpm poll \d+\.\d\/s \(rtt p50 \S+ ms, fails \d+\), sample->send max \S+ ms, box draw max \S+ ms, socket blocked \d+ of \d+ pump ticks, tach lead (\d+) ms$/;
        await until(() => r.lines.some((l) => re.test(l)), 2000, 'the rpm line');
        const l = r.lines.filter((x) => re.test(x)).pop(), ticks = Number(/of (\d+) pump/.exec(l)[1]);
        assert.ok(ticks > 0, l);
        assert.strictEqual(Number(re.exec(l)[1]), cfg.rpmLead.leadMs, 'the Tach lead in use: the default');
        await r.done();
    }],
    ['0.1.6 Tach lead: a rising rpm puts the fill line above the raw rpm\'s; Off draws the raw rpm', async () => {
        const fillAfterRise = async (saved) => {
            const r = await shownApp(saved);
            for (let k = 0; k <= 8; k++) { r.rpm(2000 + 250 * k); await wait(40); }   // ~6 rpm/ms
            await wait(30);
            const f = r.msgs.filter((m) => m.op === 'uniform' && m.name === 'u_fill').map((m) => Number(m.v.split(' ')[0]));
            await r.done();
            return f[f.length - 1];
        };
        const G = require(path.join(APP, 'geom.js'));
        const off = await fillAfterRise({ tachLead: 0 }), on = await fillAfterRise({ tachLead: 80 });
        assert.ok(Math.abs(off - G.yOfRpm(4000, cfg.tach)) < 0.2, 'Off: the raw 4000 rpm (' + off + ')');
        assert.ok(on < off - 2, 'lead 80: higher on the bar (' + on + ' vs ' + off + ')');
        assert.ok(on >= G.yOfRpm(4000 + cfg.rpmLead.maxAddRpm, cfg.tach) - 0.2, 'never more than maxAddRpm ahead (' + on + ')');
    }],
    ['0.1.6 boxes: the cover loop draws at most one changed box a tick (round robin), each box at most panelHz', async () => {
        const r = await shownApp({});
        const t0 = Date.now();
        await wait(200);
        for (let k = 0; k < 30; k++) {      // both side panels change all the time: coolant / oil left, torque / power right
            r.feed(I.CDS, 'statusEngineTemperature', { temperatureEngineDrive: 80 + k + 48, temperatureEngineOilDrive: 85 + k + 48 });
            r.feed(I.FES, 'statusActualValueTorque2', { actualValueTorqueCrankshaft: Math.round((100 + 10 * k + 1023.5) / 0.5) });
            r.rpm(2000 + 50 * k);
            await wait(50);
        }
        const fr = r.msgs.filter((m) => m.op === 'frame' && m.t > t0 + 200).sort((a, b) => a.t - b.t);
        const refs = {};
        fr.forEach((f) => { (refs[f.ref] = refs[f.ref] || []).push(f.t); });
        assert.ok(Object.keys(refs).length >= 2, 'both panels redrawn: ' + JSON.stringify(Object.keys(refs)));
        for (let i = 1; i < fr.length; i++) assert.ok(fr[i].ref === fr[i - 1].ref || fr[i].t - fr[i - 1].t >= 60, 'two boxes in one tick: ' + (fr[i].t - fr[i - 1].t) + ' ms apart');
        Object.keys(refs).forEach((k) => refs[k].forEach((t, i) => assert.ok(!i || t - refs[k][i - 1] >= 1000 / cfg.panelHz - 30, 'box ' + k + ' again after ' + (t - refs[k][i - 1]) + ' ms')));
        await r.done();
    }],
];
