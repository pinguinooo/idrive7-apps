'use strict';
/* Dev-time simulation (not a test, not shipped): picks M Track's Tach lead default. A true rpm trace (throttle blips
 * 800 -> 4000 -> 800 at 8000 rpm/s, pulls 2000 -> 7000 at 3000 rpm/s) is sampled at 10 Hz and at 20 Hz as the car
 * notifies it; each sample goes through the real logic.makeLead and logic.step, and the bar shows geom.yOfRpm of the
 * led rpm until the next sample (main.js frame()). Per lead step: the overshoot of the shown rpm over the true peak (rpm
 * read back from the drawn height, so the bar's 7,000 top clamps it as the eye sees it), the mean lag while rising (ms
 * from when the true rpm passed what the bar shows), and how often a slat went dark while the rpm still rose (flicker).
 * Rule (plan T3b): the largest step whose overshoot is <= 250 rpm and whose mean rising lag is >= 40 % below lead 0,
 * on every trace at both rates; none qualifies -> 0.
 *   node test/adam_mtrack/lead_sim.js [--md]
 */
const L = require('../../apps/adam_mtrack/logic');
const G = require('../../apps/adam_mtrack/geom');
const cfg = require('../../apps/adam_mtrack/config');

/** A piecewise-linear trace: [[tMs, rpm], ...]; rpm at t. */
const traceAt = (pts) => (t) => {
    if (t <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * (t - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
    return pts[pts.length - 1][1];
};
const blip = (rate) => { const up = (4000 - 800) / rate * 1000; return [[0, 800], [300, 800], [300 + up, 4000], [300 + up + 80, 4000], [300 + 2 * up + 80, 800], [300 + 2 * up + 600, 800]]; };
const pull = (rate) => { const up = (7000 - 2000) / rate * 1000; return [[0, 2000], [300, 2000], [300 + up, 7000], [300 + up + 150, 7000], [300 + up + 250, 4600], [300 + up + 900, 4600]]; };
const TRACES = [['blip 800-4000 at 8000 rpm/s', blip(8000), 4000], ['pull 2000-7000 at 3000 rpm/s', pull(3000), 7000]];

/** rpm drawn: the bar's height read back to rpm (bisection on geom.yOfRpm, which clamps at tach.max). */
function rpmOfY(y) {
    let lo = 0, hi = cfg.tach.max;
    for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (G.yOfRpm(mid, cfg.tach) > y) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
}

function run(pts, peak, hz, leadMs, phaseMs) {
    const at = traceAt(pts), end = pts[pts.length - 1][0], dt = 1000 / hz, lead = L.makeLead(cfg.rpmLead), th = L.thresholds(cfg, 'sportplus', 95);
    const T0 = 1.7e12;          // a wall clock, as Car's lastCar
    let shown = at(0), slat = null, maxShown = 0, flick = 0, lags = [], nextS = phaseMs;
    for (let t = 0; t <= end; t++) {
        if (t >= nextS) {
            const r = Math.round(at(t)), ld = lead(r, T0 + t, leadMs);
            const before = slat ? slat.lit : 0;
            slat = L.step(slat, ld.rpm, th, cfg, ld.add);
            if (slat.lit < before && at(t + 1) > at(t)) flick++;
            shown = rpmOfY(G.yOfRpm(ld.rpm, cfg.tach));
            nextS += dt;
        }
        maxShown = Math.max(maxShown, shown);
        const rising = at(t + 1) > at(t) && at(t) > at(t - 1);
        if (rising) {
            // when the true rpm passed the shown value (on this rising segment): the bar is that far behind
            let tp = t;
            if (shown < at(t)) { while (tp > 0 && at(tp) > shown && at(tp - 1) < at(tp)) tp--; lags.push(t - tp); } else lags.push(0);
        }
    }
    return { over: Math.max(0, maxShown - peak), lag: lags.reduce((a, b) => a + b, 0) / (lags.length || 1), flick };
}

/** Averaged over sample phases (where the samples fall against the trace), worst overshoot and flicker kept. */
function measure(pts, peak, hz, leadMs) {
    const n = 10, dt = 1000 / hz, out = { over: 0, lag: 0, flick: 0 };
    for (let k = 0; k < n; k++) { const r = run(pts, peak, hz, leadMs, k * dt / n); out.over = Math.max(out.over, r.over); out.lag += r.lag / n; out.flick += r.flick; }
    return out;
}

const rows = [], pass = {};
cfg.LEAD_STEPS.forEach((ms) => { pass[ms] = true; });
TRACES.forEach(([name, pts, peak]) => [10, 20].forEach((hz) => {
    const base = measure(pts, peak, hz, 0);
    cfg.LEAD_STEPS.forEach((ms) => {
        const m = ms ? measure(pts, peak, hz, ms) : base, cut = base.lag > 0 ? 1 - m.lag / base.lag : 0;
        const ok = ms === 0 || (m.over <= 250 && cut >= 0.4);
        if (!ok) pass[ms] = false;
        rows.push([name, hz + ' Hz', ms, Math.round(m.over), m.lag.toFixed(1), ms ? Math.round(cut * 100) + ' %' : '-', m.flick, ok ? 'yes' : 'no']);
    });
}));
const qualified = cfg.LEAD_STEPS.filter((ms) => ms > 0 && pass[ms]);
const pick = qualified.length ? qualified[qualified.length - 1] : 0;
const md = process.argv.indexOf('--md') >= 0;
if (md) {
    console.log('| trace | rate | lead ms | overshoot rpm | mean rising lag ms | lag cut | flicker | meets rule |');
    console.log('|---|---|---|---|---|---|---|---|');
    rows.forEach((r) => console.log('| ' + r.join(' | ') + ' |'));
} else rows.forEach((r) => console.log(r.join('\t')));
console.log((md ? '\n' : '') + 'qualifying steps: ' + (qualified.join(', ') || 'none') + '; default: ' + pick + ' ms (config rpmLead.leadMs now ' + cfg.rpmLead.leadMs + ')');
