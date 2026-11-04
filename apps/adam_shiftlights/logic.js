'use strict';
/**
 * logic.js - the shift lights' pure maths: no I/O, no kit, Node 8 syntax.
 * Ported from docs/mockups/shiftlights.html (thresholds, lights, litOf, fieldColor), plus config checking,
 * per-mode settings, hysteresis and the per-display style settings (readStyle). Geometry: geom.js.
 *
 * Counts: n = the style's palette length (fields a side, plus a centre slat). lit = how many are on, in
 * lighting order (the outer end first when the fill is inward); the last `reds` light at the shift point.
 */

const G = require('./geom');

// the safe fallback for any part of config.js that fails validateConfig (config.js's own values)
const DEFAULTS = {
    engine: { idle: 750, limitWarm: 7000, limitCold: 4500, oilCold: 30, oilWarm: 80, shiftBelowLimit: 150, limiterBand: 100, hysteresisRpm: 50 },
    modes: { comfort: { start: 4000, shift: 5000 }, sport: { start: 6000, shift: 6800 }, sportplus: { start: 6000, shift: 6800 } },
    display: 'off',
    driveMode: 'sport',
    styles: { cluster: 'large', hud: 'large' },
    sizeSteps: [70, 80, 90, 100, 110, 120],
    brightSteps: [20, 40, 60, 80, 100],
    nightDim: 0.35,
    flashHz: 4,
    brightness: 1,
    colors: {
        y: '#ffc20e', o: '#ff7a00', r: '#ff2b1f', w: '#f2f5f8', a: '#ffa800', c: '#ff1a22', A: '#f3ab10', C: '#ee1c25',
        Y: '#ffd000', O: '#ff7000', R: '#ff1a14', cream: '#ebecc8', rail: '#fbfbe8', zy: '#eef0a8', zr: '#ee6a64',
    },
    mapOffset: { x: 416, y: 126, minY: 8 },
    clusterStyles: {
        large: { palette: 'aaaaaaaacc', reds: 2, fill: 'inward', lean: 'mirror', perSide: 10, slat: 15.6, pitch: 18.6, inner: 36, centre: 0, h: 82.8, shear: 29.81, cx: 960, cy: 150, glow: 30, dim: 0.2 },
        classic: { palette: 'AAAAAAAACC', reds: 2, fill: 'inward', lean: 'mirror', perSide: 10, slat: 15, pitch: 18, inner: 30, centre: 0, h: 46, shear: 22.08, cx: 960, cy: 150, glow: 0, dim: 0.13 },
        row: { palette: 'yyyoor', reds: 1, fill: 'inward', lean: 'none', perSide: 6, slat: 25, pitch: 29, inner: 2, centre: 0, h: 22, shear: 0, cx: 960, cy: 145, glow: 0, dim: 0 },
        stock: { palette: 'yoC', reds: 1, fill: 'inward', lean: 'mirror', stage: true, perSide: 1, slat: 40, pitch: 40, inner: 205.3, centre: 0, h: 92, shear: 50.6, cx: 960, cy: 185, glow: 14, dim: 0 },
    },
    hudStyles: {
        bar: { palette: 'YYYYYOOR', reds: 1, fill: 'inward', lean: 'same', perSide: 7, slat: 30, pitch: 36, inner: 33.6, centre: 30.6, h: 52, shear: 18.72, cx: 390.64, cy: 118, glow: 13, dim: 0.16 },
        cells: { palette: 'yyyyyoor', reds: 1, gap: 0.14, pad: 1.8 },
        bracket: {
            path: [[0, 52], [73, 0], [331, 0]], round: 14, rail: 3.6, gapRail: 0.8, bar: 9, numH: 11, numOff: 24,
            tickMajor: 6, cellGap: 1.5, scale: 1.2, origin: [300, 131], below: 8, scaleMax: 7000,
            redzone: { yellow: 6000, red: 6500 },
            gear: { x: 401, y: 237, h: 27.6 }, line: { x0: 340, x1: 431, y: 261 }, unitAt: [434, 264], unit: 'mph',
        },
    },
    safety: { errorLimit: 5, errorWindowMs: 10000, killFile: 'DISABLE', killPollMs: 1000 },
};
const TARGETS = G.TARGETS;
const DISPLAYS = ['off', 'cluster', 'hud', 'both'];
const MODES = ['comfort', 'sport', 'sportplus'];
const CLUSTER_STYLES = ['large', 'classic', 'row', 'stock', 'off'];
const HUD_STYLES = ['large', 'classic', 'bar', 'bracket', 'off'];
const MIN_SPAN = 200;   // a mode's shift sits at least this far over its start (rpm)
const MAX_PALETTE = 10; // FS_SLATS' u_colors[10]

