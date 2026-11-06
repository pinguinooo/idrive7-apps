// The cover in a car photo's state (iDrive-Apps docs/reference/mtrack/car-2026-11-05-cover-0.1.3.jpg: M Track 0.1.3's
// own cover on the car, not BMW's display, KB-ANY-213; no stock photo exists yet), for
// iDrive-Apps tools/oem-compare/fidelity.py: P, 0 mph, engine off (0 rpm: the photo's red block sits at the 0 tick),
// SPORT+, cold engine (coolant 60 C, oil 40 C: both needles at the scale's start), torque and power 0, range 87 mi,
// outside +64 F, the fuel needle near the photo's. Coolant over oil left, torque over power right (the defaults), US.
// The clock: emu-run.sh's EMU_FAKETIME starts the emulator's clock so the shot reads 3:37 (libfaketime, emulator only).
// Shots (file names kept): oem-cover.png (renderer animations on) and oem-cover-noanims.png (a renderer that plays none). Exit 1 on failure.
//   SCRIPT=emu_oem.mjs EMU_DIR=... OUT=... bash test/adam_mtrack/emu-run.sh
// env: PORT, CR_LOG, FEED, DATA_DIR, OUT (as emu_sweep.mjs).
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createReplay, createCompositor, launch } from './composite.mjs';

const { PORT, CR_LOG, FEED, DATA_DIR, OUT } = process.env;
for (const [k, v] of Object.entries({ PORT, CR_LOG, FEED, DATA_DIR, OUT })) if (!v) { console.error('missing env ' + k); process.exit(2); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures.push(what); return ok; };
const PHOTO = { rpm: 0, speed: 0, coolant: 60, oil: 40, rangeKm: 140, ambientRaw: 116, fuelL: 17 };   // 116 = (18 C + 40) / 0.5

const feeds = new Set();
const feedSrv = net.createServer((c) => { feeds.add(c); c.on('close', () => feeds.delete(c)); c.on('error', () => {}); });
try { fs.unlinkSync(FEED); } catch (e) { /* none */ }
feedSrv.listen(FEED);
const feed = (o) => feeds.forEach((c) => c.write(JSON.stringify(o) + '\n'));

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } });
await page.goto(`http://127.0.0.1:${PORT}/?panel=right`);
await page.evaluate(() => new Promise((res) => {
    const S = window.__sw = { log: [], ws: new WebSocket(`ws://${location.host}/ws`) };
    S.ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return;
        const m = JSON.parse(e.data);
        if (m.t === 'log') m.lines.forEach((l) => S.log.push([Date.now(), l[0], l[1]]));
    };
    S.ws.onopen = () => res();
}));
const appLog = async () => (await page.evaluate(() => window.__sw.log)).map((l) => l[2]);
const send = (m) => page.evaluate((x) => window.__sw.ws.send(JSON.stringify(x)), m);
const set = async (k, v) => { await send({ t: 'set', k, v }); await wait(200); };

try {
    let started = false;
    for (const end = Date.now() + 90000; Date.now() < end && !started; await wait(200)) started = (await appLog()).some((l) => /^started: /.test(l));
    check(started, 'the app started');
    for (let n = 0; n < 40 && !feeds.size; n++) await wait(250);
    check(feeds.size > 0, 'the emu feed connected');
    const signals = async () => {
        await send({ t: 'sig', mode: 'manual', v: { rpm: PHOTO.rpm, speed: PHOTO.speed, oil: PHOTO.oil, coolant: PHOTO.coolant, gear: 'P', torque: 0, gLat: 0, gLong: 0 } });
        feed({ iface: 'de.bmw.infotainment.drivingexcitement.FES', field: 'statusFESVehicleDynamicSwitchHMI', value: { actualValueModeDrivingExperience: 2 } });
        feed({ iface: 'de.bmw.infotainment.KombiIF', field: 'statusRangeTankStatus', value: { fluidLevelFuelTank: PHOTO.fuelL, range: PHOTO.rangeKm } });
        feed({ iface: 'de.bmw.infrastructure.EnvironmentalInformation', field: 'ExteriorTemperature', value: { temperatureExterior: PHOTO.ambientRaw } });
    };
    await signals();
    await wait(1500);
    await set('whenToShow', 'always');
    await set('coverOn', true);
    let shown = false;
    for (const end = Date.now() + 15000; Date.now() < end && !shown; await wait(200)) shown = (await appLog()).some((l) => /^cover: shown /.test(l));
    check(shown, 'the cover builds and shows');
    await signals();                     // again: the boxes redraw on the next tick with every value in
    await wait(2500);
    const recs = fs.readFileSync(CR_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const comp = await createCompositor(browser), t = Date.now(), st = createReplay(recs, path.dirname(CR_LOG)).at(t);
    const on = await comp.render(st, t), off = await comp.render(st, t, { anims: false });
    fs.writeFileSync(path.join(OUT, 'oem-cover.png'), on.png);
    fs.writeFileSync(path.join(OUT, 'oem-cover-noanims.png'), off.png);
    check(on.lit > 0.25 * 1920 * 720 && !on.errors.length, 'cover drawn (' + on.lit + ' lit px)');
    check(off.lit > 0.25 * 1920 * 720 && !off.errors.length, 'cover drawn with animations off (' + off.lit + ' lit px)');
    const bad = (await appLog()).filter((l) => /STOPPED|error in /.test(l));
    check(bad.length === 0, 'no "error in" / STOPPED lines in the app log' + (bad.length ? ': ' + bad.slice(0, 3).join(' / ') : ''));
} catch (e) {
    check(false, 'car photo state threw: ' + (e && e.stack || e));
} finally {
    fs.writeFileSync(path.join(OUT, 'raw', 'app.log'), (await appLog().catch(() => [])).join('\n') + '\n');
    await browser.close();
    feedSrv.close();
    console.log(failures.length ? failures.length + ' FAILED' : 'all checks passed');
    process.exit(failures.length ? 1 : 0);
}
