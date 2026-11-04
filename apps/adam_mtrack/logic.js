'use strict';
/**
 * logic.js - M Track Cluster's decisions, pure: no I/O, no clock of its own (every time is passed in), Node 8.
 *
 *   driveModeOf(raw)              FES statusFESVehicleDynamicSwitchHMI.actualValueModeDrivingExperience ->
 *                                 'sportplus' | 'sport' | 'comfort' | null (Shift Lights' decoding)
 *   allowed(mode, when)           the "When to show" setting against the car's drive mode
 *   decide(s, now, since)         -> { want, reason, since }: whether the cover may show now. Every condition
 *                                 must hold for showHoldMs on the passed wall clock first; any failing one
 *                                 gives want false at once, with its reason.
 *   thresholds / step             the slats (Shift Lights' logic: cold-oil limit, hysteresis, limiter flash)
 *   readSettings(get, schema)     the saved settings checked against app.json (bad -> default), plus
 *   layoutOf(v)                   the panels as drawn: whole widgets take both halves, swap, hidden -> default
 */
const C = require('./catalogue');
const { clean } = require('./settings_check');

const SETTINGS_V = 1;       // settings.json shape (written once as _settingsV, for later shape changes)
const RANK = { sportplus: 3, sport: 2, comfort: 0 };
const NEED = { sportplus: 3, sport: 2 };
const REASONS = {
    showing: 'Showing',
    hold: 'Showing in a moment',
    off: 'Off',
    kill: 'Off: kill file',
    tripped: 'Stopped after errors: turn the cover off and on',
    demo: 'Demo data: the cover never shows on demo data',
    renderer: 'Cluster renderer not connected',
    nocc: 'No Check Control signal on this car: the cover stays off',
    cc: 'Check Control message: the cover gives way',
    held: 'BMW holds the cluster panel (a popup or the speech dialog)',
    hud: 'Waiting: the HUD (Shift Lights) holds the cluster scene',
    nospeed: 'No speed signal: the cover stays off',
    error: 'Error: the cover gives way for a moment',
    mode: 'Waiting for the drive mode',
};

const num = (v) => typeof v === 'number' && isFinite(v);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function driveModeOf(raw) {
    let v = raw;
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) v = Number(v.trim());
    if (typeof v === 'number') {
        if (v === 2) return 'sportplus';
        if (v === 1 || v === 3) return 'sport';
        if (v >= 4 && v <= 10 && Math.floor(v) === v) return 'comfort';
        return null;
    }
    if (typeof v !== 'string') return null;
    const s = v.trim().toUpperCase();
    if (s.indexOf('SPORT_EXPERT') === 0) return 'sportplus';
    if (s.indexOf('SPORT') === 0) return 'sport';
    if (s.indexOf('COMFORT') === 0 || s.indexOf('ECO') === 0 || s.indexOf('ADAPTIVE') === 0) return 'comfort';
    return null;
}

/** "Sport+ only" needs Sport+, "Sport and above" Sport or Sport+ (Sport individual decodes as Sport), "Always" any. */
function allowed(mode, when) {
    if (when === 'always') return true;
    const need = NEED[when] || NEED.sportplus;            // a garbage value is the strictest
    return Object.prototype.hasOwnProperty.call(RANK, mode) && RANK[mode] >= need;
}

/** The first condition that keeps the cover off, or ''. s: see decide. */
function blocker(s, now, S, cfg) {
    if (s.coverOn !== true) return 'off';
    if (s.killed) return 'kill';
    if (s.tripped) return 'tripped';
    if (s.demo) return 'demo';
    if (s.link !== 'ready') return 'renderer';
    if (cfg.requireCheckControl && !s.ccKnown) return 'nocc';
    if (s.ccActive) return 'cc';
    if (num(s.ccNewAt) && now - s.ccNewAt >= 0 && now - s.ccNewAt < S.showHoldMs) return 'cc';
    if (s.target === 'waiting' || s.target === 'parked') return s.holder === 'foreign' ? 'hud' : 'held';
    if (!num(s.speedAt) || now - s.speedAt > S.speedStaleMs || now < s.speedAt) return 'nospeed';
    if (num(s.lastErrorAt) && now - s.lastErrorAt >= 0 && now - s.lastErrorAt < S.showHoldMs) return 'error';
    if (!allowed(s.mode, s.when)) return 'mode';
    return '';
}

/**
 * s = { coverOn, killed, tripped, demo, link ('ready' once cluster-render answered), ccKnown (the Check Control
 * list arrived), ccActive, ccNewAt, target, holder (the panel target's last event), speedAt (wall ms of the last
 * valid speed), lastErrorAt, mode, when }. since: when every condition last started holding (null: not holding).
 * A clock that jumps backwards restarts the hold (KB-ANY-203).
 */
function decide(s, now, since, cfg) {
    const S = cfg.safety, b = blocker(s || {}, now, S, cfg);
    if (b) return { want: false, reason: b, since: null };
    const t0 = num(since) && since <= now ? since : now;
    const want = now - t0 >= S.showHoldMs;
    return { want, reason: want ? 'showing' : 'hold', since: t0 };
}

/* ---------- the slats: apps/adam_shiftlights/logic.js thresholds, fillLit, rawState, step ---------- */

