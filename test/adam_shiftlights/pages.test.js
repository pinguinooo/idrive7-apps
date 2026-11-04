'use strict';
/* pages.js (what each settings page shows): every app.json setting on exactly one page, every control writing its own
 * setting with a value app.json allows, steppers clamped and recovering from garbage, disabled rows without
 * controls, the plain notes, and ASCII text with no jargon. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const P = require('../../apps/adam_shiftlights/pages');
const L = require('../../apps/adam_shiftlights/logic');

const APP = path.join(__dirname, '..', '..', 'apps', 'adam_shiftlights');
const SPEC = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));
const cfg = L.validateConfig(require('../../apps/adam_shiftlights/config')).cfg;
const item = (k) => SPEC.settings.filter((s) => s.key === k)[0];

/** A model over app.json defaults plus `saved`. */
function model(saved, more) {
    const vals = {};
    SPEC.settings.forEach((s) => { vals[s.key] = s.default; });
    Object.assign(vals, saved);
    return Object.assign({ get: (k) => vals[k], schema: SPEC.settings, cfg, carMode: null, offReason: '', version: '0.4.0' }, more);
}
const views = (m) => P.PAGES.map((n, i) => P.view(i, m));
/** Every string anywhere in a page's content. */
function strings(x, out) {
    out = out || [];
    if (typeof x === 'string') out.push(x);
    else if (Array.isArray(x)) x.forEach((y) => strings(y, out));
    else if (x && typeof x === 'object') Object.keys(x).forEach((k) => { if (k !== 'key' && k !== 'id' && k !== 'writes') strings(x[k], out); });
    return out;
}
/** A value app.json allows for key. */
function valid(k, v) {
    const s = item(k);
    if (!s) return false;
    if (s.type === 'bool') return v === true || v === false;
    if (s.type === 'choice') return s.options.some((o) => o[0] === v);
    return s.steps.indexOf(v) >= 0;
}
const GARBAGE = { hudOn: 'yes', clusterOn: 1, bothMode: 'x', hudStyle: {}, hudSize: 999, hudBright: 'x', hudNight: null, hudX: 'far', hudY: 7,
    clusterStyle: null, clusterSize: -1, clusterX: 3, clusterY: 'x', onlySportPlus: 'x', autoStart: 0, leadMs: 'fast', rpmPoll: 'x', driveMode: 9,
    comfortStart: 'x', comfortShift: 999, sportStart: null, layout: 'x', renderer: 7, demo: null };
const STATES = [
    {}, { hudOn: true }, { clusterOn: true }, { hudOn: true, clusterOn: true }, { hudOn: true, clusterOn: true, bothMode: 'cluster' },
    { hudOn: true, clusterOn: true, bothMode: 'map' }, { onlySportPlus: true, hudOn: true }, GARBAGE,
    { sportplusStart: 6500, sportplusShift: 6500, comfortStart: 6500, comfortShift: 2500, leadMs: 150, hudSize: 70, hudBright: 100 },
];

