'use strict';
/**
 * A stand-in for the cluster-render service (idrive-apps PROTOCOL.md): frames `u32 len | type | body`,
 * answers a client's hello as the iDrive 7 service does, answers each layer with `shown` (and its target
 * with a `target ... shown` event), and records
 * every J message and every F (image pixels) message. Node 8 or newer.
 *
 *   node test/fake_cluster_render.js <socket> <log.jsonl>    one JSON line per message: {t, conn, ...msg};
 *       an F message: {t, conn, op: 'frame', ref, rects, bytes, file}, its pixels in <log dir>/frames/<n>.bin
 *   SIGUSR1: close every connection and the server, listen again 1 s later (a service restart).
 *   require: createFake(socketPath, onMessage(rec), framesDir?, opts?) -> { restart(cb), close(cb), mode(m) }
 *
 * 0.4.4 the status read-back: an `op: 'status'` gets a status text in the shape of idrive-apps server.cpp status_text,
 * from the layers each connection holds. The mode (opts.mode, mode(m), or the file named by FAKE_CR_MODE_FILE / opts.modeFile,
 * read on every status) picks what the targets with our layers say:
 *   ok             shown (us); rendered: renderer ... subscribed for N s                (the default)
 *   unsubscribed   shown (us); renderer not subscribed for N ms
 *   unobservable   shown (us); renderer subscription not observable
 *   mtrack-on-panel  an adam_mtrack layer on panel, the hud target waiting (scene id in use), its target event waiting too
 *   guard-disabled   0.4.5, the car on 2026-11-09: cluster-render's mapping guard disabled the HUD after 2 strikes; the hud
 *                    target idle (no holder, no reason; its event idle too), our layers waiting - target idle, and the
 *                    'guard: hud 0x323 0x1000400 0: disabled, 2 strikes' line
 *   idle             the same with no guard line (the renderer never asks for the slot: hypothesis 2, Dcsm2 never settles)
 * Every mode's status carries a renderer line and both dcsm lines (Dcsm2 available since the server last listened).
 */
const path = require('path');
const fs = require('fs');
const net = require('net');

const HELLO = { ev: 'hello', proto: 1, backend: 'id7', targets: 'map:1088x480,panel:1920x720,hud:800x480' };

function frame(obj) {
    const body = Buffer.from(JSON.stringify(obj), 'utf8'), m = Buffer.alloc(5 + body.length);
    m.writeUInt32LE(body.length + 1, 0);
    m[4] = 0x4a;
    body.copy(m, 5);
    return m;
}

/** An F body: u32 ref, u64 id, u16 rect count, rects (u16 x, y, w, h), pixels. */
function decodeFrame(body) {
    const ref = body.readUInt32LE(0), n = body.readUInt16LE(12), rects = [];
    for (let i = 0; i < n; i++) {
        const o = 14 + i * 8;
        rects.push({ x: body.readUInt16LE(o), y: body.readUInt16LE(o + 2), w: body.readUInt16LE(o + 4), h: body.readUInt16LE(o + 6) });
    }
    return { ref, rects, pixels: body.slice(14 + n * 8) };
}

const TARGET_LINE = { map: 'slot 0x205 scene 0x1000300 1088x480', panel: 'slot 0x203 scene 0x1000400 1920x720', hud: 'slot 0x323 scene 0x1000400 800x480' };
const IDLE = ['guard-disabled', 'idle'];
/** The status text for one connection's layers ({ ref: { target, kind, at } }) in a mode; upAt: when Dcsm2 came up. */
function statusText(mode, held, now, upAt) {
    const lines = ['upload: cap 5500 KB/s (ceiling 5500, floor 2000): the ceiling'], refs = Object.keys(held);
    Object.keys(TARGET_LINE).forEach((name) => {
        const mine = refs.filter((r) => held[r].target === name);
        let state = mode === 'mtrack-on-panel' && name === 'panel' ? 'shown (us)' : 'idle';
        if (mine.length) {
            const since = Math.min.apply(null, mine.map((r) => held[r].at));
            if (mode === 'mtrack-on-panel' && name === 'hud') state = 'waiting scene id in use by another target';
            else if (IDLE.indexOf(mode) >= 0 && name === 'hud') state = 'idle';
            else if (mode === 'unsubscribed') state = 'shown (us); renderer not subscribed for ' + (now - since) + ' ms';
            else if (mode === 'unobservable') state = 'shown (us); renderer subscription not observable';
            else state = 'shown (us); rendered: renderer 00000000-0000-0000-0000-000000000001 subscribed for ' + Math.floor((now - since) / 1000) + ' s';
        }
        lines.push('target ' + name + ': ' + TARGET_LINE[name] + ': ' + state);
    });
    if (mode === 'guard-disabled') lines.push('guard: hud 0x323 0x1000400 0: disabled, 2 strikes');
    const up = Math.floor((now - (upAt === undefined ? now : upAt)) / 1000);
    lines.push('renderer: 12 subscription lines read since start', 'dcsm: Dcsm2 available for ' + up + ' s; subscription: slot table accepted',
        'dcsm: since start: 3 requests, 3 replies; last slot table ' + Math.min(up, 2) + ' s ago');
    if (mode === 'mtrack-on-panel') lines.push('layer 90 effect of adam_mtrack on panel, overlay z 900: shown');
    refs.forEach((r) => lines.push('layer ' + r + ' ' + held[r].kind + ' of adam_shiftlights on ' + held[r].target + ', overlay z 0: ' +
        (mode === 'mtrack-on-panel' && held[r].target === 'hud' ? 'waiting - target waiting' : IDLE.indexOf(mode) >= 0 && held[r].target === 'hud' ? 'waiting - target idle' : 'shown')));
    return lines.join('\n') + '\n';
}

