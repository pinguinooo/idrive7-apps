// M Track Cluster in the idrive7-apps emulator (test/adam_mtrack/emu-run.sh runs it). The emulator's manual signals
// (rpm, speed, gear, temperatures, g, torque) go through a second WebSocket the page opens to /ws; the rest (drive
// mode, Check Control, tyres, fuel, outside temperature, a speed stall) through the app's emu feed socket; BMW taking
// the panel through the fake service's control socket. Every check reads the fake service's log (timestamps on the
// same clock as this script) and the app's log; the cover is drawn from that log as the service would draw it
// (composite.mjs) and saved as PNGs, the pull as an mp4. The hang and the crash are emulator-only steps.
// env: PORT, CR_LOG, FEED, CTL, DATA_DIR, OUT. Exit 1 on any failed check.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { execSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createReplay, createCompositor, launch } from './composite.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const G = require(path.join(here, '../../apps/adam_mtrack/geom.js'));
const cfg = require(path.join(here, '../../apps/adam_mtrack/config.js'));
const { PORT, CR_LOG, FEED, CTL, DATA_DIR, OUT } = process.env;
for (const [k, v] of Object.entries({ PORT, CR_LOG, FEED, CTL, DATA_DIR, OUT })) if (!v) { console.error('missing env ' + k); process.exit(2); }
const RAW = path.join(OUT, 'raw');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [], results = {};
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures.push(what); return ok; };
const I = {
    FES: 'de.bmw.infotainment.drivingexcitement.FES', CCM: 'de.bmw.infotainment.checkcontrol.CheckControlMaster',
    TPMS: 'de.bmw.infotainment.vehicle.TPMS', KOMBI: 'de.bmw.infotainment.KombiIF', ENV: 'de.bmw.infrastructure.EnvironmentalInformation',
};

/* ---------- the emu feed (the app connects to us) and the fake service's control socket ---------- */
const feeds = new Set();
const feedSrv = net.createServer((c) => { feeds.add(c); c.on('close', () => feeds.delete(c)); c.on('error', () => {}); });
try { fs.unlinkSync(FEED); } catch (e) { /* none */ }
feedSrv.listen(FEED);
const feed = (o) => feeds.forEach((c) => c.write(JSON.stringify(o) + '\n'));
const ctl = (o) => new Promise((res) => { const c = net.connect(CTL, () => c.end(JSON.stringify(o) + '\n', res)); c.on('error', res); });
const mode = (raw) => feed({ iface: I.FES, field: 'statusFESVehicleDynamicSwitchHMI', value: { actualValueModeDrivingExperience: raw } });
const ccList = (list) => feed({ iface: I.CCM, field: 'basicList', value: list });

/* ---------- the fake service's log, read as it grows ---------- */
let logOff = 0, carry = '';
const recs = [];
function tail() {
    let fd;
    try { fd = fs.openSync(CR_LOG, 'r'); } catch (e) { return; }
    const size = fs.fstatSync(fd).size;
    if (size > logOff) {
        const b = Buffer.alloc(size - logOff);
        fs.readSync(fd, b, 0, b.length, logOff);
        logOff = size;
        const s = carry + b.toString('utf8'), lines = s.split('\n');
        carry = lines.pop();
        lines.filter(Boolean).forEach((l) => recs.push(JSON.parse(l)));
    }
    fs.closeSync(fd);
}
const since = (t) => { tail(); return recs.filter((m) => m.t >= t); };
/** Layers made and not dropped, of connections still open. */
function live() {
    tail();
    const closed = new Set(recs.filter((m) => m.ev === 'close').map((m) => m.conn)), out = new Map();
    recs.forEach((m) => { if (m.op === 'layer') out.set(m.conn + ':' + m.ref, m); else if (m.op === 'drop') out.delete(m.conn + ':' + m.ref); });
    return Array.from(out.values()).filter((m) => !closed.has(m.conn));
}
async function untilLive(pred, ms, what) {
    for (const end = Date.now() + (ms || 5000); Date.now() < end; await wait(20)) if (pred(live().length)) return true;
    console.log('  (timed out: ' + what + ', live ' + live().length + ')');
    return false;
}
/** When every layer live at t0 was dropped (or its connection closed), ms after t0; null if not all. */
function dropDelay(t0, refs) {
    const ts = refs.map((m) => { const d = recs.filter((x) => x.t >= t0 && x.conn === m.conn && ((x.op === 'drop' && x.ref === m.ref) || x.ev === 'close'))[0]; return d ? d.t : null; });
    return ts.some((x) => x === null) ? null : Math.max.apply(null, ts) - t0;
}

