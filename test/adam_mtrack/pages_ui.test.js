'use strict';
/* pages.js (what each settings page shows) and ui.js / widgets.js drawn on both surfaces the kit hands an app (the GPU
 * Recorder and the software Canvas, KB-ANY-198): every setting on one page, every control writes a value app.json
 * allows, disabled rows write nothing, the widget pickers skip hidden and signal-less widgets both ways, ASCII text,
 * every widget drawn in both units without a throw. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const KIT = path.join(__dirname, '..', '..', 'kit', 'runtime');
const APP = path.join(__dirname, '..', '..', 'apps', 'adam_mtrack');
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (req, parent) {
    if (/^\.\/kit\//.test(req) && parent && parent.filename && path.dirname(parent.filename) === APP) return realResolve.call(this, path.join(KIT, req.slice(6)), parent);
    return realResolve.apply(this, arguments);
};
const { createUi } = require('../../apps/adam_mtrack/ui');
Module._resolveFilename = realResolve;
const P = require('../../apps/adam_mtrack/pages');
const C = require('../../apps/adam_mtrack/catalogue');
const W = require('../../apps/adam_mtrack/widgets');
const G = require('../../apps/adam_mtrack/geom');
const U = require('../../apps/adam_mtrack/units');
const cfg = require('../../apps/adam_mtrack/config');
const { Recorder } = require(path.join(KIT, 'record.js'));
const { Canvas } = require(path.join(KIT, 'canvas.js'));
const themes = require(path.join(KIT, 'themes.js'));
const SPEC = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));
const t = themes.theme('m_tricolour');
const item = (k) => SPEC.settings.filter((s) => s.key === k)[0];

function model(saved, more) {
    const vals = {};
    SPEC.settings.forEach((s) => { vals[s.key] = s.default; });
    Object.assign(vals, saved);
    return Object.assign({ get: (k) => vals[k], schema: SPEC.settings, cfg, carMode: 'sportplus', reason: 'off', avail: () => true, version: '0.1.0' }, more);
}
const views = (m) => P.PAGES.map((n, i) => P.view(i, m));
function strings(x, out) {
    out = out || [];
    if (typeof x === 'string') out.push(x);
    else if (Array.isArray(x)) x.forEach((y) => strings(y, out));
    else if (x && typeof x === 'object') Object.keys(x).forEach((k) => { if (k !== 'key' && k !== 'id' && k !== 'writes') strings(x[k], out); });
    return out;
}
function valid(k, v) {
    const s = item(k);
    if (s.type === 'bool') return v === true || v === false;
    if (s.type === 'choice') return s.options.some((o) => o[0] === v);
    return s.steps.indexOf(v) >= 0;
}
const STATES = [{}, { coverOn: true }, { leftPanel: 'coolant', leftLower: 'boost', swapSides: true }, { units: 'metric', bright: 20, nightDim: true },
    { coverOn: 'yes', whenToShow: 9, leftPanel: 'media', rightLower: 'gforce', units: null, bright: 33 },
    { popupGuard: 'ignore', modeMissingDrop: true, speedStaleMs: 3000 }, { popupGuard: 'banana', modeMissingDrop: 'x', speedStaleMs: 7 }];
const REASONS = Object.keys(require('../../apps/adam_mtrack/logic').REASONS);
/** main.js sigNow on a healthy car, and one where every signal reads its longest words. */
const SIG_OK = { speed: 'present', mode: 'sportplus', modeRaw: '2', fes: 'present', cc: 'present', ccUp: 0, ki2: 'present', rpm: 'present', link: 'ready',
    target: 'shown', holder: '', rendering: 'verified', shown: true, art: true, killed: false, tripped: false, errorRecent: false, demo: false };
const SIG_LONG = { speed: 'missing', mode: null, modeRaw: 'SPORT_INDIVIDUAL_XY', fes: 'unoffered', cc: 'unoffered', ccUp: 0, ki2: 'unoffered', rpm: 'unoffered',
    link: 'ready', target: 'waiting', holder: 'foreign', reason: 'parked behind foreign content in slot 0x203 for a long time', shown: false, art: true, killed: true,
    tripped: true, errorRecent: true, demo: true, busy: 'another app\'s content holds slot 0x203', others: ['adam_shiftlights on hud', 'adam_shiftlights on panel', 'robertn_waze on panel'],
    lastError: { op: 'layer', ref: 12, reason: 'the fragment shader did not compile: ERROR: 0:12: syntax error near the end' },
    release: { ok: false, ms: 6012, why: 'cover off', short: 'NOT released: panel shown, adam_shiftlights on hud, adam_shiftlights on panel (6.0 s)' } };
