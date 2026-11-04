'use strict';
/**
 * A stand-in for the cluster-render service (idrive-apps PROTOCOL.md): frames `u32 len | type | body`,
 * answers a client's hello as the iDrive 7 service does, answers each layer with its target's state (`shown`
 * unless a control line said otherwise) and records every J message and every F (image or asset pixels) message.
 * Copy of test/adam_shiftlights/fake_cluster_render.js plus a control channel. Node 8 or newer.
 *
 *   node test/adam_mtrack/fake_cluster_render.js <socket> <log.jsonl>   one JSON line per message: {t, conn, ...msg};
 *       an F message: {t, conn, op: 'frame', ref, rects, bytes, file}, its pixels in <log dir>/frames/<n>.bin
 *   SIGUSR1: close every connection and the server, listen again 1 s later (a service restart).
 *   <socket>.ctl: a line {"target":"panel","state":"waiting","holder":"stock"} sends that target event to every
 *       connection (a BMW take-over); {"target":"panel","state":"shown"} gives it back. Logged as {ev: 'ctl'}.
 *   require: createFake(socketPath, onMessage(rec), framesDir?) -> { restart(cb), close(cb), target(name, state, holder) }
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

function createFake(socketPath, onMessage, framesDir) {
    let server = null, connId = 0, frameNo = 0;
    const conns = new Set(), targets = {};
    const stateOf = (t) => targets[t] || { state: 'shown', holder: '' };
    function listen(cb) {
        try { fs.unlinkSync(socketPath); } catch (e) { /* not there */ }
        server = net.createServer((sock) => {
            const id = ++connId;
            let buf = Buffer.alloc(0);
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
                        const ts = stateOf(m.target);
                        sock.write(frame({ ev: 'target', target: m.target, state: ts.state, holder: ts.holder }));
                        sock.write(frame({ ev: 'layer', ref: m.ref, state: ts.state === 'shown' ? 'shown' : 'waiting' }));
                    }
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
        target(name, state, holder) {
            targets[name] = { state, holder: holder || '' };
            onMessage({ t: Date.now(), ev: 'ctl', target: name, state, holder: holder || '' });
            conns.forEach((s) => { try { s.write(frame({ ev: 'target', target: name, state, holder: holder || '' })); } catch (e) { /* gone */ } });
        },
    };
}

if (require.main === module) {
    const sock = process.argv[2], out = process.argv[3];
    if (!sock || !out) { console.error('usage: node test/adam_mtrack/fake_cluster_render.js <socket> <log.jsonl>'); process.exit(2); }
    const frames = path.join(path.dirname(out), 'frames');
    try { fs.mkdirSync(frames); } catch (e) { /* there */ }
    const fake = createFake(sock, (rec) => fs.appendFileSync(out, JSON.stringify(rec) + '\n'), frames);
    process.on('SIGUSR1', () => { fs.appendFileSync(out, JSON.stringify({ t: Date.now(), ev: 'restart' }) + '\n'); fake.restart(); });
    const ctlPath = sock + '.ctl';
    try { fs.unlinkSync(ctlPath); } catch (e) { /* not there */ }
    const ctl = net.createServer((c) => {
        let b = '';
        c.on('error', () => {});
        c.on('data', (d) => {
            b += d.toString('utf8');
            let i;
            while ((i = b.indexOf('\n')) >= 0) {
                const line = b.slice(0, i); b = b.slice(i + 1);
                try { const m = JSON.parse(line); fake.target(m.target || 'panel', m.state, m.holder); } catch (e) { /* bad line */ }
            }
        });
    });
    ctl.listen(ctlPath);
    const bye = () => { ctl.close(); try { fs.unlinkSync(ctlPath); } catch (e) { /* gone */ } fake.close(() => { try { fs.unlinkSync(sock); } catch (e) { /* gone */ } process.exit(0); }); setTimeout(() => process.exit(0), 500).unref(); };
    process.on('SIGTERM', bye);
    process.on('SIGINT', bye);
    console.log('fake cluster-render on ' + sock);
}

module.exports = { createFake, HELLO, decodeFrame };