const copy = (x) => JSON.parse(JSON.stringify(x));
const num = (v) => typeof v === 'number' && isFinite(v);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isObj = (v) => !!v && typeof v === 'object';
const isInt = (v, lo, hi) => num(v) && Math.floor(v) === v && v >= lo && v <= hi;

function paletteProblem(p, colors) {
    if (typeof p !== 'string' || p.length < 1 || p.length > MAX_PALETTE) return 'palette must be 1 to ' + MAX_PALETTE + ' characters';
    for (let i = 0; i < p.length; i++) if (!colors[p[i]]) return 'palette colour "' + p[i] + '" is not in colors';
    return null;
}
/** How many runs of one letter (FS_BRACKET's cells take three colours: 'yyyyyoor'). */
const runs = (p) => p.split('').filter((c, i) => !i || c !== p[i - 1]).length;

/** A slat-bar style (clusterStyles.* or hudStyles.bar) on its target; map: it must also fit there. */
function barProblem(st, colors, target, map) {
    if (!isObj(st)) return 'missing';
    const pp = paletteProblem(st.palette, colors);
    if (pp) return pp;
    const n = st.palette.length;
    if (!isInt(st.reds, 1, n)) return 'reds must be a whole number 1 to ' + n;
    if (st.fill !== 'inward' && st.fill !== 'outward') return 'fill must be inward or outward';
    if (['mirror', 'same', 'none'].indexOf(st.lean) < 0) return 'lean must be mirror, same or none';
    if (![st.slat, st.pitch, st.h].every((v) => num(v) && v > 0)) return 'slat, pitch, h must be numbers > 0';
    if (![st.inner, st.centre, st.shear, st.glow].every((v) => num(v) && v >= 0)) return 'inner, centre, shear, glow must be numbers >= 0';
    if (!(num(st.dim) && st.dim >= 0 && st.dim <= 1)) return 'dim must be 0 to 1';
    if (!num(st.cx) || !num(st.cy)) return 'cx, cy must be numbers';
    const want = st.stage ? 1 : st.centre > 0 ? n - 1 : n;
    if (st.perSide !== want) return 'perSide must be ' + want + (st.stage ? ' (stage)' : st.centre > 0 ? ' (the palette less the centre slat)' : ' (the palette length)');
    if (st.perSide > 1 && st.slat > st.pitch) return 'slat must not be wider than pitch';
    if (st.lean === 'mirror' && st.shear > st.inner) return 'shear must not pass inner (the slats would cross the axis)';
    if (st.lean === 'same' && st.centre > st.inner) return 'centre must not pass inner';
    const g = G.slatBar(st, 1, target);
    if (!g.fits) return 'does not fit ' + target + ' ' + TARGETS[target].join('x');
    if (map && !G.inside(G.toMap(g.rect, map), 'map')) return 'does not fit the map target after mapOffset';
    return null;
}

function bracketProblem(B) {
    if (!isObj(B)) return 'missing';
    const nums = ['round', 'rail', 'gapRail', 'bar', 'numH', 'numOff', 'tickMajor', 'cellGap', 'scale', 'below', 'scaleMax'];
    if (!nums.every((k) => num(B[k]) && B[k] > 0)) return nums.join(', ') + ' must be numbers > 0';
    if (B.scaleMax % 1000 || B.scaleMax > 12000) return 'scaleMax must be whole thousands up to 12000';
    const pair = (p) => Array.isArray(p) && p.length === 2 && p.every(num);
    if (!(Array.isArray(B.path) && B.path.length === 3 && B.path.every(pair))) return 'path must be 3 [x, y] points';
    if (!pair(B.origin) || !pair(B.unitAt)) return 'origin and unitAt must be [x, y]';
    if (!isObj(B.redzone) || !num(B.redzone.yellow) || !num(B.redzone.red)) return 'redzone needs yellow and red';
    if (!isObj(B.gear) || ![B.gear.x, B.gear.y, B.gear.h].every(num) || !isObj(B.line) || ![B.line.x0, B.line.x1, B.line.y].every(num)) return 'gear and line need numbers';
    if (typeof B.unit !== 'string' || !/^[\x20-\x7e]{0,8}$/.test(B.unit)) return 'unit must be up to 8 ASCII characters';
    return null;
}