function thresholds(cfg, mode, oil) {
    const E = cfg.engine, mt = cfg.modes[mode] || cfg.modes.sportplus;
    const warm = num(oil) ? clamp((oil - E.oilCold) / (E.oilWarm - E.oilCold), 0, 1) : 1;
    const limit = Math.round((E.limitCold + (E.limitWarm - E.limitCold) * warm) / 50) * 50;
    const shift = Math.min(mt.shift, limit - E.shiftBelowLimit);
    return { limit, shift, start: shift - (mt.shift - mt.start) };
}
const validRpm = (rpm) => num(rpm) && rpm >= 0;
const fillLit = (rpm, th, n, reds) => {
    const m = n - (reds > 0 ? reds : 1);
    return Math.ceil(clamp((rpm - th.start) * m / (th.shift - th.start), 0, m));
};
function rawState(rpm, th, n, band, reds) {
    if (!validRpm(rpm)) return { lit: 0, red: false, flashing: false };
    const flashing = rpm >= th.limit - band, red = rpm >= th.shift;
    return { lit: red || flashing ? n : fillLit(rpm, th, n, reds), red, flashing };
}
/** The next slat state with hysteresis (a slat goes off only hysteresisRpm under where it came on). */
function step(prev, rpm, th, cfg) {
    const n = cfg.row.perSide, reds = cfg.row.reds;
    if (!validRpm(rpm)) return { lit: 0, red: false, flashing: false };
    const H = cfg.engine.hysteresisRpm, band = cfg.engine.limiterBand;
    const p = prev || { lit: 0, red: false, flashing: false };
    const raw = rawState(rpm, th, n, band, reds);
    const flashing = raw.flashing || (p.flashing && rpm >= th.limit - band - H);
    const red = raw.red || (p.red && rpm >= th.shift - H);
    const lit = red || flashing ? n : Math.max(raw.lit, Math.min(p.lit, fillLit(rpm + H, th, n, reds)));
    return { lit, red, flashing };
}

/* ---------- settings ---------- */

const PANEL_KEYS = ['leftPanel', 'leftLower', 'rightPanel', 'rightLower'];

/**
 * The saved settings checked against app.json (a bad value -> its default, its key in bad), then a hidden widget
 * (no signal in this app) falls back to the setting's default too.
 */
function readSettings(get, schema) {
    const raw = {};
    (schema || []).forEach((s) => { let v; try { v = get(s.key); } catch (e) { v = undefined; } if (v !== undefined) raw[s.key] = v; });
    const r = clean(schema, raw), v = r.values, bad = r.bad.slice();
    PANEL_KEYS.forEach((k) => {
        const w = C.get(v[k]);
        if (w && w.inApp) return;
        const s = (schema || []).filter((x) => x.key === k)[0];
        if (s && v[k] !== s.default) { if (bad.indexOf(k) < 0) bad.push(k); v[k] = s.default; }
    });
    return { values: v, bad };
}

/** One side's widgets: { full } for a whole widget, else { upper, lower } (a whole in a lower half is ignored). */
function sideOf(upper, lower) {
    const u = C.get(upper), l = C.get(lower);
    if (u && u.kind === 'whole') return { full: u.id };
    return { upper: u ? u.id : 'none', lower: l && l.kind === 'half' && l.inApp ? l.id : 'none' };
}
/** v: readSettings values. Swap moves the panel contents only (the corner gauges stay). */
function layoutOf(v) {
    const L = sideOf(v.leftPanel, v.leftLower), R = sideOf(v.rightPanel, v.rightLower);
    return v.swapSides === true ? { left: R, right: L } : { left: L, right: R };
}

/** The writes that bring an older settings.json to this shape: only the version marker in 0.1.0. */
function migrateSettings(get) {
    let v;
    try { v = get('_settingsV'); } catch (e) { v = undefined; }
    return v === SETTINGS_V ? [] : [['_settingsV', SETTINGS_V]];
}

/**
 * The 0-60 mph (or 0-100 km/h) timer from speed samples (Drag Timer's rule): armed at a standstill (under 0.5 km/h),
 * started where the speed crosses 0.5 km/h, stopped where it crosses target; both crossings interpolated between
 * samples. Aborted by stopping again or after 30 s. t = the previous state (null at first); returns the next one.
 */
function timerStep(t, kmh, now, target) {
    const p = t || { phase: 'idle', t0: null, lastKmh: null, lastT: null, last: null, best: null };
    if (!num(kmh) || !num(now)) return p;
    const n = Object.assign({}, p, { lastKmh: kmh, lastT: now });
    const cross = (lv) => (num(p.lastKmh) && num(p.lastT) && kmh !== p.lastKmh ? p.lastT + (lv - p.lastKmh) / (kmh - p.lastKmh) * (now - p.lastT) : now);
    if (kmh < 0.5) return Object.assign(n, { phase: 'ready', t0: null });
    if (p.phase === 'ready') return Object.assign(n, { phase: 'run', t0: cross(0.5) });
    if (p.phase === 'run') {
        if (kmh >= target) {
            const s = Math.round((cross(target) - p.t0) / 100) / 10;
            return Object.assign(n, { phase: 'idle', t0: null, last: s, best: num(p.best) ? Math.min(p.best, s) : s });
        }
        if (now - p.t0 > 30000) return Object.assign(n, { phase: 'idle', t0: null });
    }
    return n;
}

/** Brightness 0..1: the setting (%) times night dim. */
const levelOf = (cfg, v) => Math.round((num(v.bright) ? v.bright : 100) / 100 * (v.nightDim === true ? cfg.nightDim : 1) * 1000) / 1000;

module.exports = {
    SETTINGS_V, RANK, REASONS, PANEL_KEYS, driveModeOf, allowed, decide, blocker, thresholds, rawState, step,
    readSettings, layoutOf, sideOf, migrateSettings, levelOf, timerStep,
};
