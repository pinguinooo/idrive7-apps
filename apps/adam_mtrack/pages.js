'use strict';
/**
 * pages.js - what each settings page shows (pure: no drawing, no I/O; Node 8). ui.js draws it. The look and the
 * control model are Shift Lights 0.4.0's (apps/adam_shiftlights/pages.js): header tabs, rows with a label, a
 * one-line description and a toggle, pills or a stepper. Option ids come from app.json (m.schema).
 *
 * m = { get, schema, cfg, carMode, reason (logic.decide's), avail(widget id) -> bool, version, link }
 * A control: { key ('<page>:<setting>[:<option>|:-|:+]'), text, on, end, writes: [[setting, value], ...] }
 * A row: { id, kind: 'toggle' | 'pills' | 'stepper', label, desc, value, enabled, controls }
 */
const L = require('./logic');
const C = require('./catalogue');

const PAGES = ['Home', 'Panels', 'Look', 'About'];
const IDS = ['home', 'panels', 'look', 'about'];
const MODE_NAME = { comfort: 'Comfort', sport: 'Sport', sportplus: 'Sport+' };
const SHORT = {
    whenToShow: { sportplus: 'Sport+ only', sport: 'Sport and above', always: 'Always' },
    units: { us: 'US', metric: 'Metric', car: 'Follow car' },
};
const WHEN_DESC = {
    sportplus: 'Shows only in Sport+. Leaving Sport+ drops it at once',
    sport: 'Shows in Sport and Sport+ (Sport individual counts as Sport)',
    always: 'Shows in every drive mode, Comfort too',
};
const UNITS_DESC = { us: 'mph, psi, F, lb-ft, hp, mi, mpg', metric: 'km/h, bar, C, Nm, kW, km, l/100km', car: 'The car\'s own display units (US where it says nothing)' };

const safe = (get) => (k) => { try { return get(k); } catch (e) { return undefined; } };
const itemOf = (m, key) => (m.schema || []).filter((s) => s.key === key)[0] || { key, options: [], steps: [] };
const writeOf = (m, key, v) => (safe(m.get)(key) === v ? [] : [[key, v]]);
const toggle = (page, key, on) => [{ key: page + ':' + key, on, writes: [[key, !on]] }];
const row = (id, kind, label, desc, controls, more) => Object.assign({ id, kind, label, desc, enabled: true, controls }, more);

/** The next of steps from value in dir (-1 / +1), clamped; a value not in steps starts from the first (or last). */
function stepOf(steps, value, dir) {
    if (!steps || !steps.length) return value;
    const i = steps.indexOf(value);
    if (i < 0) return dir > 0 ? steps[0] : steps[steps.length - 1];
    return steps[Math.max(0, Math.min(steps.length - 1, i + dir))];
}
function stepper(m, page, key, eff, steps) {
    return [-1, 1].map((d) => {
        const v = stepOf(steps, eff, d);
        return { key: page + ':' + key + ':' + (d < 0 ? '-' : '+'), text: d < 0 ? '-' : '+', end: v === eff, writes: v === eff ? [] : writeOf(m, key, v) };
    });
}
function pills(m, page, key, eff) {
    const short = SHORT[key] || {};
    return (itemOf(m, key).options || []).map((o) => ({ key: page + ':' + key + ':' + o[0], text: short[o[0]] || o[1], on: o[0] === eff, writes: writeOf(m, key, o[0]) }));
}
const settingsOf = (m) => L.readSettings(m.get, m.schema).values;

/** Home's status line for a decision reason. */
function statusOf(m) {
    const r = m.reason || 'off', v = settingsOf(m);
    if (r === 'mode') {
        const now = MODE_NAME[m.carMode] || 'no drive mode from the car';
        return { text: (v.whenToShow === 'sport' ? 'Waiting for Sport or Sport+' : 'Waiting for Sport+') + ' (now ' + now + ')', tone: 'warn' };
    }
    if (r === 'showing') return { text: 'Showing on the cluster', tone: 'on' };
    if (r === 'hold') return { text: L.REASONS.hold, tone: 'on' };
    if (r === 'off') return { text: 'Off: BMW\'s own cluster, untouched', tone: 'off' };
    return { text: L.REASONS[r] || r, tone: r === 'tripped' || r === 'nocc' ? 'crit' : 'warn' };
}

function home(m) {
    const v = settingsOf(m), on = v.coverOn === true, st = statusOf(m);
    return {
        id: 'home',
        card: { id: 'coverOn', label: 'Cover the cluster', on, state: on ? st : { text: 'Off: BMW\'s own cluster, untouched', tone: 'off' }, controls: toggle('home', 'coverOn', on) },
        rows: [row('whenToShow', 'pills', 'When to show', WHEN_DESC[v.whenToShow], pills(m, 'home', 'whenToShow', v.whenToShow), { value: SHORT.whenToShow[v.whenToShow] })],
        status: { line: st.text, tone: st.tone, mode: 'Drive mode: ' + (MODE_NAME[m.carMode] ? MODE_NAME[m.carMode] + ', from the car' : 'none from the car yet') },
    };
}

