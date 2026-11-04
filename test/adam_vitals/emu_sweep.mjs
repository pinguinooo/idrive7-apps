// Engine Vitals in the idrive7-apps emulator (test/adam_vitals/emu-run.sh runs it): cold start -> warm-up takeover
// -> Hide -> warm, a start-stop stop, the setting, hard driving -> Cool down (drive, idle, done), every page in
// demo data, the Settings tab, metric and car units, a corrupt settings.json, the DISABLE file.
// Signals and settings go through a second WebSocket the page opens to /ws; checks read the app's log lines.
// env: PORT, DATA_DIR, OUT, APP_DIR. Output: OUT/*.png, OUT/raw (video, log). Exit 1 on any failed check.
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT || '/home/claudius/.local/node/lib/node_modules/playwright/index.mjs');
const PORT = Number(process.env.PORT || 8079), DATA_DIR = process.env.DATA_DIR, OUT = process.env.OUT, APP_DIR = process.env.APP_DIR;
for (const [k, v] of Object.entries({ DATA_DIR, OUT, APP_DIR })) if (!v) { console.error('missing env ' + k); process.exit(2); }
const RAW = path.join(OUT, 'raw');
fs.mkdirSync(RAW, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures.push(what); };

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir: RAW, size: { width: 1600, height: 900 } } });
const t0 = Date.now();
const page = await context.newPage();
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
const logs = async (since) => (await page.evaluate(() => window.__sw.log)).filter((l) => l[0] >= (since || 0)).map((l) => l[2]);
const status = () => page.evaluate(() => window.__sw.status);
const send = (m) => page.evaluate((x) => window.__sw.ws.send(JSON.stringify(x)), m);
async function untilRunning(after, ms) {
    for (const end = Date.now() + (ms || 90000); Date.now() < end; await wait(200)) {
        const s = (await status()).filter((x) => x[0] >= after);
        if (s.length && s[s.length - 1][1] === 'running' && (after === 0 || s.some((x) => x[1] !== 'running'))) return;
    }
    throw new Error('the emulator did not get to running');
}
async function untilLog(re, since, ms) {
    for (const end = Date.now() + (ms || 5000); Date.now() < end; await wait(150)) if ((await logs(since)).some((l) => re.test(l))) return true;
    return false;
}
await untilRunning(0);
await wait(2000);

let sigV = { rpm: 800, speed: 0, oil: 15, coolant: 20, gear: 'P', torque: 30, gLat: 0, gLong: 0 };
const sig = async (v) => { sigV = Object.assign({}, sigV, v); await send({ t: 'sig', mode: 'manual', v: sigV }); };
const set = (k, v) => send({ t: 'set', k, v });
const stage = page.locator('#stage');
const marks = {};
const shot = async (name) => { await wait(800); marks[name] = (Date.now() - t0) / 1000; await stage.screenshot({ path: path.join(OUT, name + '.png') }); };
const quiet = async (since, what) => {
    const l = await logs(since), bad = l.filter((x) => /error in |STOPPED/.test(x));
    check(bad.length === 0, what + ': no "error in" / STOPPED lines' + (bad.length ? ' (' + bad.slice(0, 3).join(' / ') + ')' : ''));
};

// 1. cold start
console.log('step 1 cold start');
let s0 = Date.now();
await set('page', 'main');
await sig({});
check(await untilLog(/warm-up view shown/, 0, 8000), '1 cold start: warm-up view shown');
marks.coldStart = (Date.now() - t0) / 1000;
await shot('01-takeover-cold');
await quiet(0, '1');

// 2. Hide: a touch on the button (screen px, full layout: x = 70 + 1444 * 1.165, y = 51 + 100 * 1.165), else the bar click
console.log('step 2 hide');
s0 = Date.now();
for (const ph of [1, 3]) await send({ t: 'touch', phase: ph, x: 1752, y: 168 });
let how = 'touch on the page button';
if (!(await untilLog(/hidden: dismissed/, s0, 2500))) { how = 'click BTN_HIDE_WARMUP (touch missed)'; await send({ t: 'click', id: 'BTN_HIDE_WARMUP' }); }
check(await untilLog(/hidden: dismissed/, s0, 3000), '2 Hide: hidden: dismissed (' + how + ')');
await shot('02-main-dismissed-cold');

// 3. warm up over 45 s while driving gently
console.log('step 3 warm up');
s0 = Date.now();
for (let i = 0; i <= 45; i++) {
    const f = i / 45;
    await sig({ oil: Math.round(15 + 80 * f), coolant: Math.round(20 + 70 * f), gear: 'D2', rpm: 1500 + Math.round(700 * Math.sin(i / 3) ** 2), speed: 30, torque: 80 });
    await wait(1000);
}
marks.warm = (Date.now() - t0) / 1000;
check(!(await logs(s0)).some((l) => /warm-up view shown/.test(l)), '3 warming up: the view does not come back');
await quiet(s0, '3');

