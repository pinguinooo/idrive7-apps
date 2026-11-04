'use strict';
/* view.js (the centre-screen preview) drawn for every style pair, lit, red and flashing, on both surfaces the
 * kit hands an app: the GPU Recorder (ctx.canvas() while the renderer runs) and the software Canvas. The app's
 * ./kit/* modules resolve to the pinned kit (the vendored kit, kit/runtime). A throw here
 * would be a guarded draw error on the car, and five of them stop all output. */
const assert = require('assert');
const path = require('path');
const Module = require('module');
const KIT = path.join(__dirname, '..', '..', 'kit', 'runtime');
const APP = path.join(__dirname, '..', '..', 'apps', 'adam_shiftlights');
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (req, parent) {
    if (/^\.\/kit\//.test(req) && parent && parent.filename && path.dirname(parent.filename) === APP) return realResolve.call(this, path.join(KIT, req.slice(6)), parent);
    return realResolve.apply(this, arguments);
};
const view = require('../../apps/adam_shiftlights/view');
Module._resolveFilename = realResolve;
const { Recorder, OP } = require(path.join(KIT, 'record.js'));
const { Canvas } = require(path.join(KIT, 'canvas.js'));
const themes = require(path.join(KIT, 'themes.js'));
const L = require('../../apps/adam_shiftlights/logic');
const cfg = L.validateConfig(require('../../apps/adam_shiftlights/config')).cfg;

const th = L.thresholds(cfg, cfg.modes.sportplus, 95);
const sel = (c, h) => ({ cluster: { style: c, size: 120, bright: 60, night: false }, hud: { style: h, size: 80, bright: 100, night: true } });
const state = (lit, flashing, t0) => ({ lit, red: lit > 0, flashing, flashT0: t0 });
const model = (c, h, st, now) => ({
    cfg, now, rpm: 6850, oil: 95, gear: 3, demo: false, mt: L.modeThresholds(cfg, () => 0, 'sportplus'), th, states: { cluster: st, hud: st },
    sel: sel(c, h), display: 'both', offReason: '', link: { link: 'ready', layers: { 'map slats': 'shown' } },
});
const STATES = [[state(0, false, null), 0], [state(4, false, null), 0], [state(8, false, null), 0], [state(10, true, 0), 10], [state(10, true, 0), 130]];

module.exports = [
    ['preview: every style pair and state draws on the GPU Recorder and the software Canvas without a throw', () => {
        const t = themes.theme('m_tricolour');
        let quads = 0;
        L.CLUSTER_STYLES.forEach((c) => L.HUD_STYLES.forEach((h) => STATES.forEach((s) => {
            const r = new Recorder(1600, 520, { textScale: 1 }).reset();
            view.draw(r, t, model(c, h, s[0], s[1]));
            const w = r.words();
            for (let i = 0; i < w.length; i++) if (w[i] === OP.QUAD) quads++;
            view.draw(new Canvas(1600, 520).clear(t.bg), t, model(c, h, s[0], s[1]));
        })));
        assert.ok(quads > 0);
    }],
    ['preview: a lit cluster slat is drawn in its colour x brightness (software Canvas, M slats large at 120 %)', () => {
        const t = themes.theme('m_tricolour'), cv = new Canvas(1600, 520).clear(t.bg);
        view.draw(cv, t, model('large', 'off', state(10, false, null), 0));
        // the outermost left slat at size 120 %: base x 400 - 262.8 .. +18.72, half way up moved 35.77 / 2 toward
        // the axis, so its middle is at x 164, y 207 (the preview box's centre line)
        const px = (x, y) => Array.prototype.slice.call(cv.d, (y * 1600 + x) * 4, (y * 1600 + x) * 4 + 3);
        const want = cfg.colors.a;
        const exp = [1, 3, 5].map((i) => Math.round(parseInt(want.slice(i, i + 2), 16) * 0.6));
        const got = px(164, 207);
        exp.forEach((v, i) => assert.ok(Math.abs(v - got[i]) <= 3, 'got ' + got + ' want ' + exp));
    }],
    ['preview: oil shows in F for the US car (95 C -> OIL 203 F)', () => {
        const t = themes.theme('m_tricolour'), cv = new Canvas(1600, 520).clear(t.bg), texts = [], text = cv.text;
        cv.text = function (s) { texts.push(String(s)); return text.apply(this, arguments); };
        view.draw(cv, t, model('large', 'large', state(0, false, null), 0));
        assert.ok(texts.some((s) => s.indexOf('OIL 203 F') >= 0), texts.join(' | '));
    }],
];