/** The test pattern (ladder.status()) running, refused, and done with a release NOT confirmed, in its longest words. */
const TEST_RUN = { n: 6, name: 'COVER', running: true, state: 'building', line: 'Step 6 COVER building: stage 2 of 4 PANELS: waiting for the renderer to write its art', released: null,
    lines: ['Step 6 COVER: building: stage 2 of 4 PANELS: waiting for the renderer to write its art', 'Panel: waiting (scene id in use by another target); HUD: shown, verified',
        'Layers: 1 waiting (an asset it samples is not written yet), 1 hidden; uploaded 1.3 MB; build 2 of 4', 'Renderer: error layer: the fragment shader did not compile: ERROR: 0:12: syntax error; cap 5500 KB/s; HUD scene was published',
        'Release: checked after the step'] };
const TEST_REFUSED = { n: 4, name: 'IMAGE', running: false, state: 'refused', line: 'Step 4 IMAGE refused: another app is using the cluster', released: null, lines: TEST_RUN.lines };
const TEST_BAD = { n: 2, name: 'BAR', running: false, state: 'done', line: 'Step 2 BAR done: release NOT confirmed', released: false, lines: TEST_RUN.lines };
/** Every text drawn on page i with its left and right edge (the Recorder's own text widths). */
function texts(i, m) {
    const ui = createUi(); ui.tab(i);
    const r = new Recorder(1600, 520, { textScale: 1 }).reset();
    r.own = true; r.chrome = { tabs: null };
    const out = [], orig = r.text.bind(r);
    r.text = (s, x, y, size, c, o) => {
        const w = r.textWidth(String(s), size, o), a = (o && o.align) || 'left';
        const x0 = a === 'center' ? x - w / 2 : a === 'right' ? x - w : x;
        out.push({ s: String(s), x0, x1: x0 + w, y, size });
        return orig(s, x, y, size, c, o);
    };
    ui.draw(r, t, m, () => () => {});
    return { out, r };
}

