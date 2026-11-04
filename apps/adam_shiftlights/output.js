'use strict';
/**
 * output.js - the cluster / HUD side: the cluster-render layers the display mode and the two styles want.
 *
 *   const out = createOutput({ ClusterRender, socketPath, log, cfg, guard, makeCanvas });
 *   out.apply({ display, active, sel, states, rpm, th, gear });   // on every sample or setting change;
 *       // sel: { cluster, hud } (logic.readStyle), states: { cluster, hud } (logic.step for each style's count)
 *   out.status() -> { link: 'none' | 'connecting' | 'ready', layers: { 'target role': state } }
 *
 * The plan (geom.layersFor) is keyed on every layer's place and style, not its brightness: a new key drops
 * the old layers and makes the new ones on the open connection (a style switch is live); nothing active
 * (off, kill switch, tripped, demo data) drops every layer and closes the connection. Uniforms go only when
 * they change; brightness is u_st on the effects and `opacity` on the bracket image. The flash is a
 * renderer-side step animation of u_on, started when the flash starts, so nothing is sent per frame.
 * The bracket image is drawn once (hudart.js) and sent whole; a gear change sends only the digit's box.
 */
const { FS_SLATS, FS_BRACKET, slatUniforms, bracketUniforms, cellUniform } = require('./shader');
const geom = require('./geom');
const hudart = require('./hudart');
const L = require('./logic');

