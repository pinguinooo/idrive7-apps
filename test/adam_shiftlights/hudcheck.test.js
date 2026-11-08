'use strict';
/* hudcheck.js: every verdict code, demo never "Showing", and the self-heal's bounds (wake, clock set back, gave up,
 * manual cooldown, another app, handover, a confirmed HUD left alone). */
const assert = require('assert');
const HC = require('../../apps/adam_shiftlights/hudcheck');
const CS = require('../../apps/adam_shiftlights/crstatus');
const L = require('../../apps/adam_shiftlights/logic');
const cfg = L.validateConfig(require('../../apps/adam_shiftlights/config')).cfg;
const HCF = cfg.hudCheck;

const T0 = 1700000000000;
const hudLine = (rest) => 'target hud: slot 0x323 scene 0x1000400 800x480: ' + rest;
/** output.status().proof as output.js builds it from a status text. */
function statusOf(text, at) {
    const st = CS.parseStatus(text), rendering = {};
    Object.keys(st.targets).forEach((k) => { rendering[k] = CS.renderingOf(st.targets[k].rendering); });
    return { at, targets: st.targets, others: CS.othersOn(st, HC.SHARED), rendering };
}
function proof(o) {
    const x = o || {};
    return {
        link: x.link || 'ready', backend: 'id7', holding: !!x.holding, madeAt: x.madeAt === undefined ? T0 : x.madeAt, linkAt: T0 - 100,
        targets: x.targets || { hud: { state: 'shown', holder: '', reason: '', at: T0 + 10 } },
        layers: x.layers || [{ which: 'hud', target: 'hud', role: 'slats', ref: 1, state: 'shown', reason: '', lastSent: 'u_st 0 0 1 -0.2', lastSentAt: T0 }],
        status: x.status === undefined ? statusOf(hudLine('shown (us); rendered: renderer 1a2b subscribed for 42 s'), T0 + 5000) : x.status,
    };
}
const S = (o) => Object.assign({ which: 'hud', on: true, shown: true, offReason: '', proof: proof(), level: 1, night: false, heal: null }, o);
const code = (o) => HC.verdict(S(o)).code;
const IN = (o) => Object.assign({ wake: false, manual: false, code: 'unconfirmed', madeAt: T0, statusAt: T0 + 5000, kind: 'unsubscribed', others: false }, o);