module.exports = [
    ['every app.json setting but demo sits on exactly one page', () => {
        const seen = {};
        views(model({})).forEach((v) => {
            const keys = (v.card ? [v.card.id] : []).concat((v.rows || []).map((r) => r.id));
            keys.forEach((k) => { seen[k] = (seen[k] || []).concat(v.id); });
        });
        SPEC.settings.filter((s) => s.key !== 'demo').forEach((s) => assert.strictEqual((seen[s.key] || []).length, 1, s.key + ': ' + JSON.stringify(seen[s.key])));
        assert.ok(!seen.demo, 'demo is for the emulator only');
    }],
    ['every control writes only valid values of its own setting; disabled rows have no controls; ASCII only', () => {
        STATES.forEach((st) => REASONS.forEach((reason) => views(model(st, { reason })).forEach((v) => {
            P.controlsOf(v).forEach((c) => c.writes.forEach((w) => assert.ok(valid(w[0], w[1]), v.id + ' ' + c.key + ' writes ' + JSON.stringify(w))));
            (v.rows || []).filter((r) => !r.enabled).forEach((r) => assert.deepStrictEqual(r.controls, [], r.id));
            strings(v).forEach((s) => assert.ok(/^[\x20-\x7e]*$/.test(s), 'non-ASCII: ' + s));
        })));
    }],
    ['Home: the cover card is off by default, the card and the why line follow the decision reason', () => {
        const h = P.view(0, model({}));
        assert.deepStrictEqual([h.card.on, h.card.controls[0].writes], [false, [['coverOn', true]]]);
        assert.strictEqual(h.status.line, 'Why the cover is off right now: Cover the cluster is off');
        assert.ok(/Waiting for Sport\+ \(now Sport\)/.test(P.view(0, model({ coverOn: true }, { reason: 'mode', carMode: 'sport' })).card.state.text));
        assert.ok(/Sport or Sport\+/.test(P.view(0, model({ coverOn: true, whenToShow: 'sport' }, { reason: 'mode', carMode: 'comfort' })).card.state.text));
        assert.ok(/When to show \(Sport and above\): drive mode is Comfort/.test(P.view(0, model({ coverOn: true, whenToShow: 'sport' }, { reason: 'mode', carMode: 'comfort' })).status.line));
        assert.strictEqual(P.view(0, model({ coverOn: true }, { reason: 'nospeed' })).status.tone, 'warn');
        assert.strictEqual(P.view(0, model({ coverOn: true }, { reason: 'tripped' })).status.tone, 'crit');
        assert.deepStrictEqual(P.view(0, model({})).rows[0].controls.map((c) => c.text), ['Sport+ only', 'Sport and above', 'Always']);
        assert.strictEqual(P.view(0, model({ coverOn: true }, { reason: 'showing', sig: Object.assign({}, SIG_OK, { cc: 'missing' }) })).status.signals,
            'Signals: speed present, drive mode Sport+ (present), BMW popups missing (no answer)');
    }],
    ['0.1.6 Look: Tach lead is the last row, a stepper over app.json\'s steps; Off at 0, "<n> ms", " (default)" after the default; the ends stop', () => {
        const def = item('tachLead').default, look = (v) => P.view(2, model({ tachLead: v }));
        const rowOf = (v) => look(v).rows.filter((x) => x.id === 'tachLead')[0];
        const rows = look(def).rows;
        assert.strictEqual(rows[rows.length - 1].id, 'tachLead');
        assert.deepStrictEqual([rowOf(def).kind, rowOf(def).label, rowOf(def).desc], ['stepper', 'Tach lead', 'The rev bar runs ahead to cover slow rpm updates']);
        const shown = (v) => (v === 0 ? 'Off' : v + ' ms') + (v === def ? ' (default)' : '');
        item('tachLead').steps.forEach((v) => assert.strictEqual(rowOf(v).value, shown(v), String(v)));
        assert.ok(/\(default\)$/.test(rowOf(def).value) && !/\(default\)/.test(rowOf(def === 0 ? 40 : 0).value));
        assert.strictEqual(rowOf(0).value.indexOf('Off'), 0);
        assert.deepStrictEqual(rowOf(0).controls.map((c) => c.end), [true, false], 'Off: minus stops');
        assert.deepStrictEqual(rowOf(80).controls.map((c) => c.end), [false, true], '80: plus stops');
        assert.deepStrictEqual(rowOf(0).controls[1].writes, [['tachLead', 20]]);
        assert.strictEqual(rowOf(55).value, shown(def), 'a bad saved value shows the default it falls back to');
    }],
    ['Safety: its own tab between Look and About with the three Safety settings; the always-on guards have no control', () => {
        assert.deepStrictEqual(P.PAGES, ['Home', 'Panels', 'Look', 'Safety', 'About']);
        const v = P.view(3, model({}, { sig: SIG_OK }));
        assert.strictEqual(v.id, 'safety');
        assert.deepStrictEqual(v.rows.map((r) => r.id), ['popupGuard', 'modeMissingDrop', 'speedStaleMs', 'test']);
        assert.deepStrictEqual(P.controlsOf(v).map((c) => c.key.split(':')[1]).filter((k, i, a) => a.indexOf(k) === i), ['popupGuard', 'modeMissingDrop', 'speedStaleMs', 'test']);
        assert.deepStrictEqual(v.rows[0].controls.map((c) => [c.text, c.on]), [['Use if sent', true], ['Require', false], ['Ignore', false]], 'default Use if sent');
        assert.deepStrictEqual(v.rows[0].controls.map((c) => c.writes), [[], [['popupGuard', 'require']], [['popupGuard', 'ignore']]]);
        assert.deepStrictEqual([v.rows[1].controls[0].on, v.rows[1].controls[0].writes], [false, [['modeMissingDrop', true]]]);
        assert.deepStrictEqual(v.rows.slice(0, 3).map((r) => r.desc.length > 20 && /Protects|Always on/.test(r.desc)), [true, true, true], 'each says what it protects');
        assert.ok(/Off: /.test(v.rows[1].desc), 'and what happens when off');
        const locked = v.blocks[1].lines.map((l) => l.text).join('\n');
        ['Speed timeout: on, 1 s', 'Kill switch (DISABLE file): clear', 'Errors: none', 'Cover: not built yet; dead-man at 1 while shown', 'Exit or crash', 'Clock jump', 'Demo data'].forEach((w) => assert.ok(locked.indexOf(w) >= 0, w));
        assert.ok(/no switch/.test(v.blocks[1].title));
        const lo = P.view(3, model({ speedStaleMs: 500 })).rows[2].controls, hi = P.view(3, model({ speedStaleMs: 3000 })).rows[2].controls;
        assert.deepStrictEqual([lo[0].writes, lo[1].writes, hi[0].writes, hi[1].writes], [[], [['speedStaleMs', 1000]], [['speedStaleMs', 2500]], []], 'the timeout steps only inside 0.5 to 3 s');
    }],
    ['Safety: the test pattern row: a pill per step and STOP, each an action that writes no setting; the running step lit; its result replaces the guards block; a press passes the action', () => {
        const v = P.view(3, model({}, { sig: SIG_OK })), row = v.rows.filter((x) => x.id === 'test')[0];
        assert.deepStrictEqual(row.controls.map((c) => [c.text, c.action, c.writes.length, c.on]),
            [['1 KNOWN', 'test:1', 0, false], ['2 BAR', 'test:2', 0, false], ['3 TINT', 'test:3', 0, false], ['4 IMAGE', 'test:4', 0, false], ['5 TACHS', 'test:5', 0, false], ['6 COVER', 'test:6', 0, false], ['STOP', 'test:stop', 0, false]]);
        assert.strictEqual(row.desc, 'Parked, cover off: each step shows 10 s, then removes itself');
        assert.strictEqual(v.blocks[1].title, 'Always on (no switch), and why');
        const run = P.view(3, model({}, { sig: Object.assign({}, SIG_OK, { test: TEST_RUN }) })), r2 = run.rows.filter((x) => x.id === 'test')[0];
        assert.deepStrictEqual(r2.controls.filter((c) => c.on).map((c) => c.text), ['6 COVER']);
        assert.deepStrictEqual([r2.desc, r2.value, r2.tone], [TEST_RUN.line, 'Step 6', 'on']);
        assert.strictEqual(run.blocks[1].title, 'Test pattern: what cluster-render said');
        assert.deepStrictEqual(run.blocks[1].lines.map((l) => l.text), TEST_RUN.lines);
        const bad = P.view(3, model({}, { sig: Object.assign({}, SIG_OK, { test: TEST_BAD }) }));
        assert.deepStrictEqual([bad.rows[3].tone, bad.blocks[1].lines[4].tone], ['warn', 'warn'], 'a release NOT confirmed stands out');
        assert.strictEqual(P.view(3, model({}, { sig: Object.assign({}, SIG_OK, { test: TEST_REFUSED }) })).rows[3].tone, 'warn');
        const got = [], ui = createUi();
        ui.tab(3);
        const r = new Recorder(1600, 520, { textScale: 1 }).reset();
        r.own = true; r.chrome = { tabs: null };
        ui.draw(r, t, model({}, { sig: SIG_OK }), (writes, action) => { got.push([writes.length, action]); return () => {}; });
        ['test:1', 'test:2', 'test:3', 'test:4', 'test:5', 'test:6', 'test:stop'].forEach((a) => assert.ok(got.some((g) => g[1] === a && g[0] === 0), a));
        assert.ok(['safety:test:1', 'safety:test:6', 'safety:test:stop'].every((k) => r.targets.some((x) => x.key === k)), 'each pill can be pressed');
        const rel = P.view(3, model({}, { sig: Object.assign({}, SIG_OK, { release: { ok: true, why: 'cover off', short: 'Released: panel idle 3.1 s after, status lists none of ours' } }) }));
        assert.deepStrictEqual([rel.blocks[1].lines[4].text, rel.blocks[1].lines[4].tone], ['Last release (cover off): panel idle 3.1 s after, status lists none of ours', 'dim']);
    }],
    ['Home and Safety while the cover builds: the stage under way; a stopped build says where and why, also behind the error guard and the trip; shown: every stage and the dead-man', () => {
        const building = { state: 'writing', n: 2, of: 4, name: 'PANELS', word: 'waiting for the renderer to write its art', why: '', stop: null };
        const stop = { n: 3, of: 4, name: 'CENTRE', why: 'refused: layer: the shader did not compile' };
        const m = (reason, build) => model({ coverOn: true }, { reason, sig: Object.assign({}, SIG_OK, { build }) });
        assert.strictEqual(P.view(0, m('showing', building)).card.state.text, 'Building the cover: stage 2 of 4 PANELS: waiting for the renderer to write its art');
        assert.strictEqual(P.whyOf(m('showing', building)).text, 'Building the cover: stage 2 of 4 PANELS: waiting for the renderer to write its art');
        const st = { state: 'stopped', n: 3, of: 4, name: 'CENTRE', word: 'stopped', why: stop.why, stop };
        assert.strictEqual(P.whyOf(m('showing', st)).text, 'Cover build stopped at stage 3 of 4 CENTRE: refused: layer: the shader did not compile');
        assert.strictEqual(P.whyOf(m('showing', st)).tone, 'warn');
        assert.ok(/^Why the cover is off right now: Error guard: .* \(last build stopped at stage 3 of 4 CENTRE: refused: layer: the shader did not compile\)$/.test(P.whyOf(m('error', st)).text), P.whyOf(m('error', st)).text);
        assert.ok(/Error guard: stopped after 5 errors\..*\(last build stopped at stage 3 of 4 CENTRE/.test(P.whyOf(m('tripped', st)).text), P.whyOf(m('tripped', st)).text);
        const line = (b) => P.view(3, m('showing', b)).blocks[1].lines[3].text;
        assert.strictEqual(line(building), 'Cover build: stage 2 of 4 PANELS: waiting for the renderer to write its art');
        assert.strictEqual(line(st), 'Cover build: stopped at stage 3 of 4 CENTRE: refused: layer: the shader did not compile');
        assert.strictEqual(line({ state: 'shown', n: 4, of: 4, name: '', word: 'shown', why: '', stop: null }), 'Cover: 4 of 4 stages shown; dead-man at 1, re-armed every 0.06 s');
        assert.strictEqual(P.whyOf(m('showing', { state: 'shown', n: 4, of: 4 })).text, 'Showing on the cluster: every guard holds');
    }],
    ['Safety: risky choices are flagged (Ignore, a timeout over 1 s); a bad saved value shows the strict choice and says so', () => {
        const ig = P.view(3, model({ popupGuard: 'ignore' })).rows[0];
        assert.ok(ig.tone === 'crit' && /RISKY/.test(ig.desc), ig.desc);
        const t2 = P.view(3, model({ speedStaleMs: 2000 })).rows[2];
        assert.ok(t2.tone === 'warn' && /RISKY/.test(t2.desc) && /2 s/.test(t2.desc) && t2.value === '2 s', t2.desc);
        assert.strictEqual(P.view(3, model({})).rows[2].tone, undefined);
        assert.strictEqual(P.view(3, model({})).rows[0].tone, undefined);
        const b = P.view(3, model({ popupGuard: 'banana', modeMissingDrop: 'x', speedStaleMs: 7 })).rows;
        assert.deepStrictEqual(b[0].controls.filter((c) => c.on).map((c) => c.text), ['Require']);
        assert.ok(/not valid: Require/.test(b[0].desc) && b[0].tone === 'warn');
        assert.ok(b[1].controls[0].on === true && /not valid: On/.test(b[1].desc));
        assert.ok(b[2].value === '1 s' && /not valid: 1 s/.test(b[2].desc));
    }],
    ['why the cover is off, on Home and Safety: the blocking guard by name and its signal status, for every reason', () => {
        const cases = [
            ['off', {}, /Cover the cluster is off/], ['kill', { killed: true }, /Kill switch: the DISABLE file is there/],
            ['tripped', { tripped: true }, /Error guard: stopped after 5 errors/], ['demo', { demo: true }, /this is demo data/],
            ['noart', { art: false }, /Art check: the art file is missing/], ['renderer', { link: 'none' }, /Cluster renderer: not connected/],
            ['nocc', { cc: 'missing' }, /BMW popups \(Require\): the popup signal is missing \(no answer\)/],
            ['nocc', { cc: 'unoffered' }, /the popup signal is missing \(not offered on this unit\)/],
            ['nocc', { cc: 'waiting' }, /the popup signal is not answered yet/],
            ['ccwait', { cc: 'waiting' }, /BMW popups: waiting for the popup signal \(up to 10 s after start\)/],
            ['cc', { ccUp: 1 }, /BMW popups: a Check Control message is up \(popup signal present\)/],
            ['cc', { ccUp: 0 }, /BMW popups: a new Check Control message \(popup signal present\)/],
            ['held', { target: 'waiting', holder: 'stock' }, /BMW panel: BMW holds the cluster panel \(a popup or the speech dialog\), asks again in 10 s/],
            ['busy', { busy: 'the HUD is shown', others: ['adam_shiftlights on hud'] }, /^Why the cover is off right now: Another app is using the cluster: turn off Shift Lights cluster\/HUD$/],
            ['nospeed', { speed: 'missing' }, /Speed timeout: speed signal missing \(none received yet\)/],
            ['nospeed', { speed: 'stale' }, /Speed timeout: speed signal stale \(none for 1 s\)/],
            ['error', { errorRecent: true }, /Error guard: an error a moment ago/],
            ['nomode', { mode: null, modeRaw: undefined, fes: 'missing' }, /Drop if no drive mode \(on\): the drive-mode signal is missing \(no answer\)/],
            ['mode', { mode: 'comfort' }, /When to show \(Sport\+ only\): drive mode is Comfort \(signal present\)/],
            ['mode', { mode: null, modeRaw: '0' }, /When to show \(Sport\+ only\): the drive-mode signal is missing \(the car sends 0, no mode\)/],
        ];
        cases.forEach((c) => {
            const sig = Object.assign({}, SIG_OK, c[1]);
            const m = model({ coverOn: c[0] !== 'off', popupGuard: c[0] === 'nocc' ? 'require' : 'auto', modeMissingDrop: c[0] === 'nomode' }, { reason: c[0], sig, carMode: sig.mode });
            [P.view(0, m).status.line, P.view(3, m).note].forEach((line) => {
                assert.ok(/^Why the cover is off right now: /.test(line) && c[2].test(line), c[0] + ': ' + line);
            });
        });
        assert.strictEqual(P.view(3, model({ coverOn: true }, { reason: 'showing', sig: SIG_OK })).note, 'Showing on the cluster: every guard holds');
        assert.ok(/^Showing in a moment/.test(P.view(0, model({ coverOn: true }, { reason: 'hold', sig: SIG_OK })).status.line));
        REASONS.forEach((r) => assert.ok(!/undefined|NaN/.test(P.whyOf(model({}, { reason: r })).text), r + ': ' + P.whyOf(model({}, { reason: r })).text));
    }],
    ['Safety signals: every signal the guards read, present and idle told apart from missing, stale shown as stale', () => {
        const lines = (sig) => P.view(3, model({}, { sig, carMode: sig.mode })).blocks[0].lines.map((l) => l.text);
        const a = lines(Object.assign({}, SIG_OK, { speed: 'stale', cc: 'missing', ki2: 'present', mode: null, modeRaw: undefined, fes: 'unoffered' }));
        ['Speed (Vehicle2): stale (none for 1 s)', 'Popup list (CheckControlMaster): missing (no answer); new-popup event: present',
            'Drive mode (FES): missing (not offered on this unit)', 'Engine rpm (CDS): present; car data: live', 'Cluster renderer: connected, panel shown (verified)']
            .forEach((x) => assert.ok(a.indexOf(x) >= 0, x + ' in ' + JSON.stringify(a)));
        const has = (ls, x) => ls.some((l) => l.indexOf(x) === 0);
        assert.ok(has(lines(Object.assign({}, SIG_OK, { cc: 'present', ccUp: 0 })), 'Popup list (CheckControlMaster): present, none up;'), 'present and idle');
        assert.ok(has(lines(Object.assign({}, SIG_OK, { cc: 'present', ccUp: 2 })), 'Popup list (CheckControlMaster): present, 2 up;'));
        // what cluster-render says: another app on the shared scene (named from its status), BMW holding the panel, an error event
        assert.ok(has(lines(Object.assign({}, SIG_OK, { busy: 'the HUD is shown', others: ['adam_shiftlights on hud'] })), 'Cluster renderer: another app is using the cluster (adam_shiftlights on hud)'));
        assert.ok(has(lines(Object.assign({}, SIG_OK, { busy: 'the HUD is waiting', others: [] })), 'Cluster renderer: another app is using the cluster (the HUD is waiting)'));
        assert.ok(has(lines(Object.assign({}, SIG_OK, { target: 'parked', holder: 'stock', reason: 'parked behind stock' })), 'Cluster renderer: BMW holds the panel (parked behind stock)'));
        assert.ok(has(lines(Object.assign({}, SIG_OK, { lastError: { op: 'layer', ref: 3, reason: 'fs: compile failed' } })), 'Cluster renderer: connected, panel shown (verified); error: fs: compile failed'));
        assert.ok(has(lines(Object.assign({}, SIG_OK, { target: 'idle', hud: 'shown' })), 'Cluster renderer: connected, panel free, HUD shown'));
        assert.ok(lines(Object.assign({}, SIG_OK, { speed: 'missing' })).indexOf('Speed (Vehicle2): missing (none received yet)') >= 0);
        const tone = (reason, i) => P.view(3, model({}, { reason, sig: SIG_OK })).blocks[0].lines[i].tone;
        assert.deepStrictEqual([tone('nospeed', 0), tone('mode', 1), tone('ccwait', 2), tone('showing', 2)], ['warn', 'warn', 'warn', 'dim'], 'the blocking signal stands out');
    }],
    ['every page fits: no text off the canvas or out of its Safety block; row texts clear of their controls; Home\'s status texts apart', () => {
        const PILL_OPT = { font: 'bold', spacing: 1.5 };
        const SIGS = [SIG_OK, SIG_LONG].concat([TEST_RUN, TEST_REFUSED, TEST_BAD].map((test) => Object.assign({}, SIG_LONG, { test })));
        STATES.concat([{ coverOn: true, whenToShow: 'sport', popupGuard: 'require' }]).forEach((st) => ['mode', 'tripped', 'nomode', 'nocc', 'ccwait', 'cc', 'busy', 'held', 'renderer'].forEach((reason) => SIGS.forEach((sig) => {
            const m = model(st, { reason, sig, carMode: sig.mode });
            for (let i = 0; i < P.PAGES.length; i++) {
                const { out, r } = texts(i, m), v = P.view(i, m);
                out.forEach((x) => assert.ok(x.x0 >= 0 && x.x1 <= 1580, P.IDS[i] + ' off the canvas: ' + x.s + ' ' + Math.round(x.x0) + '..' + Math.round(x.x1)));
                (v.rows || []).forEach((row) => {
                    if (!row.desc) return;
                    const d = out.filter((x) => x.s === row.desc)[0];
                    const ctl = row.kind === 'toggle' ? 76 : row.kind === 'stepper' ? 404
                        : row.controls.reduce((a, c) => a + Math.max(104, Math.ceil(r.textWidth(String(c.text).toUpperCase(), 44 * 0.4, PILL_OPT)) + 40) + 10, -10);
                    assert.ok(d && d.x1 < 1542 - ctl - 10, P.IDS[i] + ' ' + row.id + ' desc runs into its controls: ' + row.desc);
                });
                if (v.id === 'safety') {
                    out.filter((x) => x.y > 372).forEach((x) => assert.ok(x.x0 < 800 ? x.x1 <= 40 + 750 - 12 : x.x1 <= 1560 - 12, 'out of its block: ' + x.s));
                    out.filter((x) => x.y > 372).forEach((x) => assert.ok(x.y + 4 <= 514, 'below the page: ' + x.s));
                    assert.ok(v.blocks.every((b) => b.lines.length <= 5), 'at most 5 lines a block');
                }
                if (v.id === 'home') {
                    const sig2 = out.filter((x) => x.s === v.status.signals)[0], hint = out.filter((x) => /Safety tab$/.test(x.s))[0];
                    assert.ok(sig2 && hint && sig2.x1 < hint.x0 - 20, 'Home: signals line runs into the hint: ' + v.status.signals);
                }
            }
        })));
    }],
    ['widget pickers: step only through selectable widgets with a signal, both ways; never onto a hidden one; ends clamp', () => {
        const noTyres = (id) => id !== 'tyres' && id !== 'trip';
        const steps = P.choices(model({}, { avail: noTyres }), false);
        assert.ok(steps.indexOf('tyres') < 0 && steps.indexOf('trip') < 0 && steps.indexOf('gforce') >= 0);
        C.hidden().forEach((id) => assert.ok(steps.indexOf(id) < 0, id));
        assert.ok(P.choices(model({}), true).every((id) => C.get(id).kind === 'half'), 'lower halves: halves only');
        let v = 'gforce';
        for (let i = 0; i < 40; i++) { const m = model({ leftPanel: v }, { avail: noTyres }); const r = P.view(1, m).rows[0]; const w = r.controls[1].writes; if (!w.length) break; v = w[0][1]; assert.ok(steps.indexOf(v) >= 0, v); }
        assert.strictEqual(v, steps[steps.length - 1]);
        const r = P.view(1, model({ leftPanel: 'tyres' }, { avail: noTyres })).rows[0];
        assert.ok(r.greyed && /No signal/.test(r.desc), 'a selected widget without a signal reads No signal');
        assert.strictEqual(P.view(1, model({ leftPanel: 'tyres' })).rows[1].enabled, false, 'lower half under a whole widget');
        assert.ok(/Used by Tyre data/.test(P.view(1, model({ leftPanel: 'tyres' })).rows[1].desc));
    }],
    ['every page drawn on the GPU Recorder (own: tabs, targets) and the software Canvas (read-only Home) without a throw', () => {
        STATES.forEach((st) => {
            const m = model(st, { reason: 'mode' });
            for (let i = 0; i < P.PAGES.length; i++) {
                const ui = createUi(); ui.tab(i);
                const r = new Recorder(1600, 520, { textScale: 1 }).reset();
                r.own = true; r.chrome = { tabs: null };
                ui.draw(r, t, m, () => () => {});
                assert.ok(r.words().length > 10, 'page ' + i);
            }
            const cv = new Canvas(1600, 520).clear(t.bg);
            createUi().draw(cv, t, m);
            assert.ok(cv.d.some((x) => x > 0));
        });
    }],
    ['every selectable widget drawn in a panel, US and metric, with data and without; the corners too', () => {
        const v = { coolant: 90, oil: 100, boost: 0.8, torque: 400, kw: 200, fuelL: 30, rangeKm: 400, ambient: 18, tyres: { p: [2.3, 2.3, 2.4, 2.4], t: [20, 21, 19, 20] },
            trip: { km: 120, h: 1, m: 4, avgKmh: 70, avgL100: 9.5 }, timer: { last: 5.1, best: 4.9 }, peaks: { right: 0.4, brake: 0.6, left: 0.3, accel: 0.4 }, gLat: 0.2, gLong: -0.1, mode: 'sport', clock: { h: 9, m: 5 } };
        const R = G.RECTS.panelR, cv = new Canvas(R.w, R.h);
        ['us', 'metric'].forEach((un) => {
            const u = U.resolve(un);
            C.CATALOGUE.forEach((w) => [v, {}].forEach((vals) => [true, false].forEach((a) => {
                const lay = w.kind === 'whole' ? { full: w.id } : { upper: w.id, lower: 'oil' };
                W.drawPanel(cv, R, 1, lay, vals, u, () => a, cfg);
                if (w.draw !== 'none') assert.ok(cv.d.some((x) => x > 0), w.id + ' drew nothing');
            })));
            [-1, 1].forEach((side) => {
                const r = side < 0 ? G.RECTS.cornerL : G.RECTS.cornerR, c = new Canvas(r.w, r.h);
                W.drawCorner(c, r, side, Buffer.alloc(r.w * r.h * 4), v, u, cfg);
                W.drawCorner(c, r, side, Buffer.alloc(r.w * r.h * 4), {}, u, cfg);
            });
        });
    }],    ['0.1.7 style: a strip is Codex\'s: a thin #626875 baseline, #acb0bd labels, a #d0d3db indicator, no fill bar', () => {
        const R = G.RECTS.panelL, cv = new Canvas(R.w, R.h), u = U.resolve('us'), sr = G.slotRect(-1, 'upper');
        W.drawPanel(cv, R, -1, { upper: 'coolant', lower: 'oil' }, { coolant: 60, oil: 40 }, u, () => true, cfg);
        const y = Math.round(sr.y0 + sr.h * 0.6), at = (px, py) => Array.from(cv.d.slice(((py - R.y) * R.w + px - R.x) * 4, ((py - R.y) * R.w + px - R.x) * 4 + 4));
        const p = at(sr.x0 + 160, y - 1), q = at(sr.x0 + 160, y);
        assert.ok([p, q].some((c) => c[3] > 120 && Math.abs(c[0] - 0x62) < 12 && Math.abs(c[2] - 0x75) < 12), 'baseline pixel ' + p + ' / ' + q);
        assert.strictEqual(at(sr.x0 + 160, y - 5)[3], 0, 'no fill bar over the baseline');
        const ind = at(sr.x0 + 10, y - 7);      // 60 C (140 F) is under the scale's 160 F: the indicator at the left end
        assert.ok(ind[3] > 200 && ind[0] > 0xc0, 'indicator pixel ' + ind);
        let label = 0;
        for (let xx = sr.x0; xx < sr.x1; xx++) { const c = at(xx, y + 24); if (c[3] > 200 && Math.abs(c[0] - 0xac) < 14) label++; }
        assert.ok(label > 5, '#acb0bd label pixels ' + label);
    }],
];
