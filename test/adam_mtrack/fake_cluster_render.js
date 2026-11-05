'use strict';
/**
 * A stand-in for the cluster-render service (idrive-apps PROTOCOL.md, its README "Arbitration"): frames
 * `u32 len | type | body`, answers a client's hello as the iDrive 7 service does, then reports every target's state to
 * every client (as its first report does) and each change after. A target is `shown` while any client's layer on it is
 * visible and ready (every asset it samples has pixels), `lingering` for lingerMs once none is (then `idle`); `panel`
 * and `hud` share one scene id, so the one asked for second waits (`waiting`, reason `scene id in use by another
 * target`) until the other is idle; a target's scene stays published once shown until the other target of that id is
 * shown (`scene published` in the status). An asset is written (its status line's `N writes`) only while its target
 * is shown or lingering and it has pixels, as compositor.cpp render() does. Each layer's owner gets its state
 * (`hidden`, `stalled`, `waiting` with its reason, `shown`). The service's limits refuse with an `error` event: 8
 * layers a client, 16 assets a client, 16 MiB of pixel memory for every client (an asset counted twice, an image layer
 * iw x ih x 4 twice). `status` is answered in the service's own text format (server.cpp status_text).
 * Records every J message and every F (image or asset pixels) message. Node 8 or newer.
 *
 *   node test/adam_mtrack/fake_cluster_render.js <socket> <log.jsonl>   one JSON line per message: {t, conn, ...msg};
 *       an F message: {t, conn, op: 'frame', ref, rects, bytes, file}, its pixels in <log dir>/frames/<n>.bin
 *   SIGUSR1: close every connection and the server, listen again 1 s later (a service restart).
 *   <socket>.ctl: a line {"target":"panel","state":"waiting","holder":"stock"} holds that target in that state for every
 *       client (a BMW take-over); {"target":"panel","state":"shown"} gives it back. {"error":{"op":..,"ref":..,"reason":..}}
 *       sends that error event to every client; {"writes":false} stops every asset write (a renderer that never writes),
 *       {"writes":true} lets them go again. Logged as {ev: 'ctl'}.
 *   require: createFake(socketPath, onMessage(rec), framesDir?, { lingerMs }) -> { restart(cb), close(cb),
 *       target(name, state, holder), error(op, ref, reason), writes(on), state(name), statusText() }
 */
const path = require('path');
const fs = require('fs');
const net = require('net');

const HELLO = { ev: 'hello', proto: 1, backend: 'id7', targets: 'map:1088x480,panel:1920x720,hud:800x480' };
const SPECS = { map: { slot: '0x100', scene: '0x10004f0', size: '1088x480' }, panel: { slot: '0x203', scene: '0x1000400', size: '1920x720' }, hud: { slot: '0x323', scene: '0x1000400', size: '800x480' } };
const NAMES = Object.keys(SPECS);
const SHARED = { panel: 'hud', hud: 'panel' };
const LIMITS = { perClient: 8, assetsPerClient: 16, pixelBytes: 16 << 20 };

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

