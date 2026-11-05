'use strict';
/**
 * ladder.js - the staged test pattern on the Safety page: five steps, each proving one part of the cover's path on the
 * car, parked. Each step is its own cluster-render client (adam_mtrack-test: output.js with the dead-man off), refuses
 * while the cover is on, the car is not parked or another app holds the cluster scene, shows for cfg.test.stepMs (10 s)
 * and removes itself, logs what cluster-render says (target and layer states, errors, its status) and shows it; after
 * it a watcher (renderer.verifyRelease) confirms the panel is idle again, the stock cluster back.
 *
 *   1 BAR    two 260 x 44 bars at the top centre, no asset: amber plain; blue through the cover's dead-man (u_alive on
 *            the renderer's clock, restarted every 250 ms). Amber proves the panel path, blue the renderer's clock
 *   2 TINT   one translucent blue 1920 x 720 effect: a whole-panel layer
 *   3 IMAGE  a 256 x 128 test card as an image layer (left, blue) and as an asset sampled by an effect (right, orange):
 *            uploads, 131 KB each
 *   4 TACHS  the cover's base layer and its four assets (2.4 MB), u_alive held at 1
 *   5 COVER  the whole cover: 8 layers, 10 assets (4.3 MB), u_alive held at 1
 *
 *   const lad = createLadder({ cfg, log, diag, makeOutput(opts), verify(why, done), frame(), drawBoxes(out), units(), changed() })
 *   lad.start(n, { armed, parked }) -> '' when started, else why not;  lad.stop(why);  lad.tick(now, { parked })
 *   lad.running();  lad.status() -> null | { n, name, running, state, line (the Safety row), lines (the Safety block, 5) }
 */
const STEPS = {
    1: { name: 'BAR', what: 'amber bar = panel path, blue bar = renderer clock', layers: [] },
    2: { name: 'TINT', what: 'a blue tint over the whole cluster', layers: [] },
    3: { name: 'IMAGE', what: 'left: image layer, right: asset and shader', layers: [] },
    4: { name: 'TACHS', what: 'the cover\'s tachs (its base layer, 2.4 MB)', layers: ['base'] },
    5: { name: 'COVER', what: 'the whole cover (8 layers, 4.3 MB)', layers: null },
};