/** The widgets a picker steps through: in this app, with a signal on this car (lower halves: halves only). */
function choices(m, lower) {
    const avail = m.avail || (() => true);
    return C.CATALOGUE.filter((w) => w.inApp && (!lower || w.kind === 'half') && (w.id === 'none' || avail(w.id))).map((w) => w.id);
}
function widgetRow(m, key, label, lower, under) {
    const v = settingsOf(m), id = v[key], w = C.get(id) || C.get('none'), avail = m.avail || (() => true);
    if (lower && under) {
        return row(key, 'stepper', label, 'Used by ' + under.label + ' (it takes the whole panel)', [], { value: 'Used', enabled: false });
    }
    const has = w.id === 'none' || avail(w.id);
    return row(key, 'stepper', label, has ? w.desc : 'No signal on this car', stepper(m, 'panels', key, id, choices(m, lower)),
        { value: w.label, greyed: !has });
}
function panels(m) {
    const v = settingsOf(m), wl = C.get(v.leftPanel), wr = C.get(v.rightPanel);
    const rows = [
        widgetRow(m, 'leftPanel', 'Left panel', false),
        widgetRow(m, 'leftLower', 'Left lower half', true, wl && wl.kind === 'whole' ? wl : null),
        widgetRow(m, 'rightPanel', 'Right panel', false),
        widgetRow(m, 'rightLower', 'Right lower half', true, wr && wr.kind === 'whole' ? wr : null),
        row('swapSides', 'toggle', 'Swap sides', 'Left and right panels change places (the corner gauges stay)', toggle('panels', 'swapSides', v.swapSides === true)),
    ];
    return { id: 'panels', rows, note: v.coverOn ? 'Changes show on the cluster at once' : 'The cover is off: changes show when it is on', noteTone: 'dim' };
}

function look(m) {
    const v = settingsOf(m), steps = itemOf(m, 'bright').steps || [], dim = Math.round(m.cfg.nightDim * 100);
    return {
        id: 'look',
        rows: [
            row('units', 'pills', 'Units', UNITS_DESC[v.units], pills(m, 'look', 'units', v.units), { value: SHORT.units[v.units] }),
            row('bright', 'stepper', 'Brightness', 'The whole cover', stepper(m, 'look', 'bright', v.bright, steps), { value: v.bright + '%' }),
            row('nightDim', 'toggle', 'Night dim', 'Dims to ' + dim + '%. Manual: the car\'s light signal is not read', toggle('look', 'nightDim', v.nightDim === true)),
            row('coverSlats', 'toggle', 'Shift lights in the cover', 'Amber and red slats in the M badge\'s place', toggle('look', 'coverSlats', v.coverSlats === true)),
        ],
        note: 'Speed shows in ' + (v.units === 'metric' ? 'km/h' : v.units === 'car' ? 'the car\'s unit' : 'mph') + '. The tachs go 0 to 7 (x1000 rpm)', noteTone: 'dim',
    };
}

function about(m) {
    const hidden = C.CATALOGUE.filter((w) => !w.inApp).map((w) => w.label);
    return {
        id: 'about',
        note: 'M Track Cluster ' + (m.version || ''), noteTone: 'dim',
        blocks: [
            { title: 'Not proven on this car yet', lines: [
                'The cover on a G01 cluster in Sport+, its pixels and brightness',
                'Shown speed vs the OEM one (speed factor ' + m.cfg.speedFactor + ')',
                'Popups above or below; the KOMBI GPU and the shaders',
                'The renderer clock for the dead-man switch; the speed getter',
                'Drive mode values, boost scale, range unit, clock time zone',
            ] },
            { title: 'Not in 0.1.0', lines: [hidden.slice(0, 4).join(', '), hidden.slice(4).join(', ')] },
        ],
        right: [
            { title: 'Remove safely', lines: ['Store > M Track Cluster > Remove.', 'Never kill or restart it by hand: three crashes', 'in about 30 s wipe every app.'] },
            { title: 'Kill switch', lines: ['Home > Cover the cluster off, or a file named', m.cfg.safety.killFile + ' in the app\'s data folder.'] },
            { title: 'With Shift Lights', lines: ['The cover hides Shift Lights\' cluster slats while it', 'shows and draws its own. Turn Shift Lights\' HUD off:', 'the HUD and the cluster panel share one scene.'] },
        ],
    };
}

function view(i, m) {
    const p = IDS[i] || 'home';
    if (p === 'panels') return panels(m);
    if (p === 'look') return look(m);
    if (p === 'about') return about(m);
    return home(m);
}

/** Every control of a page, in drawing (focus) order. */
function controlsOf(v) {
    const out = [];
    if (v.card) v.card.controls.forEach((x) => out.push(x));
    (v.rows || []).forEach((r) => { if (r.enabled) r.controls.forEach((x) => out.push(x)); });
    return out;
}

module.exports = { PAGES, IDS, view, controlsOf, stepOf, choices, statusOf, SHORT };
