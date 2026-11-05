// The Safety page's test pattern in the idrive7-apps emulator (SCRIPT=emu_ladder.mjs test/adam_mtrack/emu-run.sh runs it):
// the Safety tab with the ladder row; a step pressed while the cover is on is refused and says why; steps 1, 2, 4 and 5
// with the cover off and parked each draw on their own client (adam_mtrack-test), are drawn as the service would
// (composite.mjs: step 1's amber bar and its blue dead-man bar, the tint, the tachs, the whole cover), are removed
// after 10 s and confirmed released by the watcher; another app on the HUD (a client of this script's own, named
// adam_shiftlights) makes a step refuse and names it, and keeps the cover off with "Another app is using the cluster".
// A step is pressed through the app's emu feed ({"action": "test:N"}, the same act as the page's pill; the pill press
// itself is in test/adam_mtrack/main_flow.test.js). env: PORT, CR_LOG, FEED, CTL, DATA_DIR, OUT. Exit 1 on a failed check.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createReplay, createCompositor, launch } from './composite.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { ClusterRender } = require(path.join(here, '../../apps/adam_mtrack/cluster_render_client.js'));
const { PORT, CR_LOG, FEED, CTL, DATA_DIR, OUT } = process.env;
for (const [k, v] of Object.entries({ PORT, CR_LOG, FEED, CTL, DATA_DIR, OUT })) if (!v) { console.error('missing env ' + k); process.exit(2); }
const SOCK = CTL.replace(/\.ctl$/, ''), RAW = path.join(OUT, 'raw');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [], results = {};
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures.push(what); return ok; };

/* the app's emu feed, and the fake service's log read as it grows */
const feeds = new Set();
const feedSrv = net.createServer((c) => { feeds.add(c); c.on('close', () => feeds.delete(c)); c.on('error', () => {}); });
try { fs.unlinkSync(FEED); } catch (e) { /* none */ }
feedSrv.listen(FEED);
const feed = (o) => feeds.forEach((c) => c.write(JSON.stringify(o) + '\n'));
const action = (a) => feed({ action: a });
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
const appOf = (conn) => { const h = recs.filter((m) => m.conn === conn && m.op === 'hello')[0]; return h ? h.app : ''; };
const conns = (app) => { tail(); return recs.filter((m) => m.ev === 'connect' && appOf(m.conn) === app).map((m) => m.conn); };
const of = (conn, pred) => { tail(); return recs.filter((m) => m.conn === conn && pred(m)); };
const closed = (conn) => of(conn, (m) => m.ev === 'close').length > 0;
async function until(fn, ms, what) {
    for (const end = Date.now() + ms; Date.now() < end; await wait(50)) if (fn()) return true;
    console.log('  (timed out: ' + what + ')');
    return false;
}

/* the emulator page */
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
const appLog = async (t) => (await page.evaluate(() => window.__sw.log)).filter((l) => l[0] >= (t || 0)).map((l) => String(l[2]));
const send = (m) => page.evaluate((x) => window.__sw.ws.send(JSON.stringify(x)), m);
for (const end = Date.now() + 90000; Date.now() < end; await wait(200)) {
    const s = await page.evaluate(() => window.__sw.status);
    if (s.length && s[s.length - 1][1] === 'running') break;
}
await wait(2500);
const sig = (v) => send({ t: 'sig', mode: 'manual', v: Object.assign({ rpm: 800, speed: 0, oil: 92, coolant: 90, gear: 'P', torque: 30, gLat: 0, gLong: 0 }, v) });
const set = async (k, v) => { await send({ t: 'set', k, v }); await wait(300); };
const comp = await createCompositor(browser);
const stage = page.locator('#stage');
const uiShot = async (name) => { await wait(900); await stage.screenshot({ path: path.join(OUT, name + '.png') }); };
const key = async (k, n) => { for (let i = 0; i < (n || 1); i++) { await page.keyboard.press(k); await wait(180); } };
const tab = async (i) => { await page.focus('#stage'); await key('[', 6); await key('Enter'); if (i) { await key(']', i); await key('Enter'); } await wait(500); };
async function shot(name) {
    tail();
    const t = Date.now(), r = await comp.render(createReplay(recs.slice(), path.dirname(CR_LOG)).at(t), t);
    fs.writeFileSync(path.join(OUT, name + '.png'), r.png);
    if (r.errors.length) check(false, name + ': shader errors ' + r.errors.join(' | '));
    return r;
}
/** Lit pixels of the composite inside a rect (via the compositor page's own canvas). */
const litIn = (x, y, w, h) => comp.page.evaluate((b) => {
    const gl = window.__cr.gl, px = new Uint8Array(b.w * b.h * 4);
    gl.readPixels(b.x, 720 - b.y - b.h, b.w, b.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 60) n++;
    return n;
}, { x, y, w, h });