const kb = (b) => (b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB');
const tgt = (t) => (t ? t.state + (t.holder && t.holder !== 'none' && t.holder !== 'us' ? ' (' + t.holder + ')' : '') + (t.reason ? ' (' + t.reason + ')' : '') +
    (t.rendering && t.rendering !== 'none' ? ', ' + t.rendering : '') : 'no answer');

function createLadder(o) {
    const T = o.cfg.test, log = o.log, diag = o.diag || (() => {});
    let run = null, last = null, seq = 0;
    const left = (now) => Math.max(0, Math.ceil((T.stepMs - (now - run.shownAt)) / 1000));

    function note(text) { log.info('test: ' + text); diag('test: ' + text); }
    function snapshot(r) {
        const st = r.out.status();
        return { panel: st.targets.panel, hud: st.targets.hud, layers: st.layers, lastError: st.lastError, cap: st.cap, warm: st.warm, others: st.others, uploaded: st.uploaded };
    }
    function refuse(n, why) {
        last = { n, state: 'refused', why, at: Date.now(), id: ++seq };
        note('step ' + n + ' ' + STEPS[n].name + ' refused: ' + why);
        o.changed();
        return why;
    }

    function start(n, ctx) {
        const s = STEPS[n];
        if (!s) return 'no such step';
        if (ctx.armed) return refuse(n, 'turn Cover the cluster off first');
        if (!ctx.parked) return refuse(n, 'parked only (under ' + T.parkedKmh + ' km/h or in P)');
        if (run) stop('replaced by step ' + n, true);
        const out = o.makeOutput({ name: 'adam_mtrack-test', label: 'test', deadman: false, layers: s.layers || undefined });
        out.arm(o.units());
        if (n === 5) o.drawBoxes(out);
        run = { n, out, t0: Date.now(), state: 'connecting', readyAt: null, shownAt: null, asked: false, left: -1 };
        last = null;
        note('step ' + n + ' ' + s.name + ': ' + s.what + ', connecting');
        o.changed();
        return '';
    }

    function stop(why, replaced, refusal) {
        if (!run) { if (why === 'stop button' && last) { last = null; o.changed(); } return; }
        const r = run, showed = r.state === 'showing';
        run = null;
        const snap = snapshot(r);
        r.out.disarm('test step ' + r.n + ': ' + (refusal ? 'refused' : why));
        const id = ++seq;
        last = Object.assign(snap, { n: r.n, state: refusal ? 'refused' : 'done', why: refusal || why, at: Date.now(), id, release: null });
        note('step ' + r.n + ' ' + STEPS[r.n].name + (refusal ? ' refused: ' + refusal : ': ' + why) + '; panel ' + tgt(snap.panel) + '; layers ' +
            (Object.keys(snap.layers).map((k) => snap.layers[k] + ' ' + k).join(', ') || 'none') + (snap.lastError ? '; last error ' + snap.lastError.op + ': ' + snap.lastError.reason : ''));
        if (showed && !replaced) {
            last.release = { pending: true };
            o.verify('test step ' + r.n, (v) => { if (last && last.id === id) { last.release = v; o.changed(); } });
        }
        o.changed();
    }

    function tick(now, ctx) {
        if (!run) return;
        const r = run, st = r.out.status();
        if (r.state === 'connecting') {
            if (st.link === 'ready' && r.readyAt === null) r.readyAt = now;
            // decide once the service has reported the targets and answered the status asked for at connect (names the apps)
            if (r.readyAt !== null && ((st.targets.panel && st.renderer) || now - r.readyAt >= 600)) {
                if (st.busy) { stop('refused', false, 'another app is using the cluster (' + (st.others.length ? st.others.join(', ') : st.busy) + ')'); return; }
                if (r.n <= 3) r.out.showTest(r.n); else r.out.show(o.frame());
                r.state = 'showing';
                r.shownAt = now;
                note('step ' + r.n + ' ' + STEPS[r.n].name + ': showing for ' + T.stepMs / 1000 + ' s' + (st.warm ? '; the HUD\'s scene was still published, so the panel swaps the shared scene id' : ''));
                o.changed();
            } else if (now - r.t0 >= T.connectMs || now < r.t0) stop('cluster-render did not answer');
            return;
        }
        r.out.tick(now);
        if (!ctx.parked) { stop('stopped: the car moved'); return; }
        if (!r.asked && now - r.shownAt >= T.statusAfterMs) { r.asked = true; r.out.requestStatus('test step ' + r.n); }
        if (now - r.shownAt >= T.stepMs || now < r.shownAt) { stop('removed after ' + T.stepMs / 1000 + ' s'); return; }
        const l = left(now);
        if (l !== r.left) { r.left = l; o.changed(); }
    }

    function status() {
        if (!run && !last) return null;
        const now = Date.now(), n = run ? run.n : last.n, s = STEPS[n], d = run ? snapshot(run) : last, head = 'Step ' + n + ' ' + s.name;
        let state, line;
        if (run && run.state === 'connecting') { state = 'connecting to cluster-render'; line = head + ': connecting to cluster-render'; }
        else if (run) { state = 'showing, ' + left(now) + ' s left: ' + s.what; line = head + ' showing: ' + left(now) + ' s left. Watch the cluster'; }
        else if (last.state === 'refused') { state = 'refused: ' + last.why; line = head + ' refused: ' + last.why.replace(/ \(.*\)$/, ''); }
        else {
            const rel = last.release;
            state = last.why;
            line = head + ' done: ' + (!rel ? last.why : rel.pending ? 'checking the release' : rel.ok || rel.unreachable ? 'released' : 'release NOT confirmed');
        }
        const lay = Object.keys(d.layers || {}).map((k) => d.layers[k] + ' ' + k).join(', ');
        const rel = run ? 'Release: checked after the step' : !last.release ? 'Release: not checked (nothing was drawn)'
            : last.release.pending ? 'Release: checking (the panel must go idle)' : last.release.short;
        const r0 = !run && last.release && !last.release.pending ? last.release : null;
        return {
            n, name: s.name, running: !!run, state: run ? run.state : last.state, line, released: r0 ? !!(r0.ok || r0.unreachable) : null,
            lines: [
                head + ': ' + state,
                'Panel: ' + tgt(d.panel) + '; HUD: ' + tgt(d.hud),
                'Layers: ' + (lay || 'none') + (d.uploaded ? '; uploaded ' + kb(d.uploaded) : ''),
                'Renderer: ' + (d.lastError ? 'error ' + d.lastError.op + ': ' + d.lastError.reason : 'no error') + (d.cap ? '; cap ' + d.cap + ' KB/s' : '') +
                    (d.warm ? '; HUD scene was published' : '') + (d.others && d.others.length ? '; ' + d.others.join(', ') : ''),
                rel,
            ],
        };
    }

    return { start, stop, tick, status, running: () => !!run, STEPS };
}

module.exports = { createLadder, STEPS };
