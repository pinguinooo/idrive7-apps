'use strict';
/**
 * pages.js - drawing of Engine Vitals' six pages. Ported from apps/car_vitals 2.25.0 (Engine, Thermals, Fuel &
 * ignition, Chassis) and apps/warmup 1.7.3 (the warm-up view), every value through units.js, every missing value
 * as '--' (or a line saying why). Drawn strings are ASCII plus the degree sign: the kit fonts have nothing else.
 * Only methods both the software Canvas and the GPU Recorder have (quad, never convex: KB-ANY-198).
 *
 *   const pages = create(env)   env: the app's live state and helpers (main.js builds it)
 *   pages.draw(i, cv, t, d)     i: index in PAGES
 */
const { withAlpha } = require('./kit/canvas');
const G = require('./kit/gauges');
const U = require('./units');
const W = require('./warmup');
const Cd = require('./cooldown');

const PAGES = ['main', 'thermal', 'fuel', 'chassis', 'warmup', 'cooldown'];
const TABS = ['Main', 'Thermals', 'Fuel & ign.', 'Chassis', 'Warm-up', 'Cool down'];
const GO = '#2fd27a';
const COOLANT_CRIT = 112;                       // deg C, the Thermals tile's red zone

function create(env) {
    const settings = env.settings, get = (k) => settings.get(k), isNum = G.isNum;

    /**
     * { letter, num, est } for the gear readout, or null without any gear information (Car Vitals' gearText).
     * P / R / N come from the selector position: the gear field says N_OR_P for both P and N, and while
     * stopped in D (no gear engaged yet) it says N_OR_P too - that shows as D.
     */
    function gearText(d) {
        const st = d.stage, m = d.gearMode || d.program;
        if (st === 'P' || st === 'R' || st === 'N') return { letter: st, num: '', est: false };
        let g = d.gear, est = false;
        if (!isNum(g)) { g = d.gearGuess; est = true; }
        const letter = m === 'S' || m === 'M' ? m : 'D';
        if (!isNum(g)) return st === 'D' ? { letter, num: '', est: false } : null;
        if (g < 0) return { letter: 'R', num: '', est };
        if (g === 0) return st === 'D' ? { letter, num: '', est } : { letter: m === 'P' ? 'P' : 'N', num: '', est };
        return { letter, num: String(g), est };
    }

    /** The one-line engine status on the Gear card: cool-down first, then warm-up. */
    function status(t, d) {
        const a = env.coolAdvice(d), warm = get('warmOil');
        if (isNum(d.oil) && d.oil > get('oilWarn')) return { text: 'OIL HOT - EASE OFF', color: t.crit };
        if (get('cooldown') && a.need > 0) {
            if (a.state === 'done') return { text: 'TURBO COOLED', color: GO };
            return { text: 'COOL-DOWN ' + Math.ceil(a.left) + ' s', color: t.warn };
        }
        const tk = env.takeover();
        if (tk.cold) {
            const e = isNum(d.oil) ? W.eta('oil', d.oil, warm, d, env.hist5()) : W.eta('coolant', d.coolant, get('warmCoolant'), d, env.hist5());
            const lim = env.limit(d.oil);
            return { text: e.state === 'warming' ? 'WARMING ~' + Math.max(1, Math.round(e.min)) + ' min' : 'WARMING UP', color: t.cold,
                sub: lim ? 'keep under ' + lim + ' rpm' : '' };
        }
        if (tk.hasTemp) return { text: 'READY', color: GO };
        return { text: 'NO TEMPERATURES', color: t.dim };
    }

    /** Gear card (Car Vitals' speed card without the speed) with the engine status on its left. */
    function gearCard(cv, t, d, x, y, w, h) {
        G.panel(cv, t, x, y, w, h, 'Gear');
        const gr = gearText(d), gy = y + 162, gz = 120;
        if (gr) {
            const nw = gr.num ? cv.text(gr.num, x + w - 24, gy, gz, t.text, { align: 'right', font: 'gear' }) : 0;
            cv.text(gr.letter, x + w - 28 - nw, gy, gz, gr.letter === 'M' ? t.crit : gr.letter === 'S' ? t.accent : t.dim, { align: 'right', font: 'gear' });
            if (gr.est) cv.text('EST.', x + w - 24, y + 36, 22, t.dim, { align: 'right', font: 'bold', spacing: 1 });
        } else cv.text('--', x + w - 24, gy, 64, t.dim, { align: 'right', font: 'num' });
        const st = status(t, d);
        cv.text(st.text, x + 22, y + 118, 24, st.color, { font: 'bold' });
        if (st.sub) cv.text(st.sub, x + 22, y + 150, 20, t.dim);
        const b = env.banner();
        if (b) cv.text(b, x + 22, y + 178, 18, t.warn, { font: 'bold' });
    }

    /** Oil / coolant bar in the power / torque style: cold colour under the warm target (green label), red from crit. */
    function tempBar(cv, t, x, y, w, label, c, kind, warmC, critC) {
        const u = env.units(), sc = U.tempScale(kind, u), tgt = U.T(warmC, u), marks = [];
        for (let a = sc.min; a <= sc.max + 1e-9; a += sc.step) marks.push(a);
        const labels = marks.filter((a) => Math.abs(a - tgt) > sc.step * 0.4).map((a) => ({ value: a, text: String(Math.round(a)) }))
            .concat([{ value: tgt, text: String(Math.round(tgt)), color: GO }]);
        G.bar(cv, t, x, y, w, 92, {
            label, value: U.T(c, u), unit: U.tU(u), decimals: 0, min: sc.min, max: sc.max, step: sc.step, ticks: marks, labels, color: GO,
            zones: [{ from: -9999, to: tgt - 1e-6, color: 'cold' }, { from: U.T(critC, u), to: 9999, color: 'crit' }],
        });
    }

    /** Main: Car Vitals' Engine page with boost in the rpm bar's place, gear without speed, oil and coolant. */
    function drawMain(cv, t, d) {
        if (env.takeoverShown()) { drawWarmup(cv, t, d, true); return; }
        env.onEngine();
        const u = env.units(), showPk = get('peaks'), pk = env.usingDemo() ? env.demoPeak : env.peak;
        const pw = env.power(d), powMax = U.PW(get('maxPower'), u);
        ['boost', 'torque'].forEach((k) => env.raise(pk, k, d[k]));
        env.raise(pk, 'power', pw.kw);
        const room = G.pageBottom(cv) - G.BOTTOM, half = Math.round(room / 2), bs = U.boostScale(u);
        G.segBar(cv, t, 24, G.TOP, 1062, 226 + half, {
            label: 'Boost', value: U.P(d.boost, u), unit: u.press, decimals: bs.decimals, min: bs.min, max: bs.max, step: bs.step,
            scale: { every: bs.every, decimals: bs.scaleDecimals }, ramp: 'hot', limit: bs.warn, marks: [{ value: bs.warn, color: 'warn' }],
            peak: showPk ? U.P(pk.boost, u) : null,
        });
        if (!isNum(d.boost) && !env.usingDemo()) cv.text(env.boostWhy(), 42, G.TOP + 70, 20, t.dim);
        // power + torque in the panel under boost (Car Vitals' layout without boost: torque 12 over the panel's bottom)
        const p = G.panel(cv, t, 24, G.TOP + 242 + half, 1062, 226 - half, null);
        G.bar(cv, t, 48, p.y + 14, 1014, 92, {
            label: pw.calc ? 'Power (torque x rpm)' : 'Power', value: U.PW(pw.kw, u), unit: u.power, max: powMax, niceMax: true, ramp: 'hot',
            peak: showPk && isNum(pk.power) ? U.PW(pk.power, u) : null,
        });
        G.bar(cv, t, 48, p.y + 14 + p.h - 118, 1014, 92, {
            label: 'Torque', value: U.TQ(d.torque, u), unit: u.torque, decimals: 0, ramp: 'hot', max: U.TQ(900, u), niceMax: true,
            peak: showPk ? U.TQ(pk.torque, u) : null,
        });
        gearCard(cv, t, d, 1110, G.TOP, 466, 190);
        tempBar(cv, t, 1110, 272 + half, 466, env.oilFromDme() ? 'Oil (engine unit)' : 'Oil', d.oil, 'oil', get('warmOil'), get('oilWarn'));
        tempBar(cv, t, 1110, 272 + half + 132 + room - half, 466, 'Coolant', d.coolant, 'coolant', get('warmCoolant'), COOLANT_CRIT);
    }

    /* ---------- Warm-up (apps/warmup 1.7.3) ---------- */
    function gauge(cv, t, y, h, val, label, warm) {
        const u = env.units(), T = (c) => U.T(c, u), st = u.temp === 'F' ? 18 : 10;
        G.segBar(cv, t, 24, y, 880, h, {
            label, value: T(val), unit: U.tU(u), decimals: 0, min: T(0), max: T(150), step: st, scale: { every: st * 2.5 },
            zones: [{ from: T(120), to: T(135), color: 'warn' }, { from: T(135), to: T(160), color: 'crit' }],
            ramp: 'hot', limit: T(120), marks: [{ value: T(warm), color: GO }],
        });
    }
    function etaRow(cv, t, y, label, e, target) {
        const u = env.units();
        cv.text(label, 952, y, 22, t.dim, { font: 'bold', spacing: 1.5 });
        let big, col = t.text, right = '', unit = '';
        if (e.state === 'ready') { big = 'READY'; col = GO; }
        else if (e.state === 'off') { big = 'ENGINE OFF'; col = t.dim; right = 'not warming'; }
        else if (e.state === 'stalled') { big = 'NOT WARMING'; col = t.warn; right = 'drive to warm up'; }
        else if (e.state === 'warming') { big = e.min > 60 ? '>60' : '~' + Math.max(1, Math.round(e.min)); unit = 'min'; right = e.est ? 'EST.' : ''; }
        else { big = '--'; col = t.dim; }
        const bw = cv.text(big, 952, y + 50, unit ? 52 : 40, col, { font: unit || big === '--' ? 'num' : 'bold', spacing: unit ? 0 : 1 });
        if (unit) cv.text(unit, 960 + bw, y + 50, 26, t.dim);
        if (right) cv.text(right, 1552, y + 48, 24, t.dim, { align: 'right' });
        cv.text('target ' + Math.round(U.T(target, u)) + U.tU(u), 1552, y, 22, t.dim, { align: 'right' });
    }
    /** takeover: drawn on Main in place of the vitals, with Hide. */
    function drawWarmup(cv, t, d, takeover) {
        const u = env.units(), T = (c) => U.T(c, u), now = Date.now(), hist = env.hist5();
        const warm = get('warmOil'), warmC = get('warmCoolant');
        const room = G.pageBottom(cv) - G.BOTTOM, half = Math.round(room / 2);
        gauge(cv, t, G.TOP, 225 + half, d.oil, env.oilFromDme() ? 'Oil (engine unit)' : 'Oil', warm);
        gauge(cv, t, G.TOP + 242 + half, 225 - half, d.coolant, 'Coolant', warmC);
        const sp = G.panel(cv, t, 928, 44, 648, 468, null);
        const lim = env.limit(d.oil), ready = isNum(d.oil) && d.oil >= warm, hot = isNum(d.oil) && d.oil > get('oilWarn');
        let st, col;
        if (!isNum(d.oil)) { st = 'NO OIL TEMP'; col = t.dim; }
        else if (hot) { st = 'OIL HOT - EASE OFF'; col = t.crit; }
        else if (ready) { st = 'READY'; col = GO; }
        else if (d.oil >= warm - 20) { st = 'WARMING UP'; col = t.warn; }
        else { st = 'COLD'; col = t.cold; }
        const bw = takeover ? 368 : 600, bc = 952 + bw / 2;
        cv.roundRect(952, 70, bw, 60, 10, withAlpha(col, 0.22));
        if (st === 'READY') cv.roundRect(952, 70, bw, 60, 10, withAlpha(col, 0.15 + 0.1 * Math.sin(now / 400)));
        cv.text(st, bc, 114, st.length > 14 || takeover ? 30 : 38, col, { align: 'center', font: 'bold', spacing: takeover ? 2 : 3 });
        if (takeover) {
            G.button(cv, t, 1336, 78, 216, 44, 'Hide warm-up', env.dismiss, { key: 'BTN_HIDE_WARMUP' });
            cv.text('Engine not warm yet - Hide shows the vitals', 1552, 150, 18, t.dim, { align: 'right' });
        }
        etaRow(cv, t, 176, 'OIL READY IN', W.eta('oil', d.oil, warm, d, hist), warm);
        etaRow(cv, t, 261, 'COOLANT READY IN', W.eta('coolant', d.coolant, warmC, d, hist), warmC);
        // safe rev limit + trend
        const red = env.redline(), fl = lim ? lim / red : 0;
        cv.text('SAFE REV LIMIT', 952, 350, 22, t.dim, { font: 'bold', spacing: 1.5 });
        cv.text(lim ? lim + ' rpm' : '---- rpm', 1552, 352, 26, ready ? GO : t.text, { align: 'right', font: 'bold' });
        cv.roundRect(1160, 340, 230, 8, 4, t.track);
        if (fl > 0) cv.roundRect(1160, 340, 230 * fl, 8, 4, ready ? GO : col);
        // trend: last minutes on the steady clock + up to 5 min projected (Warm-Up's)
        const gx = 952, gy = 398, gw = 600, gh = 90 + sp.h - 468, nowX = gx + gw - 90;
        const now0 = hist.length ? hist[hist.length - 1][0] : env.mono();
        const span = G.clamp(hist.length ? now0 - hist[0][0] : 0, 300000, 1200000), ahead = 300000, lo = 0, hi = 140;
        const X = (ts) => nowX - ((now0 - ts) / span) * (gw - 90), Y = (c) => gy + gh - (G.clamp(c, lo, hi) - lo) / (hi - lo) * gh;
        cv.fillRect(gx, gy - 20, 22, 4, t.oil || t.accent); cv.text('OIL', gx + 30, gy - 11, 20, t.dim, { font: 'bold' });
        cv.fillRect(gx + 100, gy - 20, 22, 4, t.cold); cv.text('COOLANT', gx + 130, gy - 11, 20, t.dim, { font: 'bold' });
        cv.fillRect(gx, Y(warm), gw, 1, withAlpha(GO, 0.5));
        cv.text(String(Math.round(T(warm))), gx + gw + 4, Y(warm) + 7, 20, GO);
        cv.fillRect(nowX, gy, 1, gh, withAlpha(t.tick, 0.5));
        [[1, t.oil || t.accent, 'oil', warm, d.oil], [2, t.cold, 'coolant', warmC, d.coolant]].forEach((s) => {
            const pts = hist.filter((h) => isNum(h[s[0]])).map((h) => [X(h[0]), Y(h[s[0]])]).filter((p) => p[0] >= gx && p[0] <= nowX + 0.5);
            if (pts.length > 1) cv.polyline(pts, 3, s[1]);
            const e = W.eta(s[2], s[4], s[3], d, hist);
            if (e.state === 'warming' && pts.length) {
                const x0 = nowX, y0 = Y(s[4]), mins = Math.min(e.min, ahead / 60000);
                const x1 = x0 + (mins * 60000 / ahead) * 90, y1 = Y(s[4] + e.rate * mins);
                for (let k = 0; k < 6; k++) {
                    const a = k / 6, b = (k + 0.5) / 6;
                    cv.line(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, x0 + (x1 - x0) * b, y0 + (y1 - y0) * b, 2, withAlpha(s[1], 0.8));
                }
            }
        });
        cv.fillRect(gx, gy + gh, gw, 1, withAlpha(t.tick, 0.5));
    }

    /* ---------- Cool down ---------- */
    function drawCooldown(cv, t, d) {
        const u = env.units(), lp = G.panel(cv, t, 24, G.TOP, 760, G.BOTTOM - G.TOP, 'Turbo cool-down'), yb = lp.y + lp.h;
        if (!get('cooldown')) {
            cv.text('Turbo cool-down guidance is off (Settings)', 404, 260, 26, t.dim, { align: 'center', font: 'bold' });
        } else {
            const a = env.coolAdvice(d), msg = Cd.message(a);
            const col = a.state === 'none' || a.state === 'done' ? GO : a.state === 'paused' || a.state === 'off' ? t.warn : t.accent;
            cv.roundRect(48, 100, 712, 56, 10, withAlpha(col, 0.22));
            cv.text(msg, 404, 137, msg.length > 30 ? 22 : msg.length > 22 ? 26 : 32, col, { align: 'center', font: 'bold', spacing: 1 });
            cv.text('COOL-DOWN LEFT', 48, 200, 22, t.dim, { font: 'bold', spacing: 1.5 });
            const left = Math.ceil(a.left), lw = cv.text(String(left), 48, 278, 80, left > 0 ? t.text : GO, { font: 'num' });
            cv.text('s', 58 + lw, 278, 30, t.dim);
            cv.text(a.need ? 'needs ' + Math.ceil(a.need) + ' s after hard use' : 'no hard use lately', 760, 250, 22, t.dim, { align: 'right' });
            cv.roundRect(48, 298, 712, 12, 6, t.track);
            if (a.need && a.frac > 0) cv.rampRect(48, 298, Math.max(12, 712 * a.frac), 12, 6, [t.warn, GO], 48, 712);
            const C = Cd.C, hpOrKw = Math.round(U.PW(C.HARD_KW, u)), bst = U.P(C.HARD_BOOST_BAR, u);
            cv.text('Hard use: over ' + C.HARD_RPM + ' rpm, ' + hpOrKw + ' ' + u.power + ' or ' + G.fmt(bst, u.press === 'psi' ? 1 : 2) + ' ' + u.press + ' boost', 48, 352, 22, t.text);
            cv.text('Counts down under ' + C.GENTLE_RPM + ' rpm and ' + Math.round(U.PW(C.GENTLE_KW, u)) + ' ' + u.power + ', engine running', 48, 384, 22, t.text);
        }
        cv.text('Estimate from recent load (rpm, power, boost), not a turbo temperature sensor', 48, yb - G.MARGIN, 18, t.dim);
        drawTrend(cv, t, d, 808, G.TOP, 768, G.BOTTOM - G.TOP);
    }
    /** Oil and coolant over the last 10 min, and boost as a strip (hard boost in the warning colour). */
    function drawTrend(cv, t, d, x, y, w, h) {
        const u = env.units(), p = G.panel(cv, t, x, y, w, h, 'Last 10 min'), hist = env.hist5();
        const now0 = hist.length ? hist[hist.length - 1][0] : env.mono(), SPAN = 600000;
        const rows = hist.filter((r) => now0 - r[0] <= SPAN);
        const gx = x + 24, gw = w - 48, gy = y + 96, gh = 170;
        const temps = [];
        rows.forEach((r) => { if (isNum(r[1])) temps.push(r[1]); if (isNum(r[2])) temps.push(r[2]); });
        let lo = temps.length ? Math.min.apply(null, temps) - 5 : 40, hi = temps.length ? Math.max.apply(null, temps) + 5 : 120;
        if (hi - lo < 20) { const m = (hi + lo) / 2; lo = m - 10; hi = m + 10; }
        const X = (ts) => gx + gw - ((now0 - ts) / SPAN) * gw, Y = (c) => gy + gh - (G.clamp(c, lo, hi) - lo) / (hi - lo) * gh;
        cv.fillRect(gx, y + 62, 22, 4, t.oil || t.accent); cv.text('OIL', gx + 30, y + 71, 20, t.dim, { font: 'bold' });
        cv.fillRect(gx + 100, y + 62, 22, 4, t.cold); cv.text('COOLANT', gx + 130, y + 71, 20, t.dim, { font: 'bold' });
        cv.text(Math.round(U.T(hi, u)) + U.tU(u), gx + gw, y + 71, 20, t.dim, { align: 'right' });
        cv.text(Math.round(U.T(lo, u)) + U.tU(u), gx + gw, gy + gh + 22, 20, t.dim, { align: 'right' });
        cv.fillRect(gx, gy + gh, gw, 1, withAlpha(t.tick, 0.5));
        [[1, t.oil || t.accent], [2, t.cold]].forEach((s) => {
            const pts = rows.filter((r) => isNum(r[s[0]])).map((r) => [X(r[0]), Y(r[s[0]])]);
            if (pts.length > 1) cv.polyline(pts, 3, s[1]);
        });
        if (rows.length < 2) cv.text('collecting (one point every 5 s)', gx + gw / 2, gy + gh / 2, 22, t.dim, { align: 'center' });
        // trend line: oil (or coolant) now and its rate over the last minute
        const key = isNum(d.oil) ? 1 : 2, cur = key === 1 ? d.oil : d.coolant, m = W.measured(hist, key, 60000);
        let line = (key === 1 ? 'Oil ' : 'Coolant ') + (isNum(cur) ? Math.round(U.T(cur, u)) + U.tU(u) : '--');
        if (isNum(cur) && isNum(m.rate)) {
            const r = U.dT(m.rate, u);
            line += Math.abs(r) < 0.5 ? ', steady' : (r < 0 ? ', falling ' : ', rising ') + Math.round(Math.abs(r)) + ' ' + U.tU(u) + '/min';
        }
        cv.text(line, gx, gy + gh + 22, 22, t.text, { font: 'bold' });
        // boost strip
        const sy = gy + gh + 46, sh = p.y + p.h - G.MARGIN - 26 - sy, bs = U.boostScale(u), hard = U.P(Cd.C.HARD_BOOST_BAR, u);
        cv.text('BOOST', gx, sy + 18, 18, t.dim, { font: 'bold', spacing: 1.5 });
        const bx = gx + 80, bwid = gw - 80, n = 120, cw = bwid / n;
        cv.fillRect(bx, sy + sh, bwid, 1, withAlpha(t.tick, 0.5));
        rows.forEach((r) => {
            const v = U.P(r[5], u);
            if (!isNum(v)) return;
            const f = G.clamp((v - Math.max(0, bs.min)) / (bs.max - Math.max(0, bs.min)), 0, 1), bh = Math.max(2, f * sh);
            const cx = bx + bwid - ((now0 - r[0]) / SPAN) * bwid;
            cv.fillRect(cx - cw, sy + sh - bh, Math.max(2, cw - 1), bh, v > hard ? t.warn : withAlpha(t.accent, 0.6));
        });
        cv.text('over ' + G.fmt(hard, u.press === 'psi' ? 1 : 2) + ' ' + u.press + ' = hard', gx + gw, p.y + p.h - G.MARGIN, 18, t.warn, { align: 'right' });
    }

    /* ---------- Thermals / Fuel & ignition / Chassis (Car Vitals 2.25.0) ---------- */
    /** Boxes for n tiles: 2 per row up to 4 tiles, 3 per row from 5, 4 from 7. */
    function grid(n) {
        const per = n <= 2 ? Math.max(1, n) : n <= 4 ? 2 : n <= 6 ? 3 : 4, rows = Math.ceil(n / per), gap = 16;
        const h = (G.BOTTOM - G.TOP - gap * (rows - 1)) / rows, out = [];
        for (let r = 0; r < rows; r++) {
            const k = Math.min(per, n - r * per), w = (1552 - 24 * (k - 1)) / k;
            for (let c = 0; c < k; c++) out.push({ x: 24 + c * (w + 24), y: G.TOP + r * (h + gap), w, h });
        }
        return out;
    }
    const mm = (h, f, dec, what) => {
        const v = h.filter(isNum);
        return v.length ? (what || 'last 5 min') + '  ·  min ' + G.fmt(f(Math.min.apply(null, v)), dec) + '  max ' + G.fmt(f(Math.max.apply(null, v)), dec) : (what || 'last 5 min');
    };
    function drawTiles(cv, t, tiles) {
        if (!tiles.length) {
            const p = G.panel(cv, t, 24, G.TOP, 1552, G.BOTTOM - G.TOP, null), dy = Math.round((p.h - (G.BOTTOM - G.TOP)) / 2);
            cv.text('No data from the engine unit yet', 800, 260 + dy, 32, t.dim, { align: 'center', font: 'bold' });
            cv.text('Values show up here once the car answers. Settings: set one to Show to keep it on screen.', 800, 304 + dy, 24, t.dim, { align: 'center' });
            return;
        }
        grid(tiles.length).forEach((b, i) => {
            const g = tiles[i];
            if (g.draw) g.draw(cv, t, b.x, b.y, b.w, b.h);
            else G.stat(cv, t, b.x, b.y, b.w, b.h, Object.assign({ size: b.h > 200 ? 100 : 64 }, g));
        });
    }

    function drawThermal(cv, t, d) {
        const u = env.units(), T = (c) => U.T(c, u), unit = U.tU(u), oilWarn = get('oilWarn'), hist = env.hist;
        const tile = (k, label, zones, color, valueColor) => ({
            label, value: T(d[k]), unit, zones, color, valueColor, history: hist[k].map(T),
            sub: d[k] == null ? (env.usingDemo() ? 'no data' : k === 'egs' && !isNum(env.live.egs) ? env.fuelWhy('egs') : env.why(k)) : mm(hist[k], T, 0),
        });
        drawTiles(cv, t, [
            tile('coolant', 'Coolant', [{ from: T(COOLANT_CRIT), to: 999, color: 'crit' }, { from: -99, to: T(60), color: 'cold' }]),
            tile('oil', env.oilFromDme() ? 'Engine oil (engine unit)' : 'Engine oil', [{ from: T(oilWarn), to: 999, color: 'crit' }, { from: -99, to: T(70), color: 'cold', tintOnly: true }], 'oil'),
            env.shown('gearbox') && tile('gearbox', 'Gearbox oil', [{ from: T(120), to: 999, color: 'warn' }, { from: -99, to: T(50), color: 'cold' }]),
            env.shown('egs') && tile('egs', 'Gearbox (EGS)', [{ from: T(120), to: 999, color: 'warn' }, { from: -99, to: T(50), color: 'cold' }]),
            tile('ambient', 'Ambient', [{ from: -99, to: T(3), color: 'cold' }], GO, GO),
        ].filter(Boolean));
    }

    /** Misfires this driving cycle: the total big, each cylinder below (from OBD service 06). */
    function misfireTile(cv, t, x, y, w, h, counts) {
        const p = G.panel(cv, t, x, y, w, h, 'Misfires'), yb = p.y + p.h;
        const ok = Array.isArray(counts) && counts.length, big = h > 200 ? 100 : 64;
        const total = ok ? counts.reduce((a, c) => a + (c || 0), 0) : null;
        const col = !ok ? t.dim : total === 0 ? GO : total < 20 ? t.warn : t.crit;
        const tw = cv.text(ok ? String(total) : '--', x + 18, y + 52 + big * 0.78, big, col, { font: 'num' });
        cv.text(ok ? 'this drive' : '', x + 28 + tw, y + 52 + big * 0.78, 24, t.dim);
        if (!ok) { cv.text(env.usingDemo() ? 'no data' : env.fuelWhy('misfire'), x + 18, yb - G.MARGIN, 22, t.dim); return; }
        const n = counts.length, gap = 8, cw = (w - 36 - gap * (n - 1)) / n, ch = 74, cy = yb - 12 - ch - G.clamp(yb - Math.round(y + h), 0, 16);
        counts.forEach((c, i) => {
            const cx = x + 18 + i * (cw + gap), hit = isNum(c) && c > 0;
            cv.roundRect(cx, cy, cw, ch, 8, withAlpha(hit ? t.warn : t.track, hit ? 0.18 : 0.9));
            cv.text((cw > 84 ? 'Cyl ' : '') + (i + 1), cx + cw / 2, cy + 26, 22, t.dim, { align: 'center', font: 'bold' });
            cv.text(isNum(c) ? String(c) : '-', cx + cw / 2, cy + ch - 10, 34, !isNum(c) ? t.dim : hit ? t.warn : t.text, { align: 'center', font: 'num' });
        });
    }

    /** Target against actual (boost, air charge); judged only while the target asks for more than idle. */
    function pairTile(cv, t, x, y, w, h, g) {
        const p = G.panel(cv, t, x, y, w, h, g.label), yb = p.y + p.h;
        const a = g.actual, tg = g.target, has = isNum(a), big = h > 200 ? 84 : 56;
        const gap = has && isNum(tg) ? a - tg : null, judged = isNum(gap) && tg > g.idle;
        const col = !has ? t.dim : !judged || Math.abs(gap) < g.tol ? t.text : gap > 0 ? t.crit : t.warn;
        const base = y + 52 + big * 0.78;
        const vw = cv.text(has ? G.fmt(a, g.decimals) : '--', x + 18, base, big, col, { font: 'num' });
        if (has) cv.text(g.unit, x + 26 + vw, base, 26, t.dim);
        const r = x + w - 18;
        cv.text(g.targetLabel, r, y + 76, 18, t.dim, { font: 'bold', spacing: 1.5, align: 'right' });
        cv.text(isNum(tg) ? G.fmt(tg, g.decimals) : '--', r, y + 76 + (h > 200 ? 46 : 36), h > 200 ? 40 : 30, isNum(tg) ? t.text : t.dim, { font: 'num', align: 'right' });
        if (h > 200) {
            const ha = g.histA || [], ht = g.histT || [], all = ha.concat(ht).filter(isNum);
            if (all.length > 2) {
                const hx = x + 18, hw = w - 36, hy = yb - G.MARGIN - 28, hh = Math.min(56, h * 0.24, hy - (y + 122) - 8);
                let lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
                if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
                const pts = (hs) => hs.map((q, i) => [hx + (i / Math.max(1, hs.length - 1)) * hw, isNum(q) ? hy - ((q - lo) / (hi - lo)) * hh : hy]);
                if (ha.filter(isNum).length > 2) { const pa = pts(ha); cv.fillUnder(pa, hy, withAlpha(t.accent, 0.16)); cv.polyline(pa, 2.5, withAlpha(t.accent, 0.85)); }
                if (ht.filter(isNum).length > 2) cv.polyline(pts(ht), 1.5, withAlpha(t.text, 0.55));
            }
        }
        const sub = !isNum(tg) ? g.why : !has ? 'target only: the actual value does not answer'
            : !judged ? 'on target' + (isNum(gap) ? ' (idle)' : '')
                : Math.abs(gap) < g.tol ? 'on target  ·  ' + (gap >= 0 ? '+' : '') + G.fmt(gap, g.decimals) + ' ' + g.unit
                    : (gap > 0 ? '+' : '') + G.fmt(gap, g.decimals) + ' ' + g.unit + (gap > 0 ? ' over target' : ' under target');
        cv.text(sub, x + 18, yb - G.MARGIN, 22, judged && Math.abs(gap) >= g.tol ? col : t.dim, { spacing: 0.5 });
    }

    function drawFuel(cv, t, d) {
        env.onFuel();
        const u = env.units(), T = (c) => U.T(c, u), P = (b) => U.P(b, u), dT = (c) => U.dT(c, u), pu = u.press, hist = env.hist;
        const running = isNum(d.rpm) && d.rpm > 500, val = env.fuelVal(d);
        const iatRise = isNum(val('iat')) && isNum(d.ambient) ? d.iat - d.ambient : null, off = running ? '' : '  ·  engine off';
        const shown = env.shown, why = env.fuelWhy;
        drawTiles(cv, t, [
            shown('iat') && { label: 'Intake air (IAT)', value: T(val('iat')), unit: U.tU(u), decimals: 0, history: hist.iat.map(T),
                zones: [{ from: T(50), to: T(65), color: 'warn' }, { from: T(65), to: 999, color: 'crit' }],
                sub: isNum(val('iat')) ? mm(hist.iat, T, 0) : why('iat') },
            shown('hpfp') && { label: 'High pressure fuel', value: P(val('hpfp')), unit: pu, decimals: 0, history: hist.hpfp.map(P),
                zones: running ? [{ from: -99, to: P(20), color: 'crit' }] : [],
                sub: isNum(val('hpfp')) ? mm(hist.hpfp, P, 0) + off : why('hpfp') },
            shown('lpfp') && { label: 'Low pressure fuel', value: P(val('lpfp')), unit: pu, decimals: pu === 'psi' ? 0 : 1, history: hist.lpfp.map(P),
                zones: running ? [{ from: -99, to: P(3), color: 'crit' }, { from: P(3), to: P(4), color: 'warn' }] : [],
                sub: isNum(val('lpfp')) ? mm(hist.lpfp, P, 1) + off : why('lpfp') },
            shown('iat') && { label: 'Intake air above outside', value: dT(iatRise), unit: U.tU(u), decimals: 0, history: hist.iatRise.map(dT),
                zones: [{ from: dT(25), to: dT(40), color: 'warn' }, { from: dT(40), to: 999, color: 'crit' }],
                sub: isNum(iatRise) ? mm(hist.iatRise, dT, 0, 'heat soak') : 'needs IAT + outside temperature' },
            shown('timing') && { label: 'Ignition timing (before TDC)', value: val('timing'), unit: '°', decimals: 1, history: hist.timing,
                sub: isNum(val('timing')) ? mm(hist.timing, (x) => x, 1) : why('timing') },
            shown('boostCtl') && { draw: (c, th, x, y, w, h) => pairTile(c, th, x, y, w, h, {
                label: 'Boost: target vs actual', targetLabel: 'TARGET', actual: P(val('boostActual')), target: P(val('boostTarget')),
                unit: pu, decimals: pu === 'psi' ? 1 : 2, tol: P(0.15), idle: P(0.2), why: why('boostCtl'),
                histA: hist.boostActual.map(P), histT: hist.boostTarget.map(P) }) },
            shown('load') && { draw: (c, th, x, y, w, h) => pairTile(c, th, x, y, w, h, {
                label: 'Air charge: requested vs actual', targetLabel: 'REQUESTED', actual: val('loadActual'), target: val('loadTarget'),
                unit: '%', decimals: 0, tol: 10, idle: 40, why: why('load'), histA: hist.loadActual, histT: hist.loadTarget }) },
            shown('misfire') && { draw: (c, th, x, y, w, h) => misfireTile(c, th, x, y, w, h, env.misfires(d)) },
        ].filter(Boolean));
    }

    function drawChassis(cv, t, d) {
        env.onChassis();
        const trail = env.trail;
        if (isNum(d.gLat) && isNum(d.gLong)) { trail.push([d.gLat, d.gLong]); if (trail.length > 60) trail.shift(); }
        const xd = get('xdrive'), showAwd = xd === 'on' || (xd !== 'off' && (env.awdSeen() || env.usingDemo()));
        const showTyres = env.shown('tyres'), right = showAwd ? 1196 : 1576, gw = showTyres ? 480 : right - 24;
        const room = G.pageBottom(cv) - G.BOTTOM, grow = Math.round(G.toMargin(room, 38) / 2), dx = G.toMargin(room, 28);
        G.panel(cv, t, 24, G.TOP, gw, G.BOTTOM - G.TOP, 'G-force');
        G.gmeter(cv, t, 24 + gw / 2, 258 + grow, 164 + grow, { lat: d.gLat, long: d.gLong, trail, max: 1.5, flipLong: get('flipLong') });
        if (showTyres) drawTyres(cv, t, 528, G.TOP, right - 528, G.BOTTOM - G.TOP, d);
        if (showAwd) {
            const u = env.units(), ax = 1220, aw = 356;
            G.panel(cv, t, ax, G.TOP, aw, G.BOTTOM - G.TOP, 'xDrive');
            const AWD = { _4WD_STANDARD: '4WD', _4WD_ALTERNATIV: '4WD Sport', _2WD: '2WD', AWDSAND: 'Sand' };
            const hot = d.awdQual === 'FUNKTION_NICHT_VERFUEGBAR_FEHLER';
            cv.text(AWD[d.awd] || '--', ax + 24, 160, 52, hot ? t.crit : t.text, { font: 'bold' });
            if (hot) cv.text('DERATED / OFF', ax + 24, 196, 22, t.crit, { font: 'bold', spacing: 1.5 });
            const sp = env.xdriveSplit(d), rear = sp.rear;
            G.bar(cv, t, ax + 24, 262 + Math.round(dx / 2), aw - 48, 80, { label: 'Front', value: isNum(rear) ? 100 - rear : null, unit: '%', ramp: 'hot' });
            G.bar(cv, t, ax + 24, 392 + dx, aw - 48, 80, { label: 'Rear', value: rear, unit: '%', ramp: 'hot' });
            const note = isNum(sp.nm) ? 'front ' + G.fmt(U.TQ(sp.nm, u), 0) + ' ' + u.torque + ' (transfer case)'
                : sp.from ? 'from ' + sp.from : !isNum(rear) ? 'car sends no torque split' : '';
            if (note) cv.text(note, ax + 24, 232, 20, t.dim);
        }
    }

    /** Top-down car with each tyre's pressure (against the car's target) and temperature (when shown). */
    function drawTyres(cv, t, x, y, w, h, d) {
        const u = env.units(), temps = env.shown('tyreTemp'), p = G.panel(cv, t, x, y, w, h, 'Tyres');
        const unitP = u.press, dec = unitP === 'psi' ? 0 : 1;
        const cx = x + w / 2, top = y + 70, bh = h - 100 + G.toMargin(p.h - h, 26), bw = 150;
        cv.roundRect(cx - bw / 2, top, bw, bh, 52, withAlpha(t.track, 0.9));
        cv.strokeRoundRect(cx - bw / 2, top, bw, bh, 52, 3, t.tick);
        cv.roundRect(cx - bw / 2 + 18, top + bh * 0.24, bw - 36, 34, 12, withAlpha(t.tick, 0.45));
        cv.roundRect(cx - bw / 2 + 22, top + bh * 0.70, bw - 44, 26, 10, withAlpha(t.tick, 0.35));
        cv.text('FRONT', cx, top + 36, 20, t.dim, { align: 'center', font: 'bold', spacing: 1 });
        const tyw = 34, tyh = 84, big = w > 900;
        const corners = [['FL', -1, top + 30], ['FR', 1, top + 30], ['RL', -1, top + bh - 30 - tyh], ['RR', 1, top + bh - 30 - tyh]];
        corners.forEach((cn) => {
            const k = cn[0], side = cn[1], ty = cn[2], temp = d['t' + k], pr = U.P(d['p' + k], u), tgt = U.P(d['pt' + k], u);
            let pc = isNum(pr) ? t.text : t.dim;
            if (isNum(pr) && isNum(tgt) && tgt > 0) { const r = pr / tgt; pc = r < 0.85 ? t.crit : r < 0.93 || r > 1.15 ? t.warn : GO; }
            const tc = !temps ? (isNum(pr) ? pc : t.tick) : !isNum(temp) ? t.tick : temp < 20 ? t.cold : temp > 105 ? t.crit : temp > 90 ? t.warn : t.accent;
            const tx0 = side < 0 ? cx - bw / 2 - tyw - 8 : cx + bw / 2 + 8;
            cv.roundRect(tx0, ty, tyw, tyh, 10, tc);
            for (let i = 1; i < 4; i++) cv.fillRect(tx0 + 6, ty + i * tyh / 4, tyw - 12, 2, withAlpha(t.bg, 0.35));
            const al = side < 0 ? 'right' : 'left', lx = side < 0 ? tx0 - 26 : tx0 + tyw + 26;
            const ps = G.fmt(pr, dec), size = (big ? 72 : 56) + (temps ? 0 : 16), py = ty + (temps ? 52 : 62);
            const pw = cv.text(ps, lx + (side < 0 ? -cv.textWidth(' ' + unitP, 24) : 0), py, size, pc, { align: al, font: 'num' });
            cv.text(' ' + unitP, side < 0 ? lx : lx + pw, py, 24, t.dim, { align: al });
            cv.text(isNum(tgt) ? 'target ' + G.fmt(tgt, dec) : 'no target', lx, py + 30, 22, t.dim, { align: al });
            if (temps) cv.text(isNum(temp) ? G.fmt(U.T(temp, u), 0) + U.tU(u) : '--' + U.tU(u), lx, ty + 118, 30, isNum(temp) ? tc : t.dim, { align: al, font: 'bold' });
        });
    }

    const draws = [drawMain, drawThermal, drawFuel, drawChassis, (cv, t, d) => drawWarmup(cv, t, d, false), drawCooldown];
    return { draw: (i, cv, t, d) => draws[i](cv, t, d), gearText, status };
}

module.exports = { create, PAGES, TABS };