function createFake(socketPath, onMessage, framesDir, opts) {
    const lingerMs = opts && opts.lingerMs !== undefined ? opts.lingerMs : 3000;
    let server = null, connId = 0, frameNo = 0, layerId = 0, timer = null, writesOn = true;
    const conns = new Map();          // sock -> { id, app, layers: Map(ref -> { id, kind, target, klass, z, visible, binds }), assets: Map(ref -> {...}) }
    const T = {}, override = {};
    NAMES.forEach((n) => { T[n] = { state: 'idle', holder: 'none', reason: '', rendering: 'none', published: false, since: 0 }; });

    const send = (sock, obj) => { try { sock.write(frame(obj)); } catch (e) { /* gone */ } };
    const targetEv = (n) => ({ ev: 'target', target: n, state: T[n].state, holder: T[n].holder, reason: T[n].reason, retry_in_ms: -1, rendering: T[n].rendering, guide_disabled: 0 });
    const ready = (c, l) => Object.keys(l.binds).every((k) => { const a = c.assets.get(l.binds[k]); return !!(a && a.have); });
    const wantedBy = (n) => { let k = 0; conns.forEach((c) => c.layers.forEach((l) => { if (l.target === n && l.visible && ready(c, l)) k++; })); return k; };
    const requested = (n) => T[n].state === 'shown' || T[n].state === 'lingering';
    const memory = () => { let b = 0; conns.forEach((c) => { c.assets.forEach((a) => { b += a.w * a.h * (a.format === 'r8' ? 1 : 4) * 2; }); c.layers.forEach((l) => { b += l.bytes || 0; }); }); return b; };
    /** An asset with new pixels on a requested target is written (compositor.cpp render(): assets first, every tick). */
    function writeAssets() {
        conns.forEach((c) => c.assets.forEach((a) => { if (writesOn && a.have && a.dirty && requested(a.target)) { a.writes++; a.dirty = false; } }));
    }
    /** A layer's state and reason as compositor.cpp state() gives them. */
    function stateOf(c, l) {
        if (!l.visible) return ['hidden', ''];
        if (!ready(c, l)) return ['stalled', ''];
        if (T[l.target].state === 'shown') {
            const unwritten = Object.keys(l.binds).some((k) => { const a = c.assets.get(l.binds[k]); return !a || a.writes < 1 || a.dirty; });
            return unwritten ? ['waiting', 'an asset it samples is not written yet'] : ['shown', ''];
        }
        return ['waiting', 'target ' + T[l.target].state];
    }
    function setT(n, state, holder, reason) {
        const t = T[n], rendering = state === 'shown' || state === 'lingering' ? 'verified' : 'none';
        if (t.state === state && t.holder === (holder || 'none') && t.reason === (reason || '') && t.rendering === rendering) return false;
        t.state = state; t.holder = holder || 'none'; t.reason = reason || ''; t.rendering = rendering; t.since = Date.now();
        if (state === 'shown') { t.published = true; if (SHARED[n]) T[SHARED[n]].published = false; }
        return true;
    }
    function recompute() {
        const changed = [];
        NAMES.forEach((n) => {
            const ov = override[n], want = wantedBy(n) > 0, t = T[n];
            let did;
            if (ov) did = setT(n, ov.state, ov.holder, ov.reason || (ov.holder === 'stock' ? 'held by stock content' : ''));
            else if (want) did = SHARED[n] && requested(SHARED[n]) ? setT(n, 'waiting', 'none', 'scene id in use by another target') : setT(n, 'shown', 'us', '');
            else if (t.state === 'shown') did = setT(n, 'lingering', 'us', '');
            else if (t.state === 'lingering') did = Date.now() - t.since >= lingerMs ? setT(n, 'idle', 'none', '') : false;
            else did = setT(n, 'idle', 'none', '');
            if (did) changed.push(n);
        });
        changed.forEach((n) => conns.forEach((c, sock) => {
            if (c.app) send(sock, targetEv(n));
            c.layers.forEach((l, ref) => { if (l.target === n) layerEv(sock, ref, l); });
        }));
        if (changed.length) { recompute(); return; }
        writeAssets();
        conns.forEach((c, sock) => c.layers.forEach((l, ref) => layerEv(sock, ref, l)));
    }
    function layerEv(sock, ref, l) {
        const c = conns.get(sock);
        if (!c) return;
        const st = stateOf(c, l), key = st.join(' - ');
        if (l.sent === key) return;
        l.sent = key;
        send(sock, { ev: 'layer', ref, state: st[0], reason: st[1] });
    }
    function statusText() {
        const lines = ['upload: cap 5500 KB/s (ceiling 5500, floor 2000): the ceiling'];
        NAMES.forEach((n) => {
            const t = T[n], s = SPECS[n];
            const rendering = t.rendering === 'verified' ? 'rendered: renderer 00000000-0000-0000-0000-000000000001 subscribed for 1 s' : !requested(n) && t.published ? 'scene published' : '';
            lines.push('target ' + n + ': slot ' + s.slot + ' scene ' + s.scene + ' ' + s.size + ': ' + t.state + (t.holder !== 'none' && t.holder !== 'us' ? ' (' + t.holder + ')' : t.holder === 'us' ? ' (us)' : '') +
                (t.reason ? ' ' + t.reason : '') + (rendering ? '; ' + rendering : ''));
        });
        lines.push('renderer: 3 subscription lines read since start');
        writeAssets();
        conns.forEach((c) => c.assets.forEach((a) => lines.push('asset ' + a.id + ' ' + a.format + ' ' + a.w + 'x' + a.h + ' of ' + c.app + ' on ' + a.target + ': ' + a.writes + ' writes, ' +
            Math.round(a.writes * a.w * a.h * (a.format === 'r8' ? 1 : 4) / 1024) + ' KB, 0 failed')));
        conns.forEach((c) => c.layers.forEach((l) => { const st = stateOf(c, l); lines.push('layer ' + l.id + ' ' + l.kind + ' of ' + c.app + ' on ' + l.target + ', ' + (l.klass || 'content') + ' z ' + (l.z || 0) + ': ' + st[0] + (st[1] ? ' - ' + st[1] : '')); }));
        return lines.join('\n') + '\n';
    }

    function listen(cb) {
        try { fs.unlinkSync(socketPath); } catch (e) { /* not there */ }
        server = net.createServer((sock) => {
            const id = ++connId, c = { id, app: '', layers: new Map(), assets: new Map() };
            let buf = Buffer.alloc(0);
            conns.set(sock, c);
            onMessage({ t: Date.now(), conn: id, ev: 'connect' });
            sock.on('error', () => {});
            sock.on('close', () => { conns.delete(sock); onMessage({ t: Date.now(), conn: id, ev: 'close' }); recompute(); });
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
                        const a = c.assets.get(f.ref);
                        if (a) { a.have = true; a.dirty = true; recompute(); }
                        continue;
                    }
                    if (type !== 0x4a) { onMessage({ t: Date.now(), conn: id, binary: type, bytes: body.length }); continue; }
                    let m;
                    try { m = JSON.parse(body.toString('utf8')); } catch (e) { onMessage({ t: Date.now(), conn: id, bad: body.toString('utf8') }); continue; }
                    onMessage(Object.assign({ t: Date.now(), conn: id }, m));
                    if (m.op === 'hello') {
                        c.app = String(m.app || '?');
                        send(sock, HELLO);
                        NAMES.forEach((n) => send(sock, targetEv(n)));
                    } else if (m.op === 'layer') {
                        const bytes = m.kind === 'image' ? (m.iw || m.w) * (m.ih || m.h) * 4 * 2 : 0;
                        if (c.layers.size >= LIMITS.perClient) { send(sock, { ev: 'error', op: 'layer', ref: m.ref, reason: 'too many layers' }); continue; }
                        if (memory() + bytes > LIMITS.pixelBytes) { send(sock, { ev: 'error', op: 'layer', ref: m.ref, reason: 'the service\'s pixel memory is full' }); continue; }
                        const l = { id: ++layerId, kind: m.kind, target: m.target, klass: m.class, z: m.z, sent: '', visible: m.visible === undefined ? 1 : m.visible, binds: {}, bytes };
                        c.layers.set(m.ref, l);
                        recompute();
                        layerEv(sock, m.ref, l);
                    } else if (m.op === 'asset') {
                        const bytes = m.w * m.h * (m.format === 'r8' ? 1 : 4) * 2;
                        if (c.assets.size >= LIMITS.assetsPerClient) { send(sock, { ev: 'error', op: 'asset', ref: m.ref, reason: 'too many assets' }); continue; }
                        if (memory() + bytes > LIMITS.pixelBytes) { send(sock, { ev: 'error', op: 'asset', ref: m.ref, reason: 'the service\'s pixel memory is full' }); continue; }
                        c.assets.set(m.ref, { id: ++layerId, format: m.format || 'rgba8', w: m.w, h: m.h, target: m.target, have: false, dirty: false, writes: 0 });
                    } else if (m.op === 'set') {
                        const l = c.layers.get(m.ref);
                        if (l && m.visible !== undefined) { l.visible = m.visible; recompute(); }
                    } else if (m.op === 'bind') {
                        const l = c.layers.get(m.ref);
                        if (!l) send(sock, { ev: 'error', op: 'bind', ref: m.ref, reason: 'no such layer' });
                        else if (!c.assets.has(m.asset)) send(sock, { ev: 'error', op: 'bind', ref: m.ref, reason: 'no such asset' });
                        else { l.binds[m.sampler] = m.asset; recompute(); }
                    } else if (m.op === 'drop') {
                        if (c.layers.delete(m.ref)) recompute();
                        else if (Array.from(c.layers.values()).some((l) => Object.keys(l.binds).some((k) => l.binds[k] === m.ref))) send(sock, { ev: 'error', op: 'drop', ref: m.ref, reason: 'asset in use' });
                        else c.assets.delete(m.ref);
                    } else if (m.op === 'status') {
                        send(sock, { ev: 'status', text: statusText() });
                    }
                }
            });
        });
        server.listen(socketPath, cb);
        timer = setInterval(recompute, 50);
        if (timer.unref) timer.unref();
    }
    listen();
    return {
        restart(cb) {
            conns.forEach((c, s) => s.destroy());
            clearInterval(timer);
            server.close(() => setTimeout(() => listen(cb), 1000));
        },
        close(cb) { clearInterval(timer); conns.forEach((c, s) => s.destroy()); server.close(cb); },
        target(name, state, holder) {
            if (state === 'shown') delete override[name]; else override[name] = { state, holder: holder || '' };
            onMessage({ t: Date.now(), ev: 'ctl', target: name, state, holder: holder || '' });
            recompute();
        },
        error(op, ref, reason) {
            onMessage({ t: Date.now(), ev: 'ctl', error: { op, ref, reason } });
            conns.forEach((c, s) => send(s, { ev: 'error', op, ref, reason }));
        },
        writes(on) { writesOn = !!on; onMessage({ t: Date.now(), ev: 'ctl', writes: writesOn }); recompute(); },
        state: (name) => Object.assign({}, T[name]),
        statusText,
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
                try {
                    const m = JSON.parse(line);
                    if (m.error) fake.error(m.error.op, m.error.ref, m.error.reason);
                    else if (m.writes !== undefined) fake.writes(m.writes);
                    else fake.target(m.target || 'panel', m.state, m.holder);
                } catch (e) { /* bad line */ }
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
