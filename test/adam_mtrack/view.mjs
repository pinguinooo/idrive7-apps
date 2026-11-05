// The live cluster emulator view (test/adam_mtrack/view.sh starts it): the idrive7-apps emulator runs M Track
// (centre screen at http://localhost:EMU_PORT), its cluster-render client talks to a fake service inside this process,
// and http://localhost:VIEW_PORT draws the panel from that service's state in the browser's WebGL (crstate.mjs +
// crdraw.js, the same renderer stand-in the sweep uses), with buttons that drive the car (rpm, speed, drive mode)
// and the guards (speed loss, a Check Control popup, BMW taking the panel, the kill file), the Safety page's BMW popups
// choice, and the app's own "why off" log line under the panel.
// env: EMU_DIR (idrive7-apps clone with apps/adam_mtrack linked), EMU_PORT (8077), VIEW_PORT (8090), NODE_EMU (node for emu.js),
// NO_POPUPS=1: a car that sends no Check Control signal at all (Adam's G01 in the 0.1.0 test): the list is never fed.
// CR_ANIMS=off: a renderer that plays no animation (what Adam's KOMBI did to 0.1.1's dead-man): uniforms keep the client's value.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createState, apply, layersAt, assetsOf } from './crstate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { createFake } = require(path.join(here, 'fake_cluster_render.js'));
const EMU_DIR = process.env.EMU_DIR, EMU_PORT = Number(process.env.EMU_PORT || 8077), VIEW_PORT = Number(process.env.VIEW_PORT || 8090);
if (!EMU_DIR) { console.error('set EMU_DIR'); process.exit(2); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mtrack-view-'));
const SOCK = path.join(tmp, 'cr.sock'), FEED = path.join(tmp, 'feed.sock'), FRAMES = path.join(tmp, 'frames');
const DATA_DIR = path.join(EMU_DIR, 'preview', 'emu', 'adam_mtrack');
fs.mkdirSync(FRAMES);

/* the fake service, its state kept live */
const S = createState();
const fake = createFake(SOCK, (m) => { try { apply(S, m, (r) => (r.file ? fs.readFileSync(path.join(tmp, r.file)) : null)); if (r0(m)) fs.unlinkSync(path.join(tmp, m.file)); } catch (e) { /* keep serving */ } }, FRAMES);
const r0 = (m) => m.op === 'frame' && m.file;

/* the app's emu feed */
const feeds = new Set();
net.createServer((c) => { feeds.add(c); c.on('close', () => feeds.delete(c)); c.on('error', () => {}); }).listen(FEED);
const feed = (o) => feeds.forEach((c) => c.write(JSON.stringify(o) + '\n'));
const FES = 'de.bmw.infotainment.drivingexcitement.FES', CCM = 'de.bmw.infotainment.checkcontrol.CheckControlMaster';

/* the emulator */
const emu = spawn(process.env.NODE_EMU || process.execPath, ['kit/tools/emu.js', 'adam_mtrack', '--port', String(EMU_PORT)], {
    cwd: EMU_DIR, env: Object.assign({}, process.env, { MTRACK_CR_SOCKET: SOCK, MTRACK_EMU_FEED: FEED }), stdio: ['ignore', 'pipe', 'pipe'],
});
const emuLog = [];
const keepLog = (d) => { emuLog.push(d.toString()); if (emuLog.length > 200) emuLog.shift(); };
emu.stdout.on('data', keepLog); emu.stderr.on('data', keepLog);
let ws = null, sigV = { rpm: 800, speed: 0, oil: 92, coolant: 90, gear: 'P', torque: 40, gLat: 0, gLong: 0 }, pullTimer = null;
const NO_POPUPS = process.env.NO_POPUPS === '1', appLines = [];
function wsSend(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
function connectWs() {
    try { ws = new WebSocket('ws://127.0.0.1:' + EMU_PORT + '/ws'); } catch (e) { setTimeout(connectWs, 1000); return; }
    // the app's log: keep the cover's own lines (why it is off, shown / dropped, the popup signal) for the page
    ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return;
        try {
            const m = JSON.parse(e.data);
            if (m.t === 'log') m.lines.forEach((l) => { const s = String(l[1]); if (/^(why off: |cover: |BMW popup signal)/.test(s)) { appLines.push(s); if (appLines.length > 6) appLines.shift(); } });
            else if ((m.t === 'settings' || m.t === 'spec') && m.values && typeof m.values.popupGuard === 'string') state.popupGuard = m.values.popupGuard;
        } catch (x) { /* not ours */ }
    };
    ws.onopen = () => { wsSend({ t: 'sig', mode: 'manual', v: sigV }); start(); };
    ws.onclose = () => { ws = null; setTimeout(connectWs, 1000); };
    ws.onerror = () => {};
}
setTimeout(connectWs, 1500);
let started = false;
function start() {
    if (started) return;
    started = true;
    // a car in Sport+, no Check Control message (NO_POPUPS: no Check Control signal at all), tyres, fuel, outside temperature
    // (the emulator sends none of these)
    setTimeout(() => {
        if (!NO_POPUPS) feed({ iface: CCM, field: 'basicList', value: [] });
        feed({ iface: FES, field: 'statusFESVehicleDynamicSwitchHMI', value: { actualValueModeDrivingExperience: 2 } });
        feed({ iface: 'de.bmw.infotainment.vehicle.TPMS', field: 'statusTyrePressure', value: { actualValuePressureTyreFLH: 23, actualValuePressureTyreFRH: 23, actualValuePressureTyreRLH: 24, actualValuePressureTyreRRH: 24 } });
        feed({ iface: 'de.bmw.infotainment.vehicle.TPMS', field: 'statusTyreTemperature', value: { actualValueTemperatureTyreFLH: 54, actualValueTemperatureTyreFRH: 55, actualValueTemperatureTyreRLH: 53, actualValueTemperatureTyreRRH: 54 } });
        feed({ iface: 'de.bmw.infotainment.KombiIF', field: 'statusRangeTankStatus', value: { fluidLevelFuelTank: 41, range: 512 } });
        feed({ iface: 'de.bmw.infrastructure.EnvironmentalInformation', field: 'ExteriorTemperature', value: { temperatureExterior: 120 } });
        feed({ iface: FES, field: 'statusSwitchDriveDynamicSport2', value: { displayBoostPressure: 20 } });
        wsSend({ t: 'set', k: 'coverOn', v: true });
    }, 2500);
}
const state = { mode: 'sportplus', speedLost: false, popup: false, bmw: false, kill: false, noPopups: NO_POPUPS, popupGuard: 'auto' };
function sig(v) { sigV = Object.assign({}, sigV, v); wsSend({ t: 'sig', mode: 'manual', v: sigV }); }
function act(a, v) {
    if (pullTimer && (a === 'pull' || a === 'idle' || a === 'rpm')) { clearInterval(pullTimer); pullTimer = null; }
    if (a === 'idle') sig({ rpm: 800, speed: 0, gear: 'P', gLong: 0 });
    else if (a === 'pull') {
        let i = 0;
        pullTimer = setInterval(() => {
            const f = i / 62;
            sig({ rpm: 800 + 100 * i, speed: Math.round(96.56 * f), gear: f < 0.35 ? 'D1' : f < 0.7 ? 'D2' : 'D3', torque: 300 + 200 * f, gLong: 0.4 });
            feed({ iface: FES, field: 'statusSwitchDriveDynamicSport2', value: { displayBoostPressure: Math.round(20 + 90 * f) } });
            if (++i > 62) { clearInterval(pullTimer); pullTimer = null; }
        }, 100);
    } else if (a === 'rpm') sig({ rpm: Number(v) || 0, gear: sigV.gear === 'P' ? 'D3' : sigV.gear });
    else if (a === 'speed') sig({ speed: Number(v) || 0, gear: sigV.gear === 'P' ? 'D3' : sigV.gear });
    else if (a === 'mode') { state.mode = v; feed({ iface: FES, field: 'statusFESVehicleDynamicSwitchHMI', value: { actualValueModeDrivingExperience: { comfort: 4, sport: 1, sportplus: 2 }[v] } }); }
    else if (a === 'speedloss') { state.speedLost = !state.speedLost; feed({ block: 'speed', on: state.speedLost }); }
    else if (a === 'popup') { if (NO_POPUPS) return; state.popup = !state.popup; feed({ iface: CCM, field: 'basicList', value: [{ ccmId: 1, activeState: state.popup ? 'AKTIV' : 'INAKTIV' }] }); }
    else if (a === 'popupGuard') { if (['auto', 'require', 'ignore'].indexOf(v) < 0) return; state.popupGuard = v; wsSend({ t: 'set', k: 'popupGuard', v }); }
    else if (a === 'bmw') { state.bmw = !state.bmw; fake.target('panel', state.bmw ? 'waiting' : 'shown', state.bmw ? 'stock' : ''); }
    else if (a === 'kill') {
        state.kill = !state.kill;
        const f = path.join(DATA_DIR, 'DISABLE');
        if (state.kill) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(f, ''); } else { try { fs.unlinkSync(f); } catch (e) { /* gone */ } }
    } else if (a === 'set') wsSend({ t: 'set', k: v.k, v: v.v });
}