// 4. start-stop: engine off 15 s, then running with oil 30
console.log('step 4 start-stop');
s0 = Date.now();
await sig({ rpm: 0, speed: 0, gear: 'D1' }); await wait(15000);
await sig({ rpm: 800, oil: 30, coolant: 40 }); await wait(2000);
check(!(await logs(s0)).some((l) => /warm-up view shown/.test(l)), '4 start-stop: no warm-up view');

// 5. the setting off and on
console.log('step 5 setting');
s0 = Date.now();
await set('showWarmup', false);
check(await untilLog(/hidden: setting off/, s0, 3000), '5 setting off logged');
await set('showWarmup', true);
check(await untilLog(/hidden: (warm|dismissed) \(was setting off\)/, s0, 3000), '5 setting back on logged');
await quiet(s0, '5');

// 6. warm, hard driving 20 s
console.log('step 6 hard');
s0 = Date.now();
await sig({ oil: 95, coolant: 90, rpm: 5500, torque: 450, speed: 100, gear: 'D4' });
await set('page', 'cooldown');
await wait(20000);
await shot('06-cooldown-hard');
// 7. gentle driving
console.log('step 7 gentle');
await sig({ rpm: 1500, torque: 60, speed: 25, gear: 'D3' });
const l7 = Date.now();
check(await untilLog(/cool-down: drive \(needs (9\d|1\d\d) s/, l7, 3000), '7 gentle after 20 s hard: cool-down drive, needs >= 90 s');
await wait(4000);
await shot('07-cooldown-drive');
// 8. stopped, idling until done
console.log('step 8 idle');
await sig({ speed: 0, gear: 'P', rpm: 750, torque: 20 });
check(await untilLog(/cool-down: idle/, l7, 3000), '8 stopped: cool-down idle');
await wait(3000);
await shot('08-cooldown-idle');
check(await untilLog(/cool-down: done/, l7, 120000), '8 idling: cool-down done');
await shot('09-cooldown-ok');
await quiet(s0, '6-8');

// 9. demo data, every page, Settings
console.log('step 9 demo pages');
s0 = Date.now();
await send({ t: 'sig', mode: 'demo' });
await wait(1500);
const pages = [['main', '10-main-demo'], ['thermal', '11-thermals'], ['fuel', '12-fuel'], ['chassis', '13-chassis'], ['warmup', '14-warmup'], ['cooldown', '15-cooldown']];
for (const [p, name] of pages) { await set('page', p); await shot(name); }
await set('page', 'main');
await send({ t: 'click', id: 'BTN_SETTINGS' });
await shot('16-settings');
await send({ t: 'click', id: 'BTN_SETTINGS' });
await wait(800);
// 10. units
console.log('step 10 units');
await set('units', 'metric'); await shot('17-main-metric');
await set('units', 'car'); await shot('18-main-car');
await set('units', 'us');
await quiet(s0, '9-10');

// 11. a corrupt settings.json, then a restart
console.log('step 11 corrupt settings');
await wait(2000);                                     // the app saves settings.json on every set
const sf = path.join(DATA_DIR, 'settings.json');
const saved = JSON.parse(fs.readFileSync(sf, 'utf8'));
fs.writeFileSync(sf, JSON.stringify(Object.assign(saved, { units: 'xyz', warmOil: 999 })));
s0 = Date.now();
await send({ t: 'restart' });
await untilRunning(s0, 120000);
check(await untilLog(/settings: bad saved units/, s0, 15000) && await untilLog(/settings: bad saved warmOil/, s0, 2000), '11 bad saved settings logged');
await wait(6000);                                     // demo Auto starts 5 s on with no car
await shot('19-corrupt-settings');
const after = JSON.parse(fs.readFileSync(sf, 'utf8'));
check(after.units === 'us' && after.warmOil === 80, '11 settings.json fixed: units ' + after.units + ', warmOil ' + after.warmOil);
await quiet(s0, '11');

// 12. the DISABLE file
console.log('step 12 DISABLE');
s0 = Date.now();
await set('page', 'main');
fs.writeFileSync(path.join(DATA_DIR, 'DISABLE'), '');
check(await untilLog(/kill file found/, s0, 3500), '12 DISABLE: kill file found within 3 s');
await send({ t: 'click', id: 'BTN_HIDE_WARMUP' });
await shot('20-disable');
await quiet(0, 'whole run');

const all = await logs(0);
fs.writeFileSync(path.join(RAW, 'app.log'), all.join('\n') + '\n');
fs.writeFileSync(path.join(RAW, 'marks.json'), JSON.stringify(marks, null, 1));
await context.close();
await browser.close();
console.log(failures.length ? failures.length + ' FAILED' : 'SWEEP OK');
process.exit(failures.length ? 1 : 0);
