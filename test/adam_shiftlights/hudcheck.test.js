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
    return { at, targets: st.targets, others: CS.othersOn(st, HC.SHARED), rendering, guard: st.guard, dcsm: st.dcsm };
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
            t += HCF.backoffMs;         // 0.4.5: the second automatic rebuild only backoffMs after the first
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
    // ---- 0.4.5: the renderer's mapping guard (job 11092256: the car's HUD idle, holder none, Reset changed nothing) ----
    ['disabled: the guard line gives "Blocked: the renderer turned the HUD off", never ok, dim or Showing; ahead of otherapp', () => {
        const DIS = 'guard: hud 0x323 0x1000400 0: disabled, 2 strikes', DC = 'dcsm: Dcsm2 available for 120 s; subscription: x';
        const idle = { hud: { state: 'idle', holder: '', reason: '', at: T0 } };
        const lay = [{ which: 'hud', target: 'hud', role: 'slats', ref: 1, state: 'waiting', reason: 'target idle', lastSent: '', lastSentAt: T0 }];
        const v = HC.verdict(S({ proof: proof({ targets: idle, layers: lay, status: statusOf([hudLine('idle'), DIS, DC].join('\n'), T0 + 5000) }) }));
        assert.deepStrictEqual([v.code, v.text, v.tone], ['disabled', 'Blocked: the renderer turned the HUD off', 'warn']);
        assert.strictEqual(v.detail, 'cluster-render disabled hud after 2 strikes. Fix: Store > Cluster renderer > Update, or guard-reset');
        // even a status that says shown + rendered (a guard line from before a reset): disabled wins, never Showing
        [1, 0.35].forEach((level) => {
            const w = HC.verdict(S({ level, night: true, proof: proof({ status: statusOf([hudLine('shown (us); rendered'), DIS].join('\n'), T0 + 5000) }) }));
            assert.strictEqual(w.code, 'disabled');
            assert.ok(!/Showing/.test(w.text + w.detail));
        });
        const both = statusOf([hudLine('idle'), DIS, 'layer 9 effect of adam_mtrack on panel, overlay z 900: shown'].join('\n'), T0 + 5000);
        assert.strictEqual(code({ proof: proof({ targets: idle, status: both }) }), 'disabled', 'before otherapp');
        assert.strictEqual(code({ proof: proof({ layers: [], status: both }) }), 'notshown', 'no layer made comes first');
        const one = statusOf([hudLine('idle'), 'guard: hud 0x323 0x1000400 0: 1 strike', DC].join('\n'), T0 + 5000);
        assert.strictEqual(code({ proof: proof({ targets: idle, status: one }) }), 'notshown', 'one strike is not disabled');
        const old = statusOf([hudLine('idle'), DIS].join('\n'), T0 - 200);
        assert.notStrictEqual(code({ proof: proof({ targets: idle, status: old }) }), 'disabled', 'a status from before this link proves nothing');
    }],
    ['notshown, target idle and no guard line: the detail names Dcsm2 (up / down)', () => {
        const idle = { hud: { state: 'idle', holder: '', reason: '', at: T0 } };
        const up = HC.verdict(S({ proof: proof({ targets: idle, status: statusOf([hudLine('idle'), 'dcsm: Dcsm2 available for 0 s; subscription: x'].join('\n'), T0 + 5000) }) }));
        assert.deepStrictEqual([up.code, up.text], ['notshown', 'Sent, not shown yet']);
        assert.strictEqual(up.detail, 'Target hud idle; the renderer has not asked for the slot (Dcsm2 up)');
        const down = HC.verdict(S({ proof: proof({ targets: idle, status: statusOf([hudLine('idle'), 'dcsm: Dcsm2 not available for 9 s; subscription: x'].join('\n'), T0 + 5000) }) }));
        assert.ok(/\(Dcsm2 down\)$/.test(down.detail), down.detail);
        const none = HC.verdict(S({ proof: proof({ targets: idle, status: statusOf(hudLine('idle'), T0 + 5000) }) }));
        assert.strictEqual(none.detail, 'Target hud idle', 'no dcsm line: nothing claimed');
    }],
    ['healStep disabled: no automatic rebuild (stuck, wake) and no manual one', () => {
        const st0 = { used: 0, gaveUp: false, lastAt: null, last: null, since: T0, madeAt: T0, seenOthersAt: null };
        [IN({ disabled: true, code: 'disabled', kind: '' }), IN({ disabled: true, wake: true, code: 'disabled' }), IN({ disabled: true, manual: true, code: 'disabled' })].forEach((inp) => {
            const r = HC.healStep(st0, inp, T0 + 600000, HCF);
            assert.deepStrictEqual([r.action, r.why], ['none', 'disabled by the renderer guard'], JSON.stringify(inp));
        });
        assert.strictEqual(HC.healStep(st0, IN({ code: 'notshown', kind: '' }), T0 + 600000, HCF).action, 'rebuild', 'control: the same state not disabled rebuilds');
    }],
    ['back-off: the second automatic rebuild refused before backoffMs, allowed at backoffMs', () => {
        let r = HC.healStep(null, IN(), T0 + HCF.verifyMs, HCF);
        assert.deepStrictEqual([r.action, r.why, r.st.used], ['rebuild', 'stuck', 1]);
        const at = T0 + HCF.verifyMs, made = at + HCF.gapMs;
        r = HC.healStep(r.st, IN({ madeAt: made, statusAt: made + HCF.verifyMs }), made + HCF.verifyMs, HCF);
        assert.deepStrictEqual([r.action, r.why], ['none', 'backing off']);
        r = HC.healStep(r.st, IN({ madeAt: made, statusAt: at + HCF.backoffMs - 1 }), at + HCF.backoffMs - 1, HCF);
        assert.deepStrictEqual([r.action, r.why], ['none', 'backing off']);
        r = HC.healStep(r.st, IN({ madeAt: made, statusAt: at + HCF.backoffMs }), at + HCF.backoffMs, HCF);
        assert.deepStrictEqual([r.action, r.why, r.st.used], ['rebuild', 'stuck', 2]);
    }],
    ['back-off with the clock set back 1 h: the wait restarts from now and does not stall', () => {
        let r = HC.healStep(null, IN(), T0 + HCF.verifyMs, HCF);
        const made = T0 + HCF.verifyMs + HCF.gapMs, back = T0 - 3600000;
        r = HC.healStep(r.st, IN({ madeAt: made, statusAt: back }), back, HCF);
        assert.strictEqual(r.st.lastAt, back, 'lastAt moved to now');
        r = HC.healStep(r.st, IN({ madeAt: made, statusAt: back + HCF.backoffMs - 1 }), back + HCF.backoffMs - 1, HCF);
        assert.deepStrictEqual([r.action, r.why], ['none', 'backing off']);
        r = HC.healStep(r.st, IN({ madeAt: made, statusAt: back + HCF.backoffMs }), back + HCF.backoffMs, HCF);
        assert.deepStrictEqual([r.action, r.why], ['rebuild', 'stuck'], 'not stalled an hour');
    }],
    ['dcsmUp false: no automatic rebuild (display service down); null (unknown) does not block', () => {
        const r = HC.healStep(null, IN({ dcsmUp: false, code: 'notshown', kind: '' }), T0 + 600000, HCF);
        assert.deepStrictEqual([r.action, r.why], ['none', 'display service down']);
        assert.strictEqual(HC.healStep(null, IN({ dcsmUp: false, wake: true }), T0 + 600000, HCF).action, 'none', 'not on a wake either');
        assert.strictEqual(HC.healStep(null, IN({ dcsmUp: null }), T0 + 600000, HCF).action, 'rebuild');
        assert.strictEqual(HC.healStep(null, IN({ dcsmUp: false, manual: true }), T0 + 600000, HCF).action, 'rebuild', 'Reset HUD drawing still runs');
    }],
    ['relinked after gave up: a new window (used 0), no rebuild of its own; then stuck rebuilds again', () => {
        const st0 = { used: 2, gaveUp: true, lastAt: T0 - 600000, last: { why: 'stuck', at: T0 - 600000 }, since: T0, madeAt: T0, seenOthersAt: null };
        let r = HC.healStep(st0, IN({ relinked: true, statusAt: T0 + 1000 }), T0 + 1000, HCF);
        assert.deepStrictEqual([r.action, r.st.used, r.st.gaveUp], ['none', 0, false]);
        r = HC.healStep(r.st, IN({ statusAt: T0 + HCF.verifyMs }), T0 + HCF.verifyMs, HCF);
        assert.deepStrictEqual([r.action, r.why], ['rebuild', 'stuck']);
        const wakeOff = HC.healStep(st0, IN({ statusAt: T0 + HCF.verifyMs }), T0 + HCF.verifyMs, HCF);
        assert.deepStrictEqual([wakeOff.action, wakeOff.why], ['none', 'gave up after 2'], 'control: without relinked it stays given up');
    }],
    ['no change: an unchanged disabled, backing-off or service-down input returns the very same st object', () => {
        const st0 = { used: 1, gaveUp: false, lastAt: T0, last: { why: 'stuck', at: T0 }, since: T0 + 4000, madeAt: T0 + 4000, seenOthersAt: null };
        [IN({ madeAt: T0 + 4000, disabled: true }), IN({ madeAt: T0 + 4000, statusAt: T0 + 9000 }), IN({ madeAt: T0 + 4000, dcsmUp: false })].forEach((inp) => {
            const r = HC.healStep(st0, inp, T0 + 9000, HCF);
            assert.strictEqual(r.action, 'none');
            assert.strictEqual(r.st, st0, r.why);
        });
    }],
];