/** cfg (config.js) -> { cfg, errors }: every bad part falls back to DEFAULTS with a message. Never throws. */
function validateConfig(input) {
    const errors = [];
    let src;
    try { src = isObj(input) ? copy(input) : {}; } catch (e) { src = {}; errors.push('config: unreadable (' + e.message + ')'); }
    const out = {};
    const check = (name, v, problem, fallback) => {
        let p;
        try { p = v === undefined ? 'missing' : problem(v); } catch (e) { p = String(e && e.message || e); }
        if (p) { errors.push(name + ': ' + p + ' (using the default)'); return copy(fallback); }
        return v;
    };
    const take = (key, problem) => { out[key] = check(key, src[key], problem, DEFAULTS[key]); };
    take('engine', (e) => {
        const keys = Object.keys(DEFAULTS.engine);
        if (!isObj(e) || !keys.every((k) => num(e[k]) && e[k] >= 0)) return 'every value must be a number >= 0';
        if (!(e.limitCold <= e.limitWarm && e.oilCold < e.oilWarm)) return 'limitCold <= limitWarm and oilCold < oilWarm';
        return null;
    });
    const E = out.engine;
    out.modes = {};
    MODES.forEach((m) => {
        const v = isObj(src.modes) ? src.modes[m] : undefined;
        const p = !isObj(v) ? 'missing' : modePairProblem(v.start, v.shift, E);
        if (p) { errors.push('modes.' + m + ': ' + p + ' (using the default)'); out.modes[m] = copy(DEFAULTS.modes[m]); } else out.modes[m] = { start: v.start, shift: v.shift };
    });
    take('display', (v) => (DISPLAYS.indexOf(v) < 0 ? 'must be one of ' + DISPLAYS.join(', ') : null));
    take('driveMode', (v) => (MODES.indexOf(v) < 0 ? 'must be one of ' + MODES.join(', ') : null));
    take('styles', (v) => (!isObj(v) || CLUSTER_STYLES.indexOf(v.cluster) < 0 || HUD_STYLES.indexOf(v.hud) < 0
        ? 'cluster must be one of ' + CLUSTER_STYLES.join(', ') + ' and hud one of ' + HUD_STYLES.join(', ') : null));
    const steps = (lo, hi, base) => (v) => (!(Array.isArray(v) && v.length >= 1 && v.every((x) => isInt(x, lo, hi)) && v.indexOf(base) >= 0)
        ? 'must be whole numbers ' + lo + ' to ' + hi + ' including ' + base : null);
    take('sizeSteps', steps(50, 200, 100));
    take('brightSteps', steps(1, 100, 100));
    take('nightDim', (v) => (!(num(v) && v > 0 && v <= 1) ? 'must be > 0 and <= 1' : null));
    take('flashHz', (v) => (!(num(v) && v >= 4 && v <= 20) ? 'must be 4 to 20 (the limiter flash at least 4 Hz)' : null));
    take('brightness', (v) => (!(num(v) && v >= 0 && v <= 1) ? 'must be 0 to 1' : null));
    out.colors = {};
    Object.keys(DEFAULTS.colors).concat(Object.keys(isObj(src.colors) ? src.colors : {})).forEach((k) => {
        if (out.colors[k]) return;
        const v = isObj(src.colors) ? src.colors[k] : undefined;
        if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) out.colors[k] = v;
        else if (DEFAULTS.colors[k]) { errors.push('colors.' + k + ': must be #rrggbb (using the default)'); out.colors[k] = DEFAULTS.colors[k]; }
        else errors.push('colors.' + k + ': must be #rrggbb (left out)');
    });
    take('mapOffset', (v) => (!isObj(v) || ![v.x, v.y, v.minY].every(num) || v.minY < 0 ? 'x, y, minY must be numbers (minY >= 0)' : null));
    // each style on its own: a bad one falls back alone
    const cs = isObj(src.clusterStyles) ? src.clusterStyles : {};
    out.clusterStyles = {};
    Object.keys(DEFAULTS.clusterStyles).forEach((k) => {
        out.clusterStyles[k] = check('clusterStyles.' + k, cs[k], (st) => barProblem(st, out.colors, 'panel', out.mapOffset), DEFAULTS.clusterStyles[k]);
    });
    const hs = isObj(src.hudStyles) ? src.hudStyles : {};
    out.hudStyles = {
        bar: check('hudStyles.bar', hs.bar, (st) => barProblem(st, out.colors, 'hud', null), DEFAULTS.hudStyles.bar),
        cells: check('hudStyles.cells', hs.cells, (c) => {
            if (!isObj(c)) return 'missing';
            const pp = paletteProblem(c.palette, out.colors);
            if (pp) return pp;
            if (runs(c.palette) > 3) return 'palette must be at most 3 runs of one colour (as yyyyyoor)';
            if (!isInt(c.reds, 1, c.palette.length)) return 'reds must be a whole number 1 to ' + c.palette.length;
            if (!(num(c.gap) && c.gap >= 0 && c.gap < 0.5) || !(num(c.pad) && c.pad >= 0)) return 'gap must be 0 to 0.5 and pad >= 0';
            return null;
        }, DEFAULTS.hudStyles.cells),
    };
    out.hudStyles.bracket = check('hudStyles.bracket', hs.bracket, (B) => {
        const p = bracketProblem(B);
        if (p) return p;
        const bad = ['large', 'classic'].filter((st) => !G.bracket({ bracket: B, bar: out.hudStyles.bar, cells: out.hudStyles.cells }, st).fits);
        return bad.length ? 'does not fit the hud (' + bad.join(', ') + ')' : null;
    }, DEFAULTS.hudStyles.bracket);
    take('safety', (s) => {
        if (!isObj(s) || ![s.errorLimit, s.errorWindowMs, s.killPollMs].every((v) => num(v) && v > 0)) return 'errorLimit, errorWindowMs, killPollMs must be numbers > 0';
        if (typeof s.killFile !== 'string' || !/^[A-Za-z0-9._-]+$/.test(s.killFile)) return 'killFile must be a plain file name';
        return null;
    });
    return { cfg: out, errors };
}