module.exports = [
    ['every verdict code, in order', () => {
        assert.strictEqual(code({ on: false }), 'off');
        assert.strictEqual(code({ shown: false }), 'off');
        assert.strictEqual(code({ offReason: 'WAITING FOR SPORT+ (now SPORT)' }), 'paused');
        assert.strictEqual(code({ offReason: 'DEMO DATA: nothing sent to the cluster' }), 'demo');
        assert.strictEqual(code({ proof: undefined }), 'nolink');
        assert.strictEqual(code({ proof: proof({ link: 'connecting' }) }), 'nolink');
        assert.strictEqual(code({ proof: proof({ holding: true, layers: [] }) }), 'nolink');
        assert.strictEqual(code({ proof: proof({ layers: [] }) }), 'notshown');
        const mt = statusOf([hudLine('shown (us); rendered: renderer 1 subscribed for 2 s'), 'layer 9 effect of adam_mtrack on panel, overlay z 900: shown'].join('\n'), T0 + 5000);
        const v = HC.verdict(S({ proof: proof({ status: mt }) }));
        assert.strictEqual(v.code, 'otherapp');
        assert.strictEqual(v.text, 'Blocked: M Track Cluster holds the scene');
        assert.ok(/Cover off/.test(v.detail), v.detail);
        const waiting = HC.verdict(S({ proof: proof({ targets: { hud: { state: 'waiting', holder: 'foreign', reason: 'scene id in use', at: T0 } } }) }));
        assert.deepStrictEqual([waiting.code, waiting.text], ['waiting', 'Sent, the renderer says waiting']);
        assert.ok(/scene id in use/.test(waiting.detail));
        assert.strictEqual(code({ proof: proof({ targets: { hud: { state: 'parked', holder: 'foreign', reason: '', at: T0 } } }) }), 'parked');
        assert.strictEqual(code({ proof: proof({ targets: { hud: { state: 'idle', holder: '', reason: '', at: T0 } } }) }), 'notshown');
        assert.strictEqual(code({ proof: proof({ layers: [{ which: 'hud', target: 'hud', role: 'slats', ref: 1, state: 'hidden', reason: '' }] }) }), 'notshown');
        assert.strictEqual(code({ proof: proof({ status: null }) }), 'unconfirmed');
        assert.strictEqual(code({ proof: proof({ status: statusOf(hudLine('shown (us); rendered'), T0 - 101) }) }), 'unconfirmed', 'a status from before this link proves nothing');
        assert.strictEqual(code({ proof: proof({ status: statusOf(hudLine('shown (us); rendered'), T0 - 50) }) }), 'ok', 'a style change on the same link keeps the target\'s rendering line');
        assert.strictEqual(code({ proof: proof({ layers: [{ which: 'hud', target: 'hud', role: 'slats', ref: 1, state: 'sent', reason: '' }] }) }), 'ok', 'a layer with no answer yet is not a bad one');
        assert.strictEqual(code({ proof: proof({ status: statusOf(hudLine('shown (us); renderer not subscribed for 6000 ms'), T0 + 6000) }) }), 'unconfirmed');
        assert.strictEqual(code({ proof: proof({ status: statusOf(hudLine('shown (us); renderer subscription not observable'), T0 + 6000) }) }), 'unconfirmed');
        const dim = HC.verdict(S({ level: 0.35, night: true }));
        assert.deepStrictEqual([dim.code, dim.text], ['dim', 'Showing at 35 %: night dim']);
        const ok = HC.verdict(S());
        assert.deepStrictEqual([ok.code, ok.text, ok.tone], ['ok', 'Showing: the renderer drew it', 'on']);
        assert.ok(/subscribed 42 s/.test(ok.detail), ok.detail);
    }],
    ['demo, nolink, waiting and unconfirmed never say "Showing"; only ok and dim do', () => {
        const cases = [{ offReason: 'DEMO DATA: nothing sent to the cluster' }, { proof: undefined }, { proof: proof({ link: 'connecting' }) },
            { proof: proof({ targets: { hud: { state: 'waiting', holder: '', reason: '', at: T0 } } }) }, { proof: proof({ status: null }) },
            { proof: proof({ status: statusOf(hudLine('shown (us); renderer not subscribed for 9000 ms'), T0 + 9000) }) }];
        cases.forEach((c) => { const v = HC.verdict(S(c)); assert.ok(!/Showing/.test(v.text + v.detail), v.code + ': ' + v.text); assert.notStrictEqual(v.tone, 'on'); });
    }],
    ['a wake: exactly one rebuild, the window reset', () => {
        const st0 = { used: 2, gaveUp: true, lastAt: T0 - 600000, last: null, since: T0, madeAt: T0, seenOthersAt: null };
        const r = HC.healStep(st0, IN({ wake: true, code: 'ok', kind: 'rendered' }), T0 + 700000, HCF);
        assert.deepStrictEqual([r.action, r.why, r.st.used, r.st.gaveUp], ['rebuild', 'wake', 1, false]);
        const again = HC.healStep(r.st, IN({ madeAt: null }), T0 + 700001, HCF);
        assert.strictEqual(again.action, 'none', 'nothing during the gap');
        const quick = HC.healStep(again.st, IN({ madeAt: T0 + 700100, wake: true }), T0 + 700200, HCF);
        assert.deepStrictEqual([quick.action, quick.why], ['none', 'rebuilding'], 'a second wake inside gapMs: no rebuild');
    }],
    ['clock set back 1 h: no wake, and the stuck check still fires verifyMs after now', () => {
        let r = HC.healStep(null, IN({ statusAt: T0 + 1000 }), T0 + 1000, HCF);
        assert.strictEqual(r.action, 'none', 'too early');
        const back = T0 - 3600000;
        r = HC.healStep(r.st, IN({ statusAt: back + 10 }), back + 10, HCF);
        assert.strictEqual(r.action, 'none');
        assert.strictEqual(r.st.since, back + 10, 'the wait restarts from now');
        r = HC.healStep(r.st, IN({ statusAt: back + HCF.verifyMs + 20 }), back + HCF.verifyMs + 20, HCF);
        assert.deepStrictEqual([r.action, r.why], ['rebuild', 'stuck']);
    }],
    ['a third stuck in a window: none, gave up after 2', () => {
        let st = null, n = 0, t = T0;
        for (let i = 0; i < 3; i++) {
            const made = t;
            t += HCF.verifyMs + 1;
            const r = HC.healStep(st, IN({ madeAt: made, statusAt: t }), t, HCF);
            st = r.st;
            if (r.action === 'rebuild') n++;
            else assert.strictEqual(r.why, 'gave up after 2');
            t += HCF.gapMs;
        }
        assert.strictEqual(n, 2);
        assert.strictEqual(st.gaveUp, true);
        const v = HC.verdict(S({ proof: proof({ status: null }), heal: st }));
        assert.ok(/gave up after 2/.test(v.detail), v.detail);
    }],
    ['manual: runs, then none inside the cooldown, then runs again', () => {
        let r = HC.healStep(null, IN({ manual: true, code: 'ok', kind: 'rendered' }), T0 + 100, HCF);
        assert.deepStrictEqual([r.action, r.why], ['rebuild', 'manual']);
        assert.strictEqual(r.st.used, 0, 'a manual rebuild does not use an automatic one');
        const st = r.st;
        r = HC.healStep(st, IN({ manual: true, madeAt: T0 + 4000 }), T0 + 100 + HCF.manualCooldownMs - 1, HCF);
        assert.deepStrictEqual([r.action, r.why], ['none', 'cooldown']);
        r = HC.healStep(r.st, IN({ manual: true, madeAt: T0 + 4000 }), T0 + 100 + HCF.manualCooldownMs, HCF);
        assert.strictEqual(r.action, 'rebuild');
    }],
    ['another app on the shared scene: none, and no rebuild while it stays', () => {
        let r = HC.healStep(null, IN({ code: 'otherapp', others: true }), T0 + 60000, HCF);
        assert.deepStrictEqual([r.action, r.why], ['none', 'another app holds the scene']);
        r = HC.healStep(r.st, IN({ code: 'otherapp', others: true, wake: true }), T0 + 200000, HCF);
        assert.strictEqual(r.action, 'none', 'not even on a wake');
    }],
    ['handover: the other app left, ours not rendered: one rebuild', () => {
        let r = HC.healStep(null, IN({ code: 'otherapp', others: true, statusAt: T0 + 1000 }), T0 + 1000, HCF);
        r = HC.healStep(r.st, IN({ statusAt: T0 + 2000 }), T0 + 2000, HCF);
        assert.deepStrictEqual([r.action, r.why], ['rebuild', 'handover']);
        r = HC.healStep(r.st, IN({ madeAt: T0 + 6000, statusAt: T0 + 6500 }), T0 + 6500, HCF);
        assert.strictEqual(r.action, 'none', 'the handover is used up');
    }],
    ['confirmed ok: none, the very same state object (no change)', () => {
        const st0 = { used: 1, gaveUp: false, lastAt: T0 - 10000, last: { why: 'stuck', at: T0 - 10000 }, since: T0, madeAt: T0, seenOthersAt: null };
        const r = HC.healStep(st0, IN({ code: 'ok', kind: 'rendered', statusAt: T0 + 9000 }), T0 + 9000, HCF);
        assert.strictEqual(r.action, 'none');
        assert.strictEqual(r.st, st0);
        const unobs = HC.healStep(st0, IN({ kind: 'unobservable', statusAt: T0 + 9000 }), T0 + 60000, HCF);
        assert.deepStrictEqual([unobs.action, unobs.st], ['none', st0], 'not observable never counts as stuck');
    }],
    ['nothing on the display, paused or demo: never a rebuild', () => {
        assert.strictEqual(HC.healStep(null, IN({ madeAt: null, wake: true }), T0 + 9999, HCF).action, 'none');
        assert.strictEqual(HC.healStep(null, IN({ code: 'paused', wake: true }), T0 + 9999, HCF).action, 'none');
        assert.strictEqual(HC.healStep(null, IN({ code: 'demo' }), T0 + 9999, HCF).action, 'none');
        assert.strictEqual(HC.healStep(null, IN({ statusAt: T0 - 1 }), T0 + 9999, HCF).action, 'none', 'no status since the layers were made');
        assert.strictEqual(HC.healStep(null, IN({ code: 'unconfirmed' }), T0 + 9999, Object.assign({}, HCF, { maxAuto: 0 })).action, 'none', 'maxAuto 0 turns it off');
    }],
];
