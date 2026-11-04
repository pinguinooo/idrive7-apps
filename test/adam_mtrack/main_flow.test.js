'use strict';
/* main.js end to end: the kit's real Car on a fake signal link, the real cluster-render client against the fake
 * service. A default install never connects; the cover shows only after every condition held 1 s; each drop
 * condition removes every layer within one tick; exit closes the connection; the dead-man animation is restarted
 * every ~250 ms while shown; assets go once per arm, never on show or drop. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { createFake } = require('./fake_cluster_render');

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
};
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
async function until(fn, ms, what) {
    const end = Date.now() + (ms || 3000);
    while (Date.now() < end) { if (fn()) return; await wait(5); }
    throw new Error('timed out waiting for ' + what);
}
process.setMaxListeners(100);

function settingsOf(saved) {
    const values = {}, listeners = [];
    SPEC.settings.forEach((s) => { values[s.key] = s.default; });
    Object.assign(values, saved);
    const item = (k) => SPEC.settings.filter((s) => s.key === k)[0];
    const set = (k, v) => { values[k] = v; listeners.forEach((fn) => fn(k, v)); };
    return { values, get: (k) => values[k], set, onChange: (fn) => listeners.push(fn), schema: SPEC.settings, cycle: (k) => { if (item(k).type === 'bool') set(k, !values[k]); } };
}

let seq = 0;
/** main.js on a fresh fake ctx. r.feed(iface, field, value) is a car notification; r.speed(kmh|null) keeps a speed coming. */
async function start(saved, opts) {
    const o = opts || {};
    const sock = path.join(os.tmpdir(), 'mt-main-' + process.pid + '-' + (++seq) + '.sock');
    const msgs = [], lines = [], subs = {};
    const fake = createFake(sock, (m) => msgs.push(m));
    const settings = settingsOf(saved);
    const log = { info: (m) => lines.push(m), warn: (m) => lines.push('WARN ' + m), error: (m) => lines.push('ERR ' + m) };
    const signals = {
        watch: (iface, inst, handlers) => {
            const res = { iface, available: o.unavailable && o.unavailable.indexOf(iface) >= 0 ? false : true, proxy: null, error: null };
            (subs[iface] = subs[iface] || []).push(handlers);
            return Promise.resolve(res);
        },
    };
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-main-data-'));
    const ctx = {
        settings, log, dataDir, spec: SPEC, signals,
        ui: { isVisible: () => false, onVisible: () => {}, onClick: () => {}, image: () => Promise.resolve(), open: () => Promise.resolve() },
        loop: () => {}, theme: () => themes.theme('m_tricolour'),
        canvas: (w, h) => new Recorder(w, h, { textScale: 1 }).reset(),
    };
    const realResolve = Module._resolveFilename;
    Module._resolveFilename = function (req, parent) {
        if (/^\.\/kit\//.test(req) && parent && parent.filename && path.dirname(parent.filename) === APP) return realResolve.call(this, path.join(KIT, req.slice(6)), parent);
        return realResolve.apply(this, arguments);
    };
    let app = null;
    const id = path.join(KIT, 'mgu.js');
    try {
        process.env.MTRACK_CR_SOCKET = sock;
        require.cache[id] = { id, filename: id, loaded: true, exports: { run: (a) => { app = a; } } };
        delete require.cache[MAIN];
        require(MAIN);
        await app.start(ctx);
    } finally {
        Module._resolveFilename = realResolve;
        delete require.cache[id];
        delete process.env.MTRACK_CR_SOCKET;
    }
    const feed = (iface, field, value) => (subs[iface] || []).forEach((h) => { if (h[field]) h[field](value); });
    let kmh = null;
    const timer = setInterval(() => { if (kmh !== null) feed(I.V2, 'statusCarSpeed2', { speedVehicleCentreOfGravity: Math.round(kmh / 0.015625) }); }, 50);
    const r = {
        settings, lines, msgs, fake, dataDir, feed,
        speed: (x) => { kmh = x; },
        mode: (raw) => feed(I.FES, 'statusFESVehicleDynamicSwitchHMI', { actualValueModeDrivingExperience: raw }),
        rpm: (x) => feed(I.CDS, 'statusEngineSpeed2', { actualValueRPMEngineCrankshaft: x * 4 }),
        layerOps: () => msgs.filter((m) => m.op === 'layer'),
        live: () => msgs.filter((m) => m.op === 'layer' && !msgs.some((d) => d.op === 'drop' && d.ref === m.ref && d.conn === m.conn)),
        drops: () => msgs.filter((m) => m.op === 'drop'),
        done: () => new Promise((res) => { clearInterval(timer); kmh = null; settings.set('coverOn', false); setTimeout(() => fake.close(res), 30); }),
    };
    return r;
}
/** Cover on, Sport+, speed and Check Control there: resolves once the layers are made; t0 = when the conditions started. */
async function shownApp(saved) {
    const r = await start(Object.assign({ coverOn: true }, saved));
    r.speed(0); r.mode(2); r.feed(I.CCM, 'basicList', []);
    const t0 = Date.now();
    await until(() => r.live().length >= 8, 4000, 'the cover');
    r.shownAt = r.live()[0].t; r.t0 = t0;
    return r;
}
/** Every live layer is dropped within ms of cause() (fake-service timestamps). */
async function dropsWithin(r, cause, ms, what) {
    const refs = r.live().map((m) => m.ref);
    assert.ok(refs.length >= 7, 'layers before ' + what + ': ' + refs.length);
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
    ['shows only after 1 s of every condition; base overlay z 900 exclusive; assets once, before the layers', async () => {
        const r = await shownApp({});
        assert.ok(r.shownAt - r.t0 >= 950, 'shown after ' + (r.shownAt - r.t0) + ' ms');
        const base = r.live()[0];
        assert.strictEqual(base.target, 'panel'); assert.strictEqual(base.class, 'overlay'); assert.strictEqual(base.z, 900); assert.strictEqual(base.exclusive, 1);
        assert.ok(r.live().every((l) => l.class === 'overlay' && l.z >= 900 && l.target === 'panel'));
        const assetRefs = r.msgs.filter((m) => m.op === 'asset').map((m) => m.ref);
        assert.strictEqual(assetRefs.length, 10);
        const frames = r.msgs.filter((m) => m.op === 'frame');
        assert.ok(frames.filter((f) => assetRefs.indexOf(f.ref) >= 0 && f.t <= r.shownAt).length >= 10, 'asset pixels before the layers');
        const up = r.lines.filter((l) => /^upload at arm: /.test(l));
        assert.strictEqual(up.length, 1, up.join('\n'));
        assert.ok(Number(/(\d+) bytes/.exec(up[0])[1]) <= cfg.uploadBudgetBytes, up[0]);
        assert.ok(r.lines.indexOf('cover: shown') >= 0);
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
        await until(() => r.live().length >= 8, 3000, 'back after the message');
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
    ['no Check Control interface (unavailable, nothing sent): the cover never shows', async () => {
        const r = await start({ coverOn: true }, { unavailable: [I.CCM] });
        r.speed(0); r.mode(2);
        await wait(1500);
        assert.strictEqual(r.layerOps().length, 0);
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
    ['dead-man: u_alive restarted every ~250 ms while shown, none after the drop; no asset frames on show or drop', async () => {
        const r = await shownApp({});
        await wait(1100);
        const base = r.live()[0];
        const an = r.msgs.filter((m) => m.op === 'animate' && m.ref === base.ref && m.name === 'u_alive');
        assert.ok(an.length >= 4, 'animates: ' + an.length);
        const gaps = an.slice(1).map((m, i) => m.t - an[i].t);
        assert.ok(gaps.every((g) => g >= 150 && g <= 400), 'gaps ' + gaps.join(' '));
        assert.ok(an.every((m) => m.anim === an[0].anim && m.keys === cfg.safety.aliveKeys), 'same animation number and keys');
        const assetRefs = r.msgs.filter((m) => m.op === 'asset').map((m) => m.ref), shownAt = r.shownAt;
        const late = () => r.msgs.filter((m) => m.op === 'frame' && m.t > shownAt && ['lum', 'band', 'overR', 'overL', 'atlas', 'badge'].some((x, i) => assetRefs[i] === m.ref));
        r.mode(1);
        await until(() => r.live().length === 0, 500, 'drop');
        const n = r.msgs.filter((m) => m.op === 'animate' && m.name === 'u_alive').length;
        await wait(600);
        assert.strictEqual(r.msgs.filter((m) => m.op === 'animate' && m.name === 'u_alive').length, n, 'animates after the drop');
        assert.strictEqual(late().length, 0, 'static art re-sent');
        assert.strictEqual(r.lines.filter((l) => /^upload at arm/.test(l)).length, 1);
        await r.done();
    }],
    ['exit: process exit disarms (the service sees the connection close)', async () => {
        const r = await shownApp({});
        process.emit('exit', 0);
        await until(() => r.msgs.some((m) => m.ev === 'close'), 1000, 'close on exit');
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
];