module.exports = [
    ['every app.json setting sits on exactly one page', () => {
        const seen = {};
        views(model({})).forEach((v) => {
            const keys = (v.cards || []).map((c) => c.id).concat((v.rows || []).map((r) => r.id));
            (v.modes || []).forEach((x) => keys.push(x.start.key, x.shift.key));
            keys.forEach((k) => { seen[k] = (seen[k] || []).concat(v.id); });
        });
        SPEC.settings.forEach((s) => assert.deepStrictEqual((seen[s.key] || []).length, 1, s.key + ': ' + JSON.stringify(seen[s.key])));
        assert.deepStrictEqual(Object.keys(seen).sort(), SPEC.settings.map((s) => s.key).sort());
    }],
    ['pill options are app.json\'s option ids, in order; the selected pill is the value in use', () => {
        views(model({ hudStyle: 'bar', clusterStyle: 'stock', driveMode: 'comfort', bothMode: 'map', demo: 'off' })).forEach((v) => (v.rows || []).filter((r) => r.kind === 'pills').forEach((r) => {
            assert.deepStrictEqual(r.controls.map((c) => c.key.split(':')[2]), item(r.id).options.map((o) => o[0]), r.id);
            assert.strictEqual(r.controls.filter((c) => c.on).length, 1, r.id);
        }));
        const hud = P.view(1, model({ hudStyle: 'bar' })).rows[0];
        assert.deepStrictEqual([hud.controls.filter((c) => c.on)[0].text, hud.desc], ['Bar only', 'Shift bar only']);
        // garbage saved: the fallback is marked (what the app really uses)
        assert.strictEqual(P.view(1, model({ hudStyle: 'classicx' })).rows[0].controls.filter((c) => c.on)[0].key, 'hud:hudStyle:large');
    }],
    ['every control writes its own setting with a value app.json allows, in every on/off state and with garbage saved', () => {
        STATES.forEach((st) => views(model(st)).forEach((v) => {
            const own = {};
            (v.cards || []).forEach((c) => c.controls.forEach((x) => { own[x.key] = c.id; }));
            (v.rows || []).forEach((r) => r.controls.forEach((x) => { own[x.key] = r.id; }));
            (v.modes || []).forEach((r) => [r.start, r.shift].forEach((c) => c.controls.forEach((x) => { own[x.key] = c.key; })));
            P.controlsOf(v).forEach((c) => {
                assert.ok(/^[a-z]+:[A-Za-z]+(:[a-z+-]+)?$/.test(c.key), c.key);
                assert.strictEqual(c.key.split(':')[0], v.id, c.key);
                c.writes.forEach((w) => assert.ok(valid(w[0], w[1]), JSON.stringify(st) + ' ' + c.key + ' writes ' + JSON.stringify(w)));
                if (own[c.key]) c.writes.forEach((w) => assert.strictEqual(w[0], own[c.key], c.key));
                // nothing to write only at a stepper's end, or on the pill already saved
                if (!c.writes.length) assert.ok(c.end || (c.on && model(st).get(own[c.key]) === c.key.split(':')[2]), JSON.stringify(st) + ' ' + c.key);
            });
        }));
        const home = P.view(0, model({ hudOn: true, clusterOn: true }));
        assert.deepStrictEqual(home.alloff.writes, [['hudOn', false], ['clusterOn', false]]);
        assert.deepStrictEqual(home.cards.map((c) => c.controls[0].writes), [[['hudOn', false]], [['clusterOn', false]]]);
        assert.deepStrictEqual(P.view(1, model({})).noteAction.writes, [['hudOn', true]]);
        assert.deepStrictEqual(P.view(2, model({})).noteAction.writes, [['clusterOn', true]]);
    }],
    ['stepOf clamps at both ends and recovers from garbage saved values', () => {
        const s = item('hudSize').steps;
        assert.deepStrictEqual([P.stepOf(s, 100, 1), P.stepOf(s, 100, -1), P.stepOf(s, 120, 1), P.stepOf(s, 70, -1)], [110, 90, 120, 70]);
        assert.deepStrictEqual([P.stepOf(s, 999, -1), P.stepOf(s, 999, 1), P.stepOf(s, 95, 1), P.stepOf(s, 95, -1), P.stepOf(s, 5, -1)], [120, 120, 100, 90, 70]);
        assert.deepStrictEqual([P.stepOf(s, 'x', 1), P.stepOf(s, null, -1)], [70, 70]);
        // a garbage save shows its fallback and steps from there (readStyle: the HUD's 110)
        const row = P.view(1, model({ hudOn: true, hudSize: 'x' })).rows[1];
        assert.deepStrictEqual([row.value, row.controls[1].writes], ['110%', [['hudSize', 120]]]);
        const top = P.view(1, model({ hudOn: true, hudBright: 100 })).rows[2];
        assert.deepStrictEqual([top.controls[1].end, top.controls[1].writes, top.controls[0].writes], [true, [], [['hudBright', 80]]]);
        // a shift point: 0 is the default and steps as its rpm (4,000: between 3,500 and an explicit 4,000); garbage counts
        // as the default (logic.modeThresholds); 999 is shown as it is used (down to 100: 900)
        const b = P.view(3, model({ comfortStart: 'x', comfortShift: 999 })).modes[0];
        assert.deepStrictEqual([b.start.value, b.start.controls[0].writes, b.start.controls[1].writes, b.shift.value, b.shift.controls[1].writes],
            ['Default (4,000)', [['comfortStart', 3500]], [['comfortStart', 4000]], '900', [['comfortShift', 2500]]]);
        const sp = P.view(3, model({})).modes[2].shift.controls;
        assert.deepStrictEqual(sp.map((c) => c.writes), [[['sportplusShift', 6700]], [['sportplusShift', 6800]]]);   // Default sits at 6,800: 100 rpm a press
        const back = P.view(3, model({ sportplusShift: 6800 })).modes[2].shift.controls;
        assert.deepStrictEqual(back.map((c) => c.writes), [[['sportplusShift', 0]], []], 'one step down from 6,800 is Default (6,800); it is the top step (the limiter allows 6,850)');
        const lo = P.view(3, model({ comfortStart: 2000 })).modes[0].start.controls;
        assert.deepStrictEqual([lo[0].end, lo[0].writes], [true, []]);
        const lead = P.view(3, model({ leadMs: 'fast' })).rows[2];
        assert.deepStrictEqual([lead.value, lead.controls[0].writes], ['60 ms (default)', [['leadMs', 40]]]);
        assert.strictEqual(P.view(3, model({ leadMs: 0 })).rows[2].value, 'Off');
    }],
    ['disabled rows have no controls: HUD page with the HUD off; Comfort and Sport shift points with Only in Sport+ on', () => {
        const off = P.view(1, model({}));
        assert.ok(off.rows.every((r) => !r.enabled));
        assert.deepStrictEqual(P.controlsOf(off).map((c) => c.key), ['hud:turnon']);
        assert.ok(P.view(2, model({ hudOn: true })).rows.every((r) => !r.enabled));
        assert.ok(P.view(1, model({ hudOn: true })).rows.every((r) => r.enabled) && !P.view(1, model({ hudOn: true })).noteAction);
        const b = P.view(3, model({ onlySportPlus: true }));
        assert.deepStrictEqual(b.modes.map((x) => x.enabled), [false, false, true]);
        assert.ok(P.controlsOf(b).every((c) => !/:(comfort|sport)(Start|Shift):/.test(c.key)), P.controlsOf(b).map((c) => c.key).join(' '));
        assert.ok(b.notes.some((n) => n.text === 'Only in Sport+ is on: Comfort and Sport never light.'));
        assert.deepStrictEqual(P.view(3, model({})).modes.map((x) => x.enabled), [true, true, true]);
    }],
    ['notes say plainly which display shows, why a page is off, and where the drive mode comes from', () => {
        const both = P.view(0, model({ hudOn: true, clusterOn: true }));
        assert.deepStrictEqual(both.cards.map((c) => c.state.text), ['Showing', 'On, not showing: the HUD wins']);
        assert.strictEqual(both.rows[0].desc, 'This car shows one at a time. Showing: HUD');
        const cl = P.view(0, model({ hudOn: true, clusterOn: true, bothMode: 'cluster' }));
        assert.deepStrictEqual(cl.cards.map((c) => c.state.text), ['On, not showing: the cluster wins', 'Showing']);
        assert.strictEqual(P.view(0, model({ hudOn: true, clusterOn: true, bothMode: 'map' })).rows[0].desc, 'This car shows one at a time. Showing: HUD + cluster centre area (experimental)');
        assert.strictEqual(P.view(0, model({ hudOn: true })).rows[0].desc, 'Only matters when both are on');
        assert.strictEqual(P.view(0, model({ hudOn: true }, { offReason: 'OFF: kill file' })).cards[0].state.text, 'On, paused: see below');
        assert.strictEqual(P.view(0, model({ hudOn: true }, { offReason: 'DEMO DATA: nothing sent to the cluster' })).cards[0].state.text, 'Showing');
        assert.strictEqual(P.view(1, model({})).note, 'HUD is off. Turn it on here or on Home');
        assert.strictEqual(P.view(1, model({ hudOn: true, clusterOn: true, bothMode: 'cluster' })).note, 'On, not showing: the cluster wins when both are on (change it on Home)');
        assert.strictEqual(P.view(2, model({ hudOn: true, clusterOn: true })).note, 'On, not showing: the HUD wins when both are on (change it on Home)');
        assert.strictEqual(P.view(3, model({}, { carMode: 'sportplus' })).note, 'Drive mode now: Sport+, from the car');
        assert.strictEqual(P.view(3, model({ driveMode: 'comfort' })).note, 'Drive mode now: Comfort, the fallback (the car sends none)');
        assert.strictEqual(P.view(3, model({}, { carMode: 'sportplus' })).rows[4].desc, 'Not used now: the car sends Sport+');
        assert.strictEqual(P.view(0, model({}, { carMode: 'sport' })).status.mode, 'Drive mode: Sport, from the car');
        const bad = P.view(3, model({ sportplusStart: 6500, sportplusShift: 6500, comfortShift: 6900 }));
        assert.ok(bad.notes.some((n) => n.tone === 'warn' && n.text === 'Comfort, Sport+: these don\'t fit, using the defaults.'), JSON.stringify(bad.notes));
        assert.strictEqual(P.view(4, model({})).note, 'Shift Lights 0.4.0');
    }],
    ['every text is ASCII with no jargon (v3, v4, classic); rpm with commas; the cold-oil line in F from config', () => {
        STATES.forEach((st) => views(model(st, { carMode: 'sport', offReason: 'OFF: kill file' })).forEach((v) => strings(v).forEach((s) => {
            assert.ok(/^[\x20-\x7e]*$/.test(s), JSON.stringify(s));
            assert.ok(!/\bv\d|classic|km\/h|kph|\bC\b/i.test(s), s);
        })));
        const notes = P.view(3, model({})).notes.map((n) => n.text);
        assert.ok(notes.indexOf('Cold oil lowers the limit: 4,500 rpm at 86 F or less, full 7,000 from 176 F.') >= 0, notes.join(' | '));
        assert.strictEqual(notes[0], 'Shift must be 200+ rpm over first light.');
        assert.deepStrictEqual([P.fmtRpm(6800), P.fmtRpm(950), P.toF(30), P.toF(80)], ['6,800', '950', 86, 176]);
        assert.deepStrictEqual(P.view(3, model({})).modes.map((x) => x.shift.value), ['Default (5,000)', 'Default (6,800)', 'Default (6,800)']);
    }],
];