function modePairProblem(start, shift, E) {
    if (!num(start) || !num(shift)) return 'start and shift must be numbers';
    if (start + MIN_SPAN > shift) return 'shift must be at least ' + MIN_SPAN + ' over start';
    if (shift > E.limitWarm - E.shiftBelowLimit) return 'shift must be at most ' + (E.limitWarm - E.shiftBelowLimit);
    return null;
}

/**
 * The drive mode's start/shift: a setting of 0 (or none) means config.js. get(key) reads a setting.
 * An override pair that does not make sense gives config's pair with invalid: true.
 */
function modeThresholds(cfg, get, mode) {
    const m = MODES.indexOf(mode) >= 0 ? mode : cfg.driveMode;
    const base = cfg.modes[m];
    const read = (k) => { const v = Number(get(m + k)); return num(v) && v > 0 ? v : 0; };
    const s = read('Start'), h = read('Shift');
    const start = s || base.start, shift = h || base.shift;
    const overridden = !!(s || h);
    if (overridden && modePairProblem(start, shift, cfg.engine)) return { mode: m, start: base.start, shift: base.shift, overridden, invalid: true };
    return { mode: m, start, shift, overridden, invalid: false };
}

/** The thresholds now: the mode's, pulled down while the oil is cold. Oil unknown counts as warm. */
function thresholds(cfg, mt, oil) {
    const E = cfg.engine;
    const oilKnown = num(oil);
    const warm = oilKnown ? clamp((oil - E.oilCold) / (E.oilWarm - E.oilCold), 0, 1) : 1;
    const limit = Math.round((E.limitCold + (E.limitWarm - E.limitCold) * warm) / 50) * 50;
    const shift = Math.min(mt.shift, limit - E.shiftBelowLimit);
    return { limit, shift, start: shift - (mt.shift - mt.start), capped: shift < mt.shift, oilKnown };
}

const validRpm = (rpm) => num(rpm) && rpm >= 0;
// lights before the shift point: the first n - reds fill up to it (multiply first: exact for whole rpm);
// the reds light together at the shift point
const fillLit = (rpm, th, n, reds) => {
    const m = n - (reds > 0 ? reds : 1);
    return Math.ceil(clamp((rpm - th.start) * m / (th.shift - th.start), 0, m));
};