function createFake(socketPath, onMessage, framesDir, opts) {
    let server = null, connId = 0, frameNo = 0, mode = (opts && opts.mode) || 'ok', upAt = Date.now();
    const modeFile = (opts && opts.modeFile) || process.env.FAKE_CR_MODE_FILE || '';
    const modeNow = () => { if (modeFile) { try { return fs.readFileSync(modeFile, 'utf8').trim() || mode; } catch (e) { /* none: the set mode */ } } return mode; };
    const conns = new Set();
    function listen(cb) {
        try { fs.unlinkSync(socketPath); } catch (e) { /* not there */ }
        upAt = Date.now();
        server = net.createServer((sock) => {
            const id = ++connId;
            let buf = Buffer.alloc(0);
            const held = {};
            conns.add(sock);
            onMessage({ t: Date.now(), conn: id, ev: 'connect' });
            sock.on('error', () => {});
            sock.on('close', () => { conns.delete(sock); onMessage({ t: Date.now(), conn: id, ev: 'close' }); });
            sock.on('data', (d) => {
                buf = Buffer.concat([buf, d]);
                while (buf.length >= 5) {
                    const len = buf.readUInt32LE(0);
                    if (buf.length < 4 + len) break;
                    const type = buf[4], body = buf.slice(5, 4 + len);
                    buf = buf.slice(4 + len);
                    if (type === 0x46) {
                        const f = decodeFrame(body), rec = { t: Date.now(), conn: id, op: 'frame', ref: f.ref, rects: f.rects, bytes: f.pixels.length };
                        if (framesDir) { rec.file = 'frames/' + (++frameNo) + '.bin'; fs.writeFileSync(path.join(framesDir, String(frameNo) + '.bin'), f.pixels); }
                        onMessage(rec);
                        continue;
                    }
                    if (type !== 0x4a) { onMessage({ t: Date.now(), conn: id, binary: type, bytes: body.length }); continue; }
                    let m;
                    try { m = JSON.parse(body.toString('utf8')); } catch (e) { onMessage({ t: Date.now(), conn: id, bad: body.toString('utf8') }); continue; }
                    onMessage(Object.assign({ t: Date.now(), conn: id }, m));
                    if (m.op === 'hello') sock.write(frame(HELLO));
                    else if (m.op === 'layer') {
                        held[m.ref] = { target: m.target, kind: m.kind || 'effect', at: Date.now() };
                        const md = modeNow(), wait = md === 'mtrack-on-panel' && m.target === 'hud', idle = IDLE.indexOf(md) >= 0 && m.target === 'hud';
                        sock.write(frame(wait ? { ev: 'target', target: m.target, state: 'waiting', reason: 'scene id in use by another target' }
                            : idle ? { ev: 'target', target: m.target, state: 'idle' } : { ev: 'target', target: m.target, state: 'shown' }));
                        sock.write(frame(idle ? { ev: 'layer', ref: m.ref, state: 'waiting', reason: 'target idle' } : { ev: 'layer', ref: m.ref, state: wait ? 'waiting' : 'shown' }));
                    } else if (m.op === 'drop') delete held[m.ref];
                    else if (m.op === 'status') sock.write(frame({ ev: 'status', text: statusText(modeNow(), held, Date.now(), upAt) }));
                }
            });
        });
        server.listen(socketPath, cb);
    }
    listen();
    return {
        restart(cb) {
            conns.forEach((s) => s.destroy());
            server.close(() => setTimeout(() => listen(cb), 1000));
        },
        close(cb) { conns.forEach((s) => s.destroy()); server.close(cb); },
        mode(m) { mode = m; },
    };
}

if (require.main === module) {
    const sock = process.argv[2], out = process.argv[3];
    if (!sock || !out) { console.error('usage: node test/fake_cluster_render.js <socket> <log.jsonl>'); process.exit(2); }
    const frames = path.join(path.dirname(out), 'frames');
    try { fs.mkdirSync(frames); } catch (e) { /* there */ }
    const fake = createFake(sock, (rec) => fs.appendFileSync(out, JSON.stringify(rec) + '\n'), frames);
    process.on('SIGUSR1', () => { fs.appendFileSync(out, JSON.stringify({ t: Date.now(), ev: 'restart' }) + '\n'); fake.restart(); });
    const bye = () => { fake.close(() => { try { fs.unlinkSync(sock); } catch (e) { /* gone */ } process.exit(0); }); setTimeout(() => process.exit(0), 500).unref(); };
    process.on('SIGTERM', bye);
    process.on('SIGINT', bye);
    console.log('fake cluster-render on ' + sock);
}

module.exports = { createFake, HELLO, decodeFrame, statusText };