/* the page */
const files = { '/': ['view.html', 'text/html'], '/crdraw.js': ['crdraw.js', 'text/javascript'] };
const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    try {
        if (files[u.pathname]) { res.writeHead(200, { 'content-type': files[u.pathname][1], 'cache-control': 'no-store' }); res.end(fs.readFileSync(path.join(here, files[u.pathname][0]))); return; }
        if (u.pathname === '/state') {
            const list = layersAt(S, Date.now(), 'panel', { anims: process.env.CR_ANIMS !== 'off' }), assets = {};
            assetsOf(list).forEach((k) => { const a = S.assets.get(k); if (a && a.version) assets[k] = { v: a.version, format: a.format, w: a.w, h: a.h, sampling: a.sampling }; });
            res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ list, assets, state, sig: sigV, emuPort: EMU_PORT, appLog: appLines.slice(-3) }));
            return;
        }
        if (u.pathname === '/asset') {
            const a = S.assets.get(u.searchParams.get('k'));
            if (!a) { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-version': String(a.version), 'cache-control': 'no-store' });
            res.end(a.data);
            return;
        }
        if (u.pathname === '/act' && req.method === 'POST') {
            let b = '';
            req.on('data', (d) => { b += d; });
            req.on('end', () => { try { const m = JSON.parse(b); act(m.a, m.v); res.writeHead(204); } catch (e) { res.writeHead(400); } res.end(); });
            return;
        }
        if (u.pathname === '/log') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(emuLog.join('')); return; }
        res.writeHead(404); res.end();
    } catch (e) { res.writeHead(500); res.end(String(e)); }
});
server.listen(VIEW_PORT, '127.0.0.1', () => console.log('open http://localhost:' + VIEW_PORT + '  (centre screen: http://localhost:' + EMU_PORT + ')'));

let done = false;
function stop() {
    if (done) return;
    done = true;
    if (pullTimer) clearInterval(pullTimer);
    try { emu.kill('SIGTERM'); } catch (e) { /* gone */ }
    setTimeout(() => { try { emu.kill('SIGKILL'); } catch (e) { /* gone */ } }, 800).unref();
    server.close(); fake.close(() => {});
    try { fs.unlinkSync(path.join(DATA_DIR, 'DISABLE')); } catch (e) { /* none */ }
    setTimeout(() => { fs.rmSync(tmp, { recursive: true, force: true }); process.exit(0); }, 1000);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
emu.on('exit', (c) => { if (!done) { console.error('the emulator stopped (' + c + '):\n' + emuLog.slice(-20).join('')); stop(); } });