/* ---------- the emulator page ---------- */
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } });
await page.goto(`http://127.0.0.1:${PORT}/?panel=right`);
await page.evaluate(() => new Promise((res) => {
    const S = window.__sw = { status: [], log: [], ws: new WebSocket(`ws://${location.host}/ws`) };
    S.ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return;
        const m = JSON.parse(e.data);
        if (m.t === 'status') S.status.push([Date.now(), m.s]);
        else if (m.t === 'log') m.lines.forEach((l) => S.log.push([Date.now(), l[0], l[1]]));
    };
    S.ws.onopen = () => res();
}));
const appLog = async (t) => (await page.evaluate(() => window.__sw.log)).filter((l) => l[0] >= (t || 0)).map((l) => l[2]);
const send = (m) => page.evaluate((x) => window.__sw.ws.send(JSON.stringify(x)), m);
for (const end = Date.now() + 90000; Date.now() < end; await wait(200)) {
    const s = await page.evaluate(() => window.__sw.status);
    if (s.length && s[s.length - 1][1] === 'running') break;
}
await wait(2500);
let sigV = { rpm: 800, speed: 0, oil: 92, coolant: 90, gear: 'P', torque: 30, gLat: 0, gLong: 0 };
const sig = (v) => { sigV = Object.assign({}, sigV, v); return send({ t: 'sig', mode: 'manual', v: sigV }); };
const set = async (k, v) => { await send({ t: 'set', k, v }); await wait(200); };
const comp = await createCompositor(browser);
const replay = createReplay(recs, path.dirname(CR_LOG));
const shots = {};
async function shot(name, at) {
    tail();
    const t = at || Date.now(), r = await comp.render(replay.at(t), t);
    fs.writeFileSync(path.join(OUT, name + '.png'), r.png);
    shots[name] = { t, layers: r.layers, lit: r.lit };
    if (r.errors.length) check(false, name + ': shader errors ' + r.errors.join(' | '));
    return r;
}
const stage = page.locator('#stage');
const uiShot = async (name) => { await wait(900); await stage.screenshot({ path: path.join(OUT, name + '.png') }); };
const key = async (k, n) => { for (let i = 0; i < (n || 1); i++) { await page.keyboard.press(k); await wait(180); } };
// a settings tab by index: the first turn lands on the page's own tab, extra turns stop at the ends, focus stays on the
// tab after Enter. So: all the way left, Enter (Home), then i turns right, Enter.
const tab = async (i) => { await page.focus('#stage'); await key('[', 6); await key('Enter'); if (i) { await key(']', i); await key('Enter'); } await wait(500); };
const COVER = 0.25 * 1920 * 720;          // a shown cover lights most of the panel; an empty one none
const LAYERS = 8;