/** Without hysteresis: { lit, red, flashing }. Invalid or undefined rpm: all off. */
function rawState(rpm, th, n, band, reds) {
    if (!validRpm(rpm)) return { lit: 0, red: false, flashing: false };
    const flashing = rpm >= th.limit - band, red = rpm >= th.shift;
    return { lit: red || flashing ? n : fillLit(rpm, th, n, reds), red, flashing };
}

/**
 * The next state with hysteresis: a light goes on at once and off only hysteresisRpm under where it came
 * on; red and the flash likewise. flashT0 = when the flash started (kept while it lasts), else null.
 * n = fields a side, reds = how many of them light together at the shift point (default 1).
 */
function step(prev, rpm, th, n, cfg, nowMs, reds) {
    if (!validRpm(rpm)) return { lit: 0, red: false, flashing: false, flashT0: null };
    const H = cfg.engine.hysteresisRpm, band = cfg.engine.limiterBand;
    const p = prev || { lit: 0, red: false, flashing: false, flashT0: null };
    const raw = rawState(rpm, th, n, band, reds);
    const flashing = raw.flashing || (p.flashing && rpm >= th.limit - band - H);
    const red = raw.red || (p.red && rpm >= th.shift - H);
    let lit;
    if (red || flashing) lit = n;
    else lit = Math.max(raw.lit, Math.min(p.lit, fillLit(rpm + H, th, n, reds)));
    return { lit, red, flashing, flashT0: flashing ? (p.flashing && p.flashT0 !== null ? p.flashT0 : nowMs) : null };
}

/** The flash's on half (from its start): on, off, on ... at hz cycles a second. */
function flashOn(nowMs, flashT0, hz) {
    return Math.floor((nowMs - (flashT0 || 0)) * hz * 2 / 1000) % 2 === 0;
}

/** Field i's colour (i in lighting order), or null when dark; the flash shows the palette's last colour. */
function fieldColor(state, palette, i, colors, on) {
    if (state.flashing) return on ? colors[palette[palette.length - 1]] : null;
    return i < state.lit ? colors[palette[i]] : null;
}

const KEYS = { cluster: 'cluster', hud: 'hud' };
/**
 * One display's persisted settings, checked: { style, size, bright, night, warnings }. get(key) reads a
 * setting (kit Settings.get, which never validates settings.json). A value outside its list (missing, null,
 * a typo, a wrong type) gives config's default and a warning naming the key. Never throws.
 */
function readStyle(cfg, get, which) {
    const w = KEYS[which] || 'cluster', warnings = [];
    const read = (key) => { try { return get(key); } catch (e) { return undefined; } };
    const pick = (key, list, def) => {
        const v = read(key);
        if (list.indexOf(v) >= 0) return v;
        warnings.push(key + ': ' + (v === undefined ? 'missing' : JSON.stringify(v)) + ' is not one of ' + list.join(', ') + ' (using ' + def + ')');
        return def;
    };
    const style = pick(w + 'Style', w === 'hud' ? HUD_STYLES : CLUSTER_STYLES, cfg.styles[w]);
    const size = pick(w + 'Size', cfg.sizeSteps, 100);
    const bright = pick(w + 'Bright', cfg.brightSteps, 100);
    const nv = read(w + 'Night');
    if (nv !== true && nv !== false) warnings.push(w + 'Night: ' + (nv === undefined ? 'missing' : JSON.stringify(nv)) + ' is not true or false (using false)');
    return { style, size, bright, night: nv === true, warnings };
}

/** The lights a display's style shows: { palette, count, reds }, or null (bracket, off: no shift lights). */
function lightsOf(cfg, which, style) {
    let s = null;
    if (which === 'cluster') s = style !== 'off' ? cfg.clusterStyles[style] : null;
    else if (style === 'large' || style === 'bar') s = cfg.hudStyles.bar;
    else if (style === 'classic') s = cfg.hudStyles.cells;
    return s ? { palette: s.palette, count: s.palette.length, reds: s.reds } : null;
}

/** 0..1: config brightness x the display's brightness setting x night dim. */
const levelOf = (cfg, s) => Math.round(cfg.brightness * s.bright / 100 * (s.night ? cfg.nightDim : 1) * 1000) / 1000;

module.exports = {
    DEFAULTS, TARGETS, DISPLAYS, MODES, CLUSTER_STYLES, HUD_STYLES, validateConfig, modeThresholds, thresholds,
    rawState, step, flashOn, fieldColor, readStyle, lightsOf, levelOf, fillLit,
};
