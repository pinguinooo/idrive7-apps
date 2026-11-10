'use strict';
/* ui.js (the settings pages) on both surfaces the kit hands an app: the GPU Recorder where the kit runs the screen
 * (own: tabs in the header, page buttons as targets) and the software Canvas (read-only Home). The knob goes
 * through the header's tabs, then the page's targets in drawing order (display.js _ring): that order is written out
 * here per page. A throw here would be a guarded draw error on the car. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const KIT = path.join(__dirname, '..', '..', 'kit', 'runtime');
const APP = path.join(__dirname, '..', '..', 'apps', 'adam_shiftlights');
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (req, parent) {
    if (/^\.\/kit\//.test(req) && parent && parent.filename && path.dirname(parent.filename) === APP) return realResolve.call(this, path.join(KIT, req.slice(6)), parent);
    return realResolve.apply(this, arguments);
};
const { createUi } = require('../../apps/adam_shiftlights/ui');
Module._resolveFilename = realResolve;
const { Recorder, OP } = require(path.join(KIT, 'record.js'));
const { Canvas } = require(path.join(KIT, 'canvas.js'));
const themes = require(path.join(KIT, 'themes.js'));
const L = require('../../apps/adam_shiftlights/logic');
const cfg = L.validateConfig(require('../../apps/adam_shiftlights/config')).cfg;
const SPEC = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));
const t = themes.theme('m_tricolour');

function model(saved, more) {
    const vals = {};
    SPEC.settings.forEach((s) => { vals[s.key] = s.default; });
    Object.assign(vals, saved);
    return Object.assign({ get: (k) => vals[k], schema: SPEC.settings, cfg, carMode: null, offReason: '', version: '0.4.0' }, more);
}
/** Page i drawn where the kit runs the screen: the Recorder, its targets, and the writes each target ran. */
function own(i, m, ui) {
    const u = ui || createUi();
    if (i !== undefined) u.tab(i);
    const r = new Recorder(1600, 520, { textScale: 1 }).reset();
    r.own = true; r.chrome = { tabs: null };
    const ran = [];
    u.draw(r, t, m, (writes, cmd) => () => { ran.push(cmd ? { cmd, writes } : writes); });
    return { r, keys: r.targets.map((g) => g.key), ran, run: (k) => { r.targets.filter((g) => g.key === k)[0].run(); return ran[ran.length - 1]; } };
}
const STATES = [{}, { hudOn: true }, { clusterOn: true }, { hudOn: true, clusterOn: true, bothMode: 'map' }, { onlySportPlus: true, hudOn: true },
    { hudOn: 'yes', hudStyle: {}, hudSize: 999, leadMs: 'x', comfortShift: 999, layout: 7, demo: null, driveMode: 9 }];
const MORE = [{}, { carMode: 'sportplus', offReason: 'WAITING FOR SPORT+ (now SPORT)' }, { offReason: 'STOPPED after errors: turn HUD or cluster off and on' }];
const pm = (page, key, ids) => ids.map((id) => page + ':' + key + ':' + id);
const st = (page, key) => [page + ':' + key + ':-', page + ':' + key + ':+'];

