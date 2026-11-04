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
    { coverOn: 'yes', whenToShow: 9, leftPanel: 'media', rightLower: 'gforce', units: null, bright: 33 }];
const REASONS = Object.keys(require('../../apps/adam_mtrack/logic').REASONS);

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
    ['Home: the cover card is off by default, the status follows the decision reason', () => {
        const h = P.view(0, model({}));
        assert.deepStrictEqual([h.card.on, h.card.controls[0].writes], [false, [['coverOn', true]]]);
        assert.ok(/Waiting for Sport\+ \(now Sport\)/.test(P.view(0, model({ coverOn: true }, { reason: 'mode', carMode: 'sport' })).status.line));
        assert.ok(/Sport or Sport\+/.test(P.view(0, model({ coverOn: true, whenToShow: 'sport' }, { reason: 'mode', carMode: 'comfort' })).status.line));
        assert.strictEqual(P.view(0, model({ coverOn: true }, { reason: 'nospeed' })).status.tone, 'warn');
        assert.strictEqual(P.view(0, model({ coverOn: true }, { reason: 'tripped' })).status.tone, 'crit');
        assert.deepStrictEqual(P.view(0, model({})).rows[0].controls.map((c) => c.text), ['Sport+ only', 'Sport and above', 'Always']);
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