/** Presses step n and follows it: its client, layers, a composite and a Safety shot while shown, removal, release. */
async function step(n, name, expectLayers, probe) {
    console.log('step ' + n + ' ' + name);
    const before = conns('adam_mtrack-test').length, t0 = Date.now();
    action('test:' + n);
    const up = await until(() => conns('adam_mtrack-test').length > before && of(conns('adam_mtrack-test')[before], (m) => m.op === 'layer').length >= expectLayers, 8000, 'step ' + n + ' layers');
    check(up, n + ' ' + name + ': ' + expectLayers + ' layer(s) on its own client adam_mtrack-test');
    if (!up) return null;
    const conn = conns('adam_mtrack-test')[before];
    await wait(1800);
    const r = await shot('mtrack-ladder-step' + n + '-panel');
    if (probe) await probe(r);                       // reads the compositor's canvas while it still holds this step
    await uiShot('mtrack-ladder-step' + n + '-safety');
    const gone = await until(() => closed(conn), 13000, 'step ' + n + ' removed');
    const shownAt = of(conn, (m) => m.op === 'layer')[0].t, closeAt = of(conn, (m) => m.ev === 'close')[0];
    results['step' + n + 'ShownMs'] = closeAt ? closeAt.t - shownAt : null;
    check(gone && closeAt.t - shownAt >= 9500 && closeAt.t - shownAt <= 11500, n + ' removed by itself after ' + (closeAt ? closeAt.t - shownAt : '?') + ' ms (10 s)');
    let rel = false;
    for (const end = Date.now() + 9000; Date.now() < end && !rel; await wait(200)) rel = (await appLog(t0)).some((l) => l.indexOf('release confirmed (test step ' + n + ')') === 0);
    check(rel, n + ' release confirmed by the watcher (panel idle, no layer of ours in the status)');
    const after = await shot('mtrack-ladder-step' + n + '-after');
    check(after.layers === 0, n + ' after it the panel draws nothing of ours');
    await uiShot('mtrack-ladder-step' + n + '-done');
    return r;
}