try {
    await sig({});
    // tyres, fuel, range, outside temperature: the emulator sends none of these
    feed({ iface: I.TPMS, field: 'statusTyrePressure', value: { actualValuePressureTyreFLH: 23, actualValuePressureTyreFRH: 23, actualValuePressureTyreRLH: 24, actualValuePressureTyreRRH: 24 } });
    feed({ iface: I.TPMS, field: 'statusTyreTemperature', value: { actualValueTemperatureTyreFLH: 54, actualValueTemperatureTyreFRH: 55, actualValueTemperatureTyreRLH: 53, actualValueTemperatureTyreRRH: 54 } });
    feed({ iface: I.KOMBI, field: 'statusRangeTankStatus', value: { fluidLevelFuelTank: 41, range: 512 } });
    feed({ iface: I.ENV, field: 'ExteriorTemperature', value: { temperatureExterior: 120 } });
    feed({ iface: I.FES, field: 'statusSwitchDriveDynamicSport2', value: { displayBoostPressure: 85 } });

    console.log('step 1 install defaults');
    await wait(2500);
    check(!since(0).some((m) => m.ev === 'connect'), '1 install defaults: no cluster-render connection at all');
    check(!live().length, '1 install defaults: no layers');

    // Adam's car (0.1.0 car test): no Check Control signal at all. The emulator's watch settles with the provider
    // unavailable, so nothing fed = the signal is missing, as on his car
    console.log('step 1b no popup signal (Adam\'s car): Use if sent shows the cover, Require keeps it off and says why');
    const t1b = Date.now();
    mode(2);
    await set('coverOn', true);
    check(await untilLive((n) => n >= LAYERS, 6000, 'the cover without a popup signal'), '1b BMW popups = Use if sent, no popup signal: the cover shows');
    // logged once at start (the emulator's watch settles at once): read the whole log so far
    const lgStart = await appLog();
    check(lgStart.indexOf('BMW popup signal (CheckControlMaster): missing') >= 0 && lgStart.indexOf('BMW popup signal (CheckControlMaster): present') < 0,
        '1b the app logs the popup signal as missing (and never present)');
    await shot('mtrack-nocc-auto-cover');
    await send({ t: 'ccu' });
    await wait(300);
    await tab(3);
    await uiShot('mtrack-nocc-auto-safety');
    await dropStep('1b Require without the popup signal', () => set('popupGuard', 'require'), 400);
    await uiShot('mtrack-nocc-require-safety');
    check((await appLog(t1b)).some((l) => /^why off: BMW popups \(Require\): the popup signal is missing/.test(l)), '1b why off logged: BMW popups (Require), popup signal missing');
    await tab(0);
    await uiShot('mtrack-nocc-require-home');
    await backStep('1b back to Use if sent', () => set('popupGuard', 'auto'));
    await set('coverOn', false);
    check(await untilLive((n) => n === 0, 1500, 'cover off after 1b'), '1b cover off: dropped');

    console.log('step 2 cover on in Comfort');
    mode(4); ccList([]);
    let t = Date.now();
    await set('coverOn', true);
    await wait(2500);
    check(since(t).some((m) => m.op === 'asset'), '2 cover on: connected and the assets uploaded');
    check(!since(t).some((m) => m.op === 'layer'), '2 Comfort with Sport+ only: no layer');
    const up = (await appLog(t)).filter((l) => /upload at arm: /.test(l));
    results.upload = up;
    check(up.length === 1 && Number(/(\d+) bytes/.exec(up[0])[1]) <= cfg.uploadBudgetBytes, '2 upload at arm within ' + cfg.uploadBudgetBytes + ': ' + up.join(' / '));
    const assetFrames = since(t).filter((m) => m.op === 'frame');

    console.log('step 3 Sport+ idle in P');
    t = Date.now();
    mode(2);
    check(await untilLive((n) => n >= LAYERS, 5000, 'cover'), '3 Sport+: the cover shows');
    const first = live()[0];
    results.showDelay = first ? first.t - t : null;
    check(first && first.t - t >= 950, '3 shown after ' + results.showDelay + ' ms (every condition held 1 s first)');
    check(first && first.exclusive === 1 && first.z === 900 && first.class === 'overlay', '3 base layer: overlay, z 900, exclusive');
    await wait(600);
    let r = await shot('mtrack-01-idle-P-0mph');
    check(r.lit > COVER, '3 idle composite drawn (' + r.lit + ' lit px)');

    console.log('step 4 pull to 7,000 rpm');
    const pull = { t0: Date.now(), at: {} };
    for (let i = 0; i <= 62; i++) {
        const rpm = 800 + 100 * i, f = i / 62, gear = f < 0.35 ? 'D1' : f < 0.7 ? 'D2' : 'D3';
        await sig({ rpm, speed: Math.round(96.56 * f), gear, torque: 300 + 200 * f, oil: 95, gLong: 0.4 });
        for (const k of [1000, 2000, 3000, 4000, 5000, 6000, 6500, 7000]) if (rpm >= k && !pull.at[k]) pull.at[k] = Date.now() + 120;
        await wait(100);
    }
    await wait(500);
    pull.t1 = Date.now();
    for (const k of [1000, 2000, 3000, 4000, 5000, 6000, 6500, 7000]) await shot('mtrack-02-pull-' + k + 'rpm', pull.at[k]);
    await shot('mtrack-03-7000rpm-60mph');
    const fills = since(pull.t0).filter((m) => m.op === 'uniform' && m.name === 'u_fill').map((m) => Number(m.v.split(' ')[0]));
    results.fillAt7000 = fills[fills.length - 1];
    check(Math.abs(fills[fills.length - 1] - G.yOfRpm(7000, cfg.tach)) < 0.5 && Math.abs(G.yOfRpm(7000, cfg.tach) - G.BARS.tickTopY) < 0.5,
        '4 at 7,000 rpm the fill top is the 7 tick (y ' + fills[fills.length - 1] + ' vs ' + G.BARS.tickTopY + ')');
    check(since(pull.t0).some((m) => m.op === 'uniform' && m.name === 'u_st' && /^10 1 /.test(m.v)), '4 the slats flash at the limiter');
    check(!since(assetFrames.length ? assetFrames[assetFrames.length - 1].t + 1 : pull.t0).some((m) => m.op === 'asset'), '4 no asset made again during the drive');
    await sig({ rpm: 1500, speed: 60, gear: 'D3', gLong: 0 });
    await wait(400);

    async function dropStep(name, cause, maxMs, minMs) {
        const refs = live();
        const t0 = Date.now();
        await cause();
        await untilLive((n) => n === 0, (maxMs || 500) + 1500, name);
        const ms = dropDelay(t0, refs);
        results[name] = ms;
        check(refs.length >= LAYERS && ms !== null && ms <= maxMs && (!minMs || ms >= minMs), name + ': every layer dropped ' + ms + ' ms after the cause (limit ' + maxMs + ')');
        return ms;
    }
    async function backStep(name, cause) {
        const t0 = Date.now();
        await cause();
        const ok = await untilLive((n) => n >= LAYERS, 5000, name);
        const m = live()[0], ms = m ? m.t - t0 : null;
        check(ok && ms >= 950, name + ': back ' + ms + ' ms later (after 1 s)');
    }

    console.log('step 5 Sport+ -> Sport');
    await dropStep('5 Sport+ to Sport', () => mode(1), 200);
    r = await shot('mtrack-drop-mode-sport');
    check(r.layers === 0, '5 after the drop the panel draws nothing of ours');
    await backStep('5 back in Sport+', () => mode(2));

    console.log('step 6 Sport and above, Sport individual');
    await set('whenToShow', 'sport');
    await dropStep('6 Comfort under Sport and above', () => mode(4), 250);
    await backStep('6 Sport individual (FES 3) under Sport and above', () => mode(3));
    await shot('mtrack-when-sport-in-sport');

    console.log('step 7 Always in Comfort');
    await set('whenToShow', 'always');
    t = Date.now();
    mode(4);
    await wait(1500);
    check(live().length >= LAYERS && !since(t).some((m) => m.op === 'drop'), '7 Always: stays shown in Comfort');
    await shot('mtrack-when-always-in-comfort');
    await set('whenToShow', 'sportplus');
    await untilLive((n) => n === 0, 1000, 'sportplus only');
    mode(2);
    await untilLive((n) => n >= LAYERS, 3000, 'back');

    console.log('step 8 speed lost');
    await dropStep('8 speed lost', () => feed({ block: 'speed', on: true }), 1150, 900);
    await shot('mtrack-drop-speed-lost');
    await backStep('8 speed back', () => feed({ block: 'speed', on: false }));

    console.log('step 9 Check Control message');
    await dropStep('9 Check Control active', () => ccList([{ ccmId: 1, activeState: 'AKTIV', reason: 'test' }]), 200);
    await shot('mtrack-drop-check-control');
    await backStep('9 message cleared', () => ccList([{ ccmId: 1, activeState: 'INAKTIV' }]));

    console.log('step 10 BMW holds the panel');
    await dropStep('10 BMW holds the panel (waiting, stock)', () => ctl({ target: 'panel', state: 'waiting', holder: 'stock' }), 250);
    await shot('mtrack-drop-bmw-popup');
    await backStep('10 BMW gives it back', () => ctl({ target: 'panel', state: 'shown' }));

    console.log('step 11 kill file');
    const kill = path.join(DATA_DIR, cfg.safety.killFile);
    await dropStep('11 DISABLE file', () => fs.writeFileSync(kill, ''), 250);
    await shot('mtrack-drop-kill-switch');
    fs.unlinkSync(kill);
    await untilLive((n) => n >= LAYERS, 6000, 'after the kill file');
    check(live().length >= LAYERS, '11 DISABLE removed: re-armed and shown again');

    console.log('step 14 panel choices');
    await sig({ gLat: 0.35, gLong: -0.2 });
    await set('leftPanel', 'gforce');
    await set('rightPanel', 'coolant'); await set('rightLower', 'boost');
    await wait(1500);
    await shot('mtrack-panels-gmeter-coolant-boost');
    await set('swapSides', true);
    await wait(1500);
    await shot('mtrack-swap-sides');
    await set('swapSides', false);
    for (const [k, v] of [['leftPanel', 'tyres'], ['rightPanel', 'torque'], ['rightLower', 'power']]) await set(k, v);
    await sig({ gLat: 0, gLong: 0 });

    console.log('step 15 units');
    await set('units', 'metric');
    await untilLive((n) => n >= LAYERS, 6000, 'metric');
    await wait(1500);
    await shot('mtrack-metric');
    await set('units', 'us');
    await untilLive((n) => n >= LAYERS, 6000, 'us');
    await wait(1500);
    await shot('mtrack-us');
    const quads = since(0).filter((m) => m.op === 'uniform' && m.name === 'u_src');
    check(quads.length > 0, '15 glyph quads sent');

    console.log('step 16 brightness');
    await set('bright', 40);
    await wait(800);
    await shot('mtrack-brightness-40');
    await set('bright', 100);

    console.log('step 17 settings pages');
    const PAGE_IDS = ['home', 'panels', 'look', 'safety', 'about'];
    await send({ t: 'ccu' });
    await wait(300);
    for (let i = 0; i < PAGE_IDS.length; i++) { await tab(i); await uiShot('mtrack-page-' + PAGE_IDS[i]); }
    // the Safety page while a guard holds the cover off: the why line names the guard and its signal's status
    await tab(3);
    const tWhy = Date.now();
    feed({ block: 'speed', on: true });
    check(await untilLive((n) => n === 0, 2500, 'speed stale on the Safety page'), '17 speed stale with the Safety page open: dropped');
    await uiShot('mtrack-page-safety-why-off');
    check((await appLog(tWhy)).some((l) => /^why off: Speed timeout: speed signal stale \(none for 1 s\)$/.test(l)), '17 why off logged: Speed timeout, speed signal stale');
    feed({ block: 'speed', on: false });
    await untilLive((n) => n >= LAYERS, 5000, 'back after the Safety shot');
    await tab(0);

    console.log('step 12 hang (SIGSTOP the app process)');
    const pid = execSync("pgrep -f 'hu-stub.js .*adam_mtrack' | head -1").toString().trim();
    await sig({ rpm: 3000, speed: 50, gear: 'D3' });
    await untilLive((n) => n >= LAYERS, 3000, 'before the hang');
    await wait(500);
    const tStop = Date.now();
    execFileSync('kill', ['-STOP', pid]);
    await wait(1300);
    r = await shot('mtrack-hang-1300ms', tStop + 1300);
    const dropsInHang = since(tStop).filter((m) => m.op === 'drop' || m.ev === 'close').length;
    execFileSync('kill', ['-CONT', pid]);
    results.hang = { lit: r.lit, layers: r.layers, drops: dropsInHang };
    check(r.layers >= LAYERS && dropsInHang === 0 && r.lit < 0.01 * 1920 * 720, '12 hang: layers still there, nothing dropped, yet the panel is blank by +1.3 s (u_alive 0; ' + r.lit + ' lit px)');
    // resumed, the speed it saw last is over 1 s old: it drops (no speed), then shows again once a speed held 1 s
    const tCont = Date.now();
    await wait(300);
    const back = await untilLive((n) => n >= LAYERS && since(tCont).some((m) => m.op === 'layer'), 4000, 'after the hang') || live().length >= LAYERS;
    await wait(300);
    r = await shot('mtrack-hang-resumed');
    results.hangResume = (await appLog(tCont)).filter((l) => /^cover: /.test(l));
    check(back && r.lit > COVER, '12 resumed: the cover is drawn again (' + results.hangResume.join(', ') + ')');

    console.log('step 13 crash (SIGKILL the app process, emulator only)');
    const tKill = Date.now();
    execFileSync('kill', ['-9', pid]);
    let closed = false;
    for (const end = Date.now() + 3000; Date.now() < end && !closed; await wait(20)) closed = since(tKill).some((m) => m.ev === 'close');
    await wait(100);
    r = await shot('mtrack-crash');
    results.crash = { closedAfter: closed ? since(tKill).filter((m) => m.ev === 'close')[0].t - tKill : null, layers: r.layers, lit: r.lit };
    check(closed && r.layers === 0 && r.lit === 0, '13 crash: the connection closed (' + results.crash.closedAfter + ' ms) and the panel is empty');

    const bad = (await appLog()).filter((l) => /STOPPED|error in (?!boost)/.test(l));
    check(bad.length === 0, 'no "error in" / STOPPED lines in the app log' + (bad.length ? ': ' + bad.slice(0, 3).join(' / ') : ''));

    console.log('the pull clip');
    const fdir = path.join(RAW, 'pull');
    fs.mkdirSync(fdir, { recursive: true });
    const vr = createReplay(recs.slice(), path.dirname(CR_LOG));
    let n = 0;
    for (let tt = pull.t0 - 500; tt <= pull.t1; tt += 1000 / 30) {
        const x = await comp.render(vr.at(tt), tt);
        fs.writeFileSync(path.join(fdir, 'f' + String(n++).padStart(4, '0') + '.png'), x.png);
    }
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(fdir, 'f%04d.png'), '-vf', 'scale=1280:-2', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '22', path.join(OUT, 'mtrack-pull-7000.mp4')]);
    check(fs.statSync(path.join(OUT, 'mtrack-pull-7000.mp4')).size > 50000, 'the pull clip: ' + n + ' frames, mp4 written');
} catch (e) {
    check(false, 'sweep threw: ' + (e && e.stack || e));
} finally {
    fs.writeFileSync(path.join(RAW, 'app.log'), (await appLog().catch(() => [])).join('\n') + '\n');
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, shots, failures }, null, 1));
    await browser.close();
    feedSrv.close();
    console.log(failures.length ? failures.length + ' FAILED' : 'all checks passed');
    process.exit(failures.length ? 1 : 0);
}