module.exports = [
    ['every page in every state draws on the GPU Recorder and the software Canvas without a throw (no convex)', () => {
        STATES.forEach((s) => MORE.forEach((more) => [0, 1, 2, 3, 4, 5].forEach((i) => {
            const m = model(s, more), { r } = own(i, m);
            const w = r.words();
            assert.ok(w.length > 100, 'page ' + i + ' drew');
            const u = createUi();
            u.tab(i);
            u.draw(new Canvas(1600, 520).clear(t.bg), t, m);
        })));
        assert.strictEqual(OP.CONVEX, undefined, 'the Recorder has no convex op: nothing may need it');
    }],
    ['header tabs: Home, HUD, Cluster, Behavior, About, Check; the shown one selected; a tab out of range is ignored', () => {
        const u = createUi();
        const a = own(undefined, model({}), u);
        assert.deepStrictEqual(a.r.chrome.tabs, { tabs: ['Home', 'HUD', 'Cluster', 'Behavior', 'About', 'Check'], sel: 0, badges: [] });
        [1, 2, 3, 4, 5, 0].forEach((i) => {
            const x = own(i, model({ hudOn: true, clusterOn: true }), u);
            assert.strictEqual(x.r.chrome.tabs.sel, i);
            assert.ok(x.keys.length && x.keys.every((k) => k.indexOf(['home', 'hud', 'cluster', 'behavior', 'about', 'check'][i] + ':') === 0), i + ': ' + x.keys.join(' '));
        });
        u.tab(3);
        [9, 6, -1, 1.5, '2', null, undefined, NaN].forEach((bad) => { u.tab(bad); assert.strictEqual(u.page(), 3, String(bad)); });
    }],
    ['where the kit does not run the screen: one tab, a read-only Home, no targets, whatever page was picked', () => {
        const u = createUi();
        u.tab(2);
        const r = new Recorder(1600, 520, { textScale: 1 }).reset();
        r.own = false; r.chrome = { tabs: null };
        const texts = [], text = r.text;
        r.text = function (s) { texts.push(String(s)); return text.apply(this, arguments); };
        u.draw(r, t, model({ hudOn: true }), () => () => assert.fail('no press there'));
        assert.deepStrictEqual([r.targets.length, r.chrome.tabs.tabs], [0, ['Shift Lights']]);
        ['HUD', 'Instrument cluster', 'ON', 'OFF', 'Not sent yet', 'When both are on', 'Buttons below: HUD on/off, Cluster on/off, Settings (every setting)'].forEach((w) => assert.ok(texts.indexOf(w) >= 0, w + ' in ' + texts.join(' | ')));
    }],
    ['knob order: tabs, then each page\'s targets top to bottom, left to right ("-" before "+")', () => {
        const on = model({ hudOn: true, clusterOn: true });
        assert.deepStrictEqual(own(0, on).keys, ['home:hudOn', 'home:clusterOn'].concat(pm('home', 'bothMode', ['hud', 'cluster', 'map']), ['home:alloff']));
        const disp = (p, styles) => pm(p, p + 'Style', styles).concat(st(p, p + 'Size'), st(p, p + 'Bright'), pm(p, p + 'NightMode', ['auto', 'on', 'off']), st(p, p + 'X'), st(p, p + 'Y'), p === 'hud' ? st(p, 'hudBarX') : []);
        assert.deepStrictEqual(own(1, on).keys, disp('hud', ['large', 'classic', 'bar', 'bracket']));
        assert.deepStrictEqual(own(2, on).keys, disp('cluster', ['large', 'classic', 'row', 'stock']));
        assert.deepStrictEqual(own(1, model({})).keys, ['hud:turnon'], 'HUD off: only the button that turns it on');
        assert.deepStrictEqual(own(2, model({ hudOn: true })).keys, ['cluster:turnon']);
        const shifts = [].concat.apply([], L.MODES.map((x) => st('behavior', x + 'Start').concat(st('behavior', x + 'Shift'))));
        assert.deepStrictEqual(own(3, on).keys, ['behavior:onlySportPlus', 'behavior:autoStart'].concat(st('behavior', 'leadMs'), ['behavior:rpmPoll'],
            pm('behavior', 'driveMode', ['comfort', 'sport', 'sportplus']), shifts));
        assert.deepStrictEqual(own(3, model({ onlySportPlus: true })).keys.slice(-4), st('behavior', 'sportplusStart').concat(st('behavior', 'sportplusShift')));
        assert.deepStrictEqual(own(4, on).keys, pm('about', 'layout', ['full', 'standard']).concat(pm('about', 'renderer', ['auto', 'software']), pm('about', 'demo', ['auto', 'on', 'off']), pm('about', 'flashMode', ['app', 'renderer'])));
        // a HUD off its defaults: Reset HUD to defaults is the first place on its page (the note's button)
        assert.strictEqual(own(1, model({ hudOn: true, clusterOn: true, hudSize: 100 })).keys[0], 'hud:reset');
        // keys are unique on every page (the kit keeps the focus on a key across redraws)
        assert.deepStrictEqual(own(5, on).keys, ['check:refresh'], 'Check with nothing shown: Refresh only');
        [0, 1, 2, 3, 4, 5].forEach((i) => { const k = own(i, on).keys; assert.strictEqual(new Set(k).size, k.length, 'page ' + i); });
    }],
    ['pressing a target runs the writes for its own setting', () => {
        const on = model({ hudOn: true, clusterOn: true });
        assert.deepStrictEqual(own(0, on).run('home:hudOn'), [['hudOn', false]]);
        assert.deepStrictEqual(own(0, on).run('home:alloff'), [['hudOn', false], ['clusterOn', false]]);
        assert.deepStrictEqual(own(0, on).run('home:bothMode:cluster'), [['bothMode', 'cluster']]);
        assert.deepStrictEqual(own(1, on).run('hud:hudSize:-'), [['hudSize', 100]]);
        assert.deepStrictEqual(own(1, on).run('hud:hudStyle:bracket'), [['hudStyle', 'bracket']]);
        assert.deepStrictEqual(own(1, on).run('hud:hudNightMode:on'), [['hudNightMode', 'on']]);
        assert.deepStrictEqual(own(4, on).run('about:flashMode:renderer'), [['flashMode', 'renderer']]);
        assert.deepStrictEqual(own(1, model({})).run('hud:turnon'), [['hudOn', true]]);
        assert.deepStrictEqual(own(2, on).run('cluster:clusterY:-'), [['clusterY', -5]]);
        assert.deepStrictEqual(own(3, on).run('behavior:leadMs:+'), [['leadMs', 80]]);
        assert.deepStrictEqual(own(3, on).run('behavior:sportShift:-'), [['sportShift', 6700]]);
        assert.deepStrictEqual(own(3, on).run('behavior:rpmPoll'), [['rpmPoll', false]]);
        assert.deepStrictEqual(own(4, on).run('about:renderer:software'), [['renderer', 'software']]);
        // a stepper at its end is still a target (the focus stays put) and changes nothing
        assert.deepStrictEqual(own(1, model({ hudOn: true, hudBright: 100 })).run('hud:hudBright:+'), []);
    }],
    ['0.4.4 Check tab: Reset HUD drawing and Refresh run their commands; every verdict fits the Home card and every proof line the screen', () => {
        const proof = { link: 'ready', backend: 'id7', holding: false, madeAt: 1, targets: { hud: { state: 'waiting', holder: 'foreign', reason: 'scene id in use by another target', at: 2 } },
            layers: ['slats', 'bracketImg', 'bracketFill'].map((role, i) => ({ which: 'hud', target: 'hud', role, ref: 3 + i, state: 'shown', reason: '', lastSent: role === 'bracketImg' ? 'opacity 0.35, gear 3' : 'u_st 0.43 1 0.35 -0.2', lastSentAt: 3 })),
            status: { at: 4, targets: { hud: { state: 'waiting', holder: 'foreign', reason: 'scene id in use by another target', rendering: 'renderer not subscribed for 600000 ms',
                line: ('target hud: slot 0x323 scene 0x1000400 800x480: waiting (foreign) scene id in use by another target; renderer not subscribed for 600000 ms').slice(0, 120) } },
            others: ['adam_mtrack on panel', 'adam_vitals on panel'], rendering: { hud: { kind: 'unsubscribed', secs: null, ms: 600000 } } } };
        const m = model({ hudOn: true }, { proof, heal: { used: 2, gaveUp: true, last: { why: 'handover', at: 5 } }, now: 100000 });
        const x = own(5, m);
        assert.deepStrictEqual(x.keys, ['check:reset', 'check:refresh']);
        assert.deepStrictEqual(x.run('check:reset'), { cmd: 'hudReset', writes: [] });
        assert.deepStrictEqual(x.run('check:refresh'), { cmd: 'refresh', writes: [] });
        const u = createUi();
        u.tab(5);
        u.draw(new Canvas(1600, 520).clear(t.bg), t, m);
        // widths with the kit's own text measure: a card's state line has 664 px, a proof value 1220 px, the verdict 900 px
        const cv = new Recorder(1600, 520, { textScale: 1 }).reset();
        const HC = require('../../apps/adam_shiftlights/hudcheck');
        const texts = ['Showing: the renderer drew it', 'Showing at 35 %: night dim', 'Showing at 20 %: brightness', 'On, paused: see below', 'Demo data: nothing is sent',
            'Not sent yet', 'Redrawing: layers come back soon', 'Not sent: no renderer link', 'Not sent: no layer made', 'Blocked: ' + HC.appName('adam_mtrack on panel') + ' holds the scene',
            'Blocked: some_long_app_id_x holds the scene', 'Sent, the renderer says unavailable', 'Sent, parked behind the stock display', 'Sent, not shown yet',
            'Sent, waiting for the read-back', 'Sent, not confirmed drawn'];
        texts.forEach((s) => assert.ok(cv.textWidth(s, 22, { font: 'bold' }) <= 664, s + ': ' + cv.textWidth(s, 22, { font: 'bold' })));
        const P = require('../../apps/adam_shiftlights/pages');
        const v = P.view(5, m);
        v.lines.forEach((l) => assert.ok(cv.textWidth(l[1], 20) <= 1220, l[0] + ': ' + cv.textWidth(l[1], 20)));
        assert.ok(cv.textWidth(v.detail, 20) <= 1520, v.detail);
        assert.ok(cv.textWidth(v.note, 26, { font: 'bold' }) <= 900, v.note);
    }],
    ['0.4.5 Check tab: all 11 proof rows and the foot inside the 520 px canvas; the disabled verdict and guard row fit their widths', () => {
        const CS = require('../../apps/adam_shiftlights/crstatus'), P = require('../../apps/adam_shiftlights/pages');
        const text = ['target hud: slot 0x323 scene 0x1000400 800x480: idle', 'guard: hud 0x323 0x1000400 0: disabled, 2 strikes',
            'dcsm: Dcsm2 available for 734 s; subscription: x', 'dcsm: since start: 1 request; last slot table 3 s ago'].join('\n');
        const cs = CS.parseStatus(text);
        const proof = { link: 'ready', backend: 'id7', holding: false, madeAt: 1, linkAt: 1, targets: { hud: { state: 'idle', holder: '', reason: '', at: 2 } },
            layers: ['slats', 'bracketImg', 'bracketFill'].map((role, i) => ({ which: 'hud', target: 'hud', role, ref: 1 + i, state: 'waiting', reason: 'target idle', lastSent: role === 'bracketImg' ? 'opacity 1, gear P' : 'u_st 43.15 0 1 0', lastSentAt: 3 })),
            status: { at: 4, targets: cs.targets, others: [], rendering: { hud: CS.renderingOf('') }, guard: cs.guard, dcsm: cs.dcsm } };
        const m = model({ hudOn: true, hudStyle: 'bracket' }, { proof, heal: { used: 2, gaveUp: true, last: { why: 'stuck', at: 5 }, lastAt: 5 }, now: 100000 });
        const u = createUi();
        u.tab(5);
        const r = new Recorder(1600, 520, { textScale: 1 }).reset(), drawn = [], text0 = r.text;
        r.own = true; r.chrome = { tabs: null };
        r.text = function (str, x, y, size) { drawn.push({ s: String(str), y, size }); return text0.apply(this, arguments); };
        u.draw(r, t, m, () => () => {});
        const v = P.view(5, m);
        assert.strictEqual(v.lines.length, 11);
        assert.strictEqual(v.code, 'disabled');
        v.lines.forEach((l) => assert.ok(drawn.some((d) => d.s === l[0]), 'row drawn: ' + l[0]));
        drawn.forEach((d) => assert.ok(d.y <= 520 - 4 && d.y - d.size >= 0, d.s + ' at y ' + d.y));
        const ys = v.lines.map((l) => drawn.filter((d) => d.s === l[0])[0].y), foot = drawn.filter((d) => d.s === v.foot)[0];
        ys.forEach((y, i) => { if (i) assert.ok(y - ys[i - 1] >= 24, 'rows do not overlap: ' + (y - ys[i - 1])); });
        assert.ok(foot && foot.y - ys[10] >= 30, 'the foot under the box: ' + JSON.stringify(foot));
        v.lines.forEach((l) => assert.ok(r.textWidth(l[1], 20) <= 1220, l[0] + ': ' + r.textWidth(l[1], 20)));
        assert.ok(r.textWidth(v.detail, 20) <= 1520, v.detail);
        assert.ok(r.textWidth(v.note, 26, { font: 'bold' }) <= 900, v.note);
        assert.ok(r.textWidth('Blocked: the renderer turned the HUD off', 22, { font: 'bold' }) <= 664, 'the Home card state line');
    }],
];