try {
    await sig({});
    feed({ iface: 'de.bmw.infotainment.checkcontrol.CheckControlMaster', field: 'basicList', value: [] });
    feed({ iface: 'de.bmw.infotainment.drivingexcitement.FES', field: 'statusFESVehicleDynamicSwitchHMI', value: { actualValueModeDrivingExperience: 4 } });
    await tab(3);
    await uiShot('mtrack-ladder-safety-idle');
    check((await appLog()).some((l) => /^diagnostic log: .*mtrack-diag\.log$/.test(l)), 'the app names its diagnostic log');

    console.log('refused while the cover is on');
    await set('coverOn', true);
    let t = Date.now();
    action('test:1');
    await wait(800);
    check((await appLog(t)).indexOf('test: step 1 BAR refused: turn Cover the cluster off first') >= 0, 'a step with the cover on is refused and says why');
    check(!conns('adam_mtrack-test').length, 'nothing drawn for a refused step');
    await uiShot('mtrack-ladder-refused-cover-on');
    await set('coverOn', false);
    await wait(500);

    let r = await step(1, 'BAR', 2, async () => {
        const amber = await litIn(690, 236, 260, 44), blue = await litIn(970, 236, 260, 44), mid = await litIn(400, 400, 200, 100);
        results.step1 = { amber, blue, mid };
        check(amber > 260 * 44 * 0.9 && blue > 260 * 44 * 0.9 && mid === 0, '1 the amber bar and the blue dead-man bar drawn, nothing else (' + amber + ', ' + blue + ', ' + mid + ')');
    });
    r = await step(2, 'TINT', 1);
    if (r) { results.step2Lit = r.lit; check(r.lit > 1920 * 720 * 0.9, '2 the tint covers the whole panel (' + r.lit + ' lit px)'); }
    r = await step(4, 'TACHS', 1);
    if (r) { results.step4Lit = r.lit; check(r.lit > 20000, '4 the tachs drawn (' + r.lit + ' lit px)'); }
    r = await step(5, 'COVER', 8);
    if (r) { results.step5Lit = r.lit; check(r.lit > 0.25 * 1920 * 720, '5 the whole cover drawn (' + r.lit + ' lit px)'); }
    const lg = await appLog();
    check(lg.some((l) => /^test: upload at arm: 4287608 bytes \(us, 10 assets\)$/.test(l)) && lg.some((l) => /^test: upload at arm: 2398392 bytes \(us, 4 assets\)$/.test(l)), 'steps 4 and 5 upload 2.4 MB and 4.3 MB');

    console.log('another app on the HUD');
    const other = new ClusterRender('adam_shiftlights', SOCK);
    other.on('ready', () => other.effect({ target: 'hud', klass: 'overlay', x: 100, y: 200, w: 600, h: 60, fs: 'precision mediump float; void main() { gl_FragColor = vec4(1.0, 0.6, 0.0, 1.0); }' }));
    other.connect();
    await wait(1200);
    t = Date.now();
    action('test:1');
    await wait(1500);
    check((await appLog(t)).some((l) => /^test: step 1 BAR refused: another app is using the cluster \(adam_shiftlights on hud\)/.test(l)), 'a step while another app holds the HUD is refused and names it');
    await uiShot('mtrack-ladder-refused-another-app');
    t = Date.now();
    feed({ iface: 'de.bmw.infotainment.drivingexcitement.FES', field: 'statusFESVehicleDynamicSwitchHMI', value: { actualValueModeDrivingExperience: 2 } });
    await set('coverOn', true);
    await wait(2500);
    check(!conns('adam_mtrack').some((c) => of(c, (m) => m.op === 'layer' && m.t >= t).length), 'the cover makes no layer while another app holds the HUD');
    check((await appLog(t)).some((l) => /^why off: Another app is using the cluster: turn off Shift Lights cluster\/HUD$/.test(l)), 'the cover says another app is using the cluster');
    await uiShot('mtrack-busy-safety');
    await tab(0);
    await uiShot('mtrack-busy-home');
    other.close();
    const back = await until(() => conns('adam_mtrack').some((c) => of(c, (m) => m.op === 'layer' && m.t >= t).length >= 8), 8000, 'the cover after the HUD let go');
    check(back, 'the cover shows once the other app lets go of the HUD');
    await set('coverOn', false);
    await wait(500);
} finally {
    fs.writeFileSync(path.join(RAW, 'app.log'), (await appLog().catch(() => [])).join('\n') + '\n');
    try { fs.copyFileSync(path.join(DATA_DIR, 'mtrack-diag.log'), path.join(RAW, 'mtrack-diag.log')); } catch (e) { /* none */ }
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, failures }, null, 1));
    await browser.close();
    feedSrv.close();
    console.log(failures.length ? failures.length + ' FAILED' : 'all checks passed');
    process.exit(failures.length ? 1 : 0);
}
