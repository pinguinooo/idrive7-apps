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
    target: 'shown', holder: '', shown: true, art: true, killed: false, tripped: false, errorRecent: false, demo: false };
const SIG_LONG = { speed: 'missing', mode: null, modeRaw: 'SPORT_INDIVIDUAL_XY', fes: 'unoffered', cc: 'unoffered', ccUp: 0, ki2: 'unoffered', rpm: 'unoffered',
    link: 'ready', target: 'waiting', holder: 'foreign', shown: false, art: true, killed: true, tripped: true, errorRecent: true, demo: true };
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
    ['Safety: its own tab between Look and About with the three Safety settings; the always-on guards have no control', () => {
        assert.deepStrictEqual(P.PAGES, ['Home', 'Panels', 'Look', 'Safety', 'About']);
        const v = P.view(3, model({}, { sig: SIG_OK }));
        assert.strictEqual(v.id, 'safety');
        assert.deepStrictEqual(v.rows.map((r) => r.id), ['popupGuard', 'modeMissingDrop', 'speedStaleMs']);
        assert.deepStrictEqual(P.controlsOf(v).map((c) => c.key.split(':')[1]).filter((k, i, a) => a.indexOf(k) === i), ['popupGuard', 'modeMissingDrop', 'speedStaleMs']);
        assert.deepStrictEqual(v.rows[0].controls.map((c) => [c.text, c.on]), [['Use if sent', true], ['Require', false], ['Ignore', false]], 'default Use if sent');
        assert.deepStrictEqual(v.rows[0].controls.map((c) => c.writes), [[], [['popupGuard', 'require']], [['popupGuard', 'ignore']]]);
        assert.deepStrictEqual([v.rows[1].controls[0].on, v.rows[1].controls[0].writes], [false, [['modeMissingDrop', true]]]);
        assert.deepStrictEqual(v.rows.map((r) => r.desc.length > 20 && /Protects|Always on/.test(r.desc)), [true, true, true], 'each says what it protects');
        assert.ok(/Off: /.test(v.rows[1].desc), 'and what happens when off');
        const locked = v.blocks[1].lines.map((l) => l.text).join('\n');
        ['Speed timeout: on, 1 s', 'Kill switch (DISABLE file): clear', 'Errors: none', 'Heartbeat: running', 'Exit or crash', 'Clock jump', 'Demo data'].forEach((w) => assert.ok(locked.indexOf(w) >= 0, w));
        assert.ok(/no switch/.test(v.blocks[1].title));
        const lo = P.view(3, model({ speedStaleMs: 500 })).rows[2].controls, hi = P.view(3, model({ speedStaleMs: 3000 })).rows[2].controls;
        assert.deepStrictEqual([lo[0].writes, lo[1].writes, hi[0].writes, hi[1].writes], [[], [['speedStaleMs', 1000]], [['speedStaleMs', 2500]], []], 'the timeout steps only inside 0.5 to 3 s');
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
            ['held', { target: 'waiting', holder: 'stock' }, /BMW panel: BMW holds the cluster panel/],
            ['hud', { target: 'waiting', holder: 'foreign' }, /Shift Lights' HUD holds the cluster scene/],
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
        ['Speed (Vehicle2): stale (none for 1 s)', 'Popup list (CheckControlMaster): missing (no answer)', 'New-popup event (KombiInterface_2): present',
            'Drive mode (FES): missing (not offered on this unit)', 'Engine rpm (CDS): present', 'Car data: live', 'Cluster renderer: connected, panel free']
            .forEach((x) => assert.ok(a.indexOf(x) >= 0, x + ' in ' + JSON.stringify(a)));
        assert.ok(lines(Object.assign({}, SIG_OK, { cc: 'present', ccUp: 0 })).indexOf('Popup list (CheckControlMaster): present, none up') >= 0, 'present and idle');
        assert.ok(lines(Object.assign({}, SIG_OK, { cc: 'present', ccUp: 2 })).indexOf('Popup list (CheckControlMaster): present, 2 up') >= 0);
        assert.ok(lines(Object.assign({}, SIG_OK, { speed: 'missing' })).indexOf('Speed (Vehicle2): missing (none received yet)') >= 0);
        const tone = (reason, i) => P.view(3, model({}, { reason, sig: SIG_OK })).blocks[0].lines[i].tone;
        assert.deepStrictEqual([tone('nospeed', 0), tone('mode', 1), tone('ccwait', 2), tone('showing', 2)], ['warn', 'warn', 'warn', 'dim'], 'the blocking signal stands out');
    }],
    ['every page fits: no text off the canvas or out of its Safety block; row texts clear of their controls; Home\'s status texts apart', () => {
        const PILL_OPT = { font: 'bold', spacing: 1.5 };
        STATES.concat([{ coverOn: true, whenToShow: 'sport', popupGuard: 'require' }]).forEach((st) => ['mode', 'tripped', 'nomode', 'nocc', 'ccwait', 'cc', 'hud', 'renderer'].forEach((reason) => [SIG_OK, SIG_LONG].forEach((sig) => {
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
                    out.filter((x) => x.y > 302).forEach((x) => assert.ok(x.x0 < 800 ? x.x1 <= 40 + 750 - 12 : x.x1 <= 1560 - 12, 'out of its block: ' + x.s));
                    assert.ok(v.blocks.every((b) => b.lines.length <= 7), 'at most 7 lines a block');
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
    }],
];
