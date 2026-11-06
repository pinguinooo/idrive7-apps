// M Track 0.1.4 as an update from 0.1.3 (test/adam_mtrack/emu-run.sh with SCRIPT=emu_update.mjs SEED_SETTINGS=
// test/adam_mtrack/settings-0.1.3.json): settings.json is the one 0.1.3 saved (every key, tyres on the left, no
// _reset_ marks). The kit's "reset": 1 must move the left panels to app.json's new defaults (coolant over oil) once, mark
// it, and keep a later choice (G-meter) across an app restart. Shots: the Panels page and the cover. Exit 1 on failure.
// env: PORT, CR_LOG, FEED, CTL, DATA_DIR, OUT (as emu_sweep.mjs).
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createReplay, createCompositor, launch } from './composite.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SPEC = JSON.parse(fs.readFileSync(path.join(here, '../../apps/adam_mtrack/app.json'), 'utf8'));
const def = (k) => SPEC.settings.filter((s) => s.key === k)[0].default;
const { PORT, CR_LOG, FEED, DATA_DIR, OUT } = process.env;
for (const [k, v] of Object.entries({ PORT, CR_LOG, FEED, DATA_DIR, OUT })) if (!v) { console.error('missing env ' + k); process.exit(2); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures.push(what); return ok; };
const saved = () => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'settings.json'), 'utf8'));

// the app's emu feed connects to us (the drive mode)
const feeds = new Set();
const feedSrv = net.createServer((c) => { feeds.add(c); c.on('close', () => feeds.delete(c)); c.on('error', () => {}); });
try { fs.unlinkSync(FEED); } catch (e) { /* none */ }
feedSrv.listen(FEED);
const feed = (o) => feeds.forEach((c) => c.write(JSON.stringify(o) + '\n'));

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
const appLog = async () => (await page.evaluate(() => window.__sw.log)).map((l) => l[2]);
const send = (m) => page.evaluate((x) => window.__sw.ws.send(JSON.stringify(x)), m);
const set = async (k, v) => { await send({ t: 'set', k, v }); await wait(200); };
/** The app's 'started:' lines (one per start), each with its panels layout. */
const starts = async () => (await appLog()).filter((l) => /^started: /.test(l));
async function untilStarts(n, ms) {
    for (const end = Date.now() + ms; Date.now() < end; await wait(200)) if ((await starts()).length >= n) return true;
    return false;
}
const stage = page.locator('#stage');
const key = async (k, n) => { for (let i = 0; i < (n || 1); i++) { await page.keyboard.press(k); await wait(180); } };
const tab = async (i) => { await page.focus('#stage'); await key('[', 6); await key('Enter'); if (i) { await key(']', i); await key('Enter'); } await wait(500); };
const panelsOf = (line) => { const m = /panels (\{.*\})$/.exec(line || ''); return m ? JSON.parse(m[1]) : null; };

try {
    const OEM = { upper: def('leftPanel'), lower: def('leftLower') };
    check(OEM.upper === 'coolant' && OEM.lower === 'oil', 'app.json: the left defaults are coolant over oil');
    check(await untilStarts(1, 90000), 'the app started on 0.1.3\'s settings.json');
    let s = await starts();
    check(JSON.stringify(panelsOf(s[0]).left) === JSON.stringify(OEM), 'updated install: the left panel is coolant over oil (' + JSON.stringify(panelsOf(s[0])) + ')');
    const f = saved();
    check(f.leftPanel === 'coolant' && f.leftLower === 'oil' && f._reset_leftPanel === 1 && f._reset_leftLower === 1, 'settings.json: moved and marked once (' +
        JSON.stringify({ leftPanel: f.leftPanel, leftLower: f.leftLower, _reset_leftPanel: f._reset_leftPanel, _reset_leftLower: f._reset_leftLower }) + ')');
    check(f.rightPanel === 'torque' && f.rightLower === 'power' && f._settingsV === 2 && !('_reset_rightPanel' in f), 'settings.json: the rest kept as saved');

    // the car's signals first (the Panels page says "No signal on this car" for a widget whose signal never came)
    await send({ t: 'sig', mode: 'manual', v: { rpm: 700, speed: 0, oil: 92, coolant: 90, gear: 'P', torque: 30, gLat: 0, gLong: 0 } });
    feed({ iface: 'de.bmw.infotainment.drivingexcitement.FES', field: 'statusFESVehicleDynamicSwitchHMI', value: { actualValueModeDrivingExperience: 2 } });
    await wait(1500);
    await send({ t: 'ccu' });
    await wait(300);
    await tab(1);
    await wait(900);
    await stage.screenshot({ path: path.join(OUT, 'mtrack-update-panels-page.png') });

    // the cover as it now draws (Always, so no drive mode needed)
    const comp = await createCompositor(browser), recs = [];
    await set('whenToShow', 'always');
    await set('coverOn', true);
    let shown = false;
    for (const end = Date.now() + 12000; Date.now() < end && !shown; await wait(200)) shown = (await appLog()).some((l) => /^cover: shown /.test(l));
    check(shown, 'the cover builds and shows');
    await wait(1500);
    fs.readFileSync(CR_LOG, 'utf8').split('\n').filter(Boolean).forEach((l) => recs.push(JSON.parse(l)));
    const t = Date.now(), r = await comp.render(createReplay(recs, path.dirname(CR_LOG)).at(t), t);
    fs.writeFileSync(path.join(OUT, 'mtrack-update-cover.png'), r.png);
    check(r.lit > 0.25 * 1920 * 720 && !r.errors.length, 'cover drawn (' + r.lit + ' lit px)');
    await set('coverOn', false);

    // a later choice is kept: G-meter, then the app restarts (a save under apps/adam_mtrack rebuilds and restarts it)
    await set('leftPanel', 'gforce');
    await wait(1500);                         // the app saves settings.json on every set
    const n = (await starts()).length, cfgFile = path.join(here, '../../apps/adam_mtrack/config.js');
    fs.writeFileSync(cfgFile, fs.readFileSync(cfgFile));
    check(await untilStarts(n + 1, 120000), 'the app restarted');
    s = await starts();
    check(JSON.stringify(panelsOf(s[s.length - 1]).left) === JSON.stringify({ full: 'gforce' }), 'after the restart G-meter is kept (' + JSON.stringify(panelsOf(s[s.length - 1])) + ')');
    check(saved().leftPanel === 'gforce' && saved()._reset_leftPanel === 1, 'settings.json still G-meter, mark kept');
    const bad = (await appLog()).filter((l) => /STOPPED|error in (?!boost)/.test(l));
    check(bad.length === 0, 'no "error in" / STOPPED lines in the app log' + (bad.length ? ': ' + bad.slice(0, 3).join(' / ') : ''));
} catch (e) {
    check(false, 'update check threw: ' + (e && e.stack || e));
} finally {
    fs.writeFileSync(path.join(OUT, 'raw', 'app.log'), (await appLog().catch(() => [])).join('\n') + '\n');
    await browser.close();
    feedSrv.close();
    console.log(failures.length ? failures.length + ' FAILED' : 'all checks passed');
    process.exit(failures.length ? 1 : 0);
}