function createOutput(o) {
    const cfg = o.cfg, log = o.log, guard = o.guard;
    let cr = null, planKey = '[]', layers = [], linkState = 'none';
    const layerStates = Object.create(null), warned = Object.create(null);
    const warn = (text) => { if (!warned[text]) { warned[text] = true; log.warn(text); } };

    function client() {
        if (cr) return cr;
        cr = new o.ClusterRender('adam_shiftlights', o.socketPath);
        linkState = 'connecting';
        const c = cr;
        c.on('ready', guard('cr ready', () => { if (cr === c) { linkState = 'ready'; log.info('cluster-render: connected (' + c.backend + ', ' + c.targets + ')'); } }));
        c.on('disconnected', guard('cr disconnected', () => { if (cr === c) { linkState = 'connecting'; log.warn('cluster-render: connection lost, reconnecting'); } }));
        c.on('layer', guard('cr layer', (ref, state, reason) => {
            if (cr !== c || layerStates[ref] === state) return;
            layerStates[ref] = state;
            log.info('cluster-render: layer ' + ref + ' ' + state + (reason ? ' (' + reason + ')' : ''));
        }));
        c.on('target', guard('cr target', (name, state, holder, reason) => {
            if (cr === c) log.info('cluster-render: target ' + name + ' ' + state + (holder ? ' holder ' + holder : '') + (reason ? ' (' + reason + ')' : ''));
        }));
        c.on('refused', guard('cr refused', (op, ref, reason) => { if (cr === c) log.error('cluster-render refused ' + op + ' ' + ref + ': ' + reason); }));
        c.connect();
        return c;
    }

    function dropAll() {
        layers.forEach((l) => { delete layerStates[l.ref]; if (cr) cr.drop(l.ref); });
        layers = [];
    }

    const box = (cv, r) => {            // the rows of rect r of a canvas, packed (an image update)
        const out = Buffer.alloc(r.w * r.h * 4);
        for (let y = 0; y < r.h; y++) Buffer.from(cv.d.buffer, cv.d.byteOffset + ((r.y + y) * cv.w + r.x) * 4, r.w * 4).copy(out, y * r.w * 4);
        return out;
    };
    const validGear = (g) => (typeof g === 'number' && Math.floor(g) === g && g >= 1 && g <= 9 ? g : 0);

    function make(spec, a) {
        const r = spec.rect, level = L.levelOf(cfg, a.sel[spec.which]);
        const base = { spec, role: spec.role, which: spec.which, target: r.target, st: '', flash: -1, anim: 0, level };
        if (spec.role === 'bracketImg') {
            const cv = o.makeCanvas(r.w, r.h), b = spec.geom;
            hudart.drawBracketStatic(cv, b, cfg.colors, -r.x, -r.y, 1);
            const ref = cr.image({ target: r.target, klass: 'overlay', z: spec.z, x: r.x, y: r.y, w: r.w, h: r.h, opacity: level });
            if (!ref) { log.error('cluster-render: image layer refused by the client for ' + r.target); return null; }
            const plain = new Uint8Array(cv.d);         // the art without a gear: the gear box is restored from it
            const gb = b.gearBox, gbox = { x: gb.x - r.x, y: gb.y - r.y, w: gb.w, h: gb.h };
            const gear = validGear(a.gear);
            hudart.drawGear(cv, b, gear, cfg.colors.rail, -r.x, -r.y, 1);
            cr.pixels(ref, null, Buffer.from(cv.d.buffer, cv.d.byteOffset, cv.d.length));
            return Object.assign(base, { ref, cv, plain, gbox, gear });
        }
        const isFill = spec.role === 'bracketFill';
        const ref = cr.effect({ target: r.target, x: r.x, y: r.y, w: r.w, h: r.h, fs: isFill ? FS_BRACKET : FS_SLATS, klass: 'overlay', z: spec.z });
        if (!ref) { log.error('cluster-render: layer refused by the client for ' + r.target); return null; }
        const u = isFill ? bracketUniforms(spec, cfg.colors, level, a.th, cfg.hudStyles.cells) : slatUniforms(spec, cfg.colors, level);
        u.forEach((x) => cr.uniform(ref, x[0], x[1], x[2]));
        const st = u.filter((x) => x[0] === 'u_st')[0][1];
        return Object.assign(base, { ref, st: st.join(' '), cellKey: isFill ? cellUniform(spec, cfg.hudStyles.cells, a.th).join(' ') : '' });
    }

    function startFlash(l, flash) {
        if (flash === l.flash) return;
        l.flash = flash;
        if (l.anim) { cr.stop(l.ref, l.anim); l.anim = 0; }
        if (flash) {
            const half = Math.round(500 / cfg.flashHz);
            l.anim = cr.animate(l.ref, { property: 'uniform', name: 'u_on', keys: '0:1 ' + half + ':0 ' + (2 * half) + ':1', loop: true, interp: 'step' });
        }
    }

    function sendSt(l, v) {
        const s = v.join(' ');
        if (s !== l.st) { l.st = s; cr.uniform(l.ref, 'u_st', v); }
    }

    function update(l, a) {
        const s = a.sel[l.which], level = L.levelOf(cfg, s);
        const st = (a.states && a.states[l.which]) || { lit: 0, flashing: false };
        if (l.role === 'bracketImg') {
            if (level !== l.level) { l.level = level; cr.set(l.ref, { opacity: level }); }
            const g = validGear(a.gear);
            if (g !== l.gear) {
                l.gear = g;
                const r = l.spec.rect, gb = l.gbox;
                for (let y = 0; y < gb.h; y++) {
                    const i = ((gb.y + y) * l.cv.w + gb.x) * 4;
                    l.cv.d.set(l.plain.subarray(i, i + gb.w * 4), i);
                }
                hudart.drawGear(l.cv, l.spec.geom, g, cfg.colors.rail, -r.x, -r.y, 1);
                cr.pixels(l.ref, [gb], box(l.cv, gb));
            }
            return;
        }
        l.level = level;
        if (l.role === 'slats') {
            const flash = st.flashing ? 1 : 0;
            sendSt(l, [st.lit, flash, level, l.spec.geom.style.dim]);
            startFlash(l, flash);
            return;
        }
        // bracketFill: the fill up to the rpm (10 rpm steps), the cells' place when the thresholds move
        const flash = l.spec.flash && st.flashing ? 1 : 0, b = l.spec.geom;
        const rpm = typeof a.rpm === 'number' && isFinite(a.rpm) ? Math.round(a.rpm / 10) * 10 : 0;
        if (l.spec.cells) {
            const ck = cellUniform(l.spec, cfg.hudStyles.cells, a.th);
            if (ck.join(' ') !== l.cellKey) { l.cellKey = ck.join(' '); cr.uniform(l.ref, 'u_cells', ck); }
        }
        sendSt(l, [Math.round(b.sOf(rpm) * 100) / 100, flash, level, l.spec.cells ? st.lit : 0]);
        startFlash(l, flash);
    }

    function apply(a) {
        const want = a.active && a.sel ? geom.layersFor(cfg, a.display, a.sel, warn) : [];
        const key = JSON.stringify(want.map((p) => [p.key, p.rect, p.style]));
        if (key !== planKey) {
            dropAll();
            planKey = key;
            if (want.length) {
                client();
                layers = want.map((p) => make(p, a)).filter(Boolean);
                log.info('cluster-render: layers ' + layers.map((l) => l.target + ' ' + l.role + '#' + l.ref).join(', '));
            }
        }
        if (!want.length) {
            if (cr) { cr.close(); cr = null; linkState = 'none'; log.info('cluster-render: closed (nothing to show)'); }
            return;
        }
        layers.forEach((l) => update(l, a));
    }

    function status() {
        const out = {};
        layers.forEach((l) => { out[l.target + ' ' + l.role] = layerStates[l.ref] || 'sent'; });
        return { link: linkState, layers: out };
    }

    return { apply, status };
}

module.exports = { createOutput };
