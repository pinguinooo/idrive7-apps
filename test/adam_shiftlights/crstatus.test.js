'use strict';
/* crstatus.js: the service's status text read back (lines in the shape of idrive-apps server.cpp status_text and
 * slots.cpp rendering_text; fixtures shared with test/adam_mtrack/renderer.test.js). */
const assert = require('assert');
const CS = require('../../apps/adam_shiftlights/crstatus');

const HEAD = 'upload: cap 5500 KB/s (ceiling 5500, floor 2000): the ceiling';
const hud = (rest) => 'target hud: slot 0x323 scene 0x1000400 800x480: ' + rest;
const ST = (lines) => CS.parseStatus([HEAD].concat(lines).join('\n'));

module.exports = [
    ['hud shown + rendered: state, holder, rendering seconds', () => {
        const st = ST([hud('shown (us); rendered: renderer 1a2b subscribed for 42 s'), 'layer 7 effect of adam_shiftlights on hud, overlay z 2: shown']);
        assert.strictEqual(st.targets.hud.state, 'shown');
        assert.strictEqual(st.targets.hud.holder, 'us');
        assert.deepStrictEqual(CS.renderingOf(st.targets.hud.rendering), { kind: 'rendered', secs: 42, ms: null });
        assert.deepStrictEqual(CS.othersOn(st, ['panel', 'hud']), [], 'our own layer is not another app');
        assert.deepStrictEqual(CS.renderingOf('rendered'), { kind: 'rendered', secs: null, ms: null }, 'no subscriber listed');
    }],
    ['shown + "renderer not subscribed for 6000 ms"', () => {
        const st = ST([hud('shown (us); renderer not subscribed for 6000 ms')]);
        assert.deepStrictEqual(CS.renderingOf(st.targets.hud.rendering), { kind: 'unsubscribed', secs: null, ms: 6000 });
    }],
    ['"renderer subscription not observable"', () => {
        const st = ST([hud('shown (us); renderer subscription not observable')]);
        assert.strictEqual(CS.renderingOf(st.targets.hud.rendering).kind, 'unobservable');
    }],
    ['released + "scene published"', () => {
        const st = ST([hud('idle; scene published')]);
        assert.strictEqual(st.targets.hud.state, 'idle');
        assert.strictEqual(st.targets.hud.published, true);
        assert.strictEqual(CS.renderingOf(st.targets.hud.rendering).kind, 'published');
    }],
    ['waiting (foreign) and parked behind stock: state, holder and reason', () => {
        const w = ST([hud('waiting (foreign) scene id in use by another target')]).targets.hud;
        assert.deepStrictEqual([w.state, w.holder, w.reason], ['waiting', 'foreign', 'scene id in use by another target']);
        const p = ST([hud('parked (foreign) behind stock content')]).targets.hud;
        assert.deepStrictEqual([p.state, p.holder], ['parked', 'foreign']);
        assert.strictEqual(CS.renderingOf(p.rendering).kind, '');
    }],
    ['an adam_mtrack effect layer on panel: othersOn lists it once, not ours', () => {
        const st = ST(['target panel: slot 0x203 scene 0x1000400 1920x720: shown (us)', 'layer 9 effect of adam_mtrack on panel, overlay z 900: shown',
            'layer 10 effect of adam_mtrack on panel, content z 90, guide_hold 0: shown', 'layer 3 effect of adam_shiftlights on hud, overlay z 2: waiting - target waiting',
            'layer 4 video of waze-on-cluster on map, content z 0: stalled - no frame yet']);
        assert.deepStrictEqual(CS.othersOn(st, ['panel', 'hud']), ['adam_mtrack on panel']);
        assert.strictEqual(st.layers[2].reason, 'target waiting');
    }],
    ['hudLine: the raw target line, cut to 120 characters', () => {
        const long = hud('shown (us); rendered: renderer ' + 'f'.repeat(200) + ' subscribed for 1 s');
        assert.strictEqual(CS.hudLine(long).length, 120);
        assert.ok(CS.hudLine(long).indexOf('target hud: slot') === 0);
        assert.strictEqual(CS.hudLine('target panel: slot 0x203 scene 0x1 1920x720: idle', 'panel'), 'target panel: slot 0x203 scene 0x1 1920x720: idle');
        assert.strictEqual(CS.hudLine(HEAD), '');
    }],
    ['garbage, empty and null: empty results, no throw', () => {
        [null, undefined, '', 'nonsense\n\n\x00', 42, 'target hud: broken'].forEach((x) => {
            const st = CS.parseStatus(x);
            assert.deepStrictEqual(st, { targets: {}, layers: [], guard: {}, dcsm: null, renderer: '' }, String(x));
            assert.deepStrictEqual(CS.othersOn(st, ['hud']), []);
            assert.strictEqual(CS.hudLine(x), '');
        });
        assert.deepStrictEqual(CS.othersOn(null, ['hud']), []);
        [null, undefined, '', 'Rendered', 'renderer not subscribed for x ms'].forEach((x) => assert.strictEqual(CS.renderingOf(x).kind, '', String(x)));
    }],
    // ---- 0.4.5: the guard, renderer and dcsm lines (cluster-render 0.4.x server.cpp status_text, guard.cpp, dcsm2_port.cpp) ----
    ['a 0.4.2-shaped status with the HUD disabled: guard, renderer and both dcsm lines; targets and layers unchanged', () => {
        const st = ST(['target map: slot 0x205 scene 0x1000300 1088x480: idle', 'target panel: slot 0x203 scene 0x1000400 1920x720: idle', hud('idle'),
            'guard: hud 0x323 0x1000400 0: disabled, 2 strikes', 'renderer: 12 subscription lines read since start',
            'dcsm: Dcsm2 available for 734 s; subscription: slot table accepted, content accepted', 'dcsm: since start: 4 requests, 4 replies; last slot table 3 s ago',
            'slot 0x323 status 0 content 0x0 class 0 map 0', 'layer 1 effect of adam_shiftlights on hud, overlay z 1: waiting - target idle',
            'layer 2 image of adam_shiftlights on hud, overlay z 2: waiting - target idle', 'layer 3 effect of adam_shiftlights on hud, overlay z 3: waiting - target idle']);
        assert.deepStrictEqual([st.targets.hud.state, st.targets.hud.holder, st.targets.hud.reason], ['idle', '', '']);
        assert.deepStrictEqual(st.guard, { hud: { mapping: 'hud 0x323 0x1000400 0', disabled: true, strikes: 2, line: 'guard: hud 0x323 0x1000400 0: disabled, 2 strikes' } });
        assert.deepStrictEqual(st.dcsm, { up: true, secs: 734, tableSecs: 3, line: 'dcsm: Dcsm2 available for 734 s; subscription: slot table accepted, content accepted' });
        assert.strictEqual(st.renderer, 'renderer: 12 subscription lines read since start');
        assert.deepStrictEqual(st.layers.map((l) => [l.id, l.state, l.reason]), [[1, 'waiting', 'target idle'], [2, 'waiting', 'target idle'], [3, 'waiting', 'target idle']]);
        assert.strictEqual(Object.keys(st.targets).length, 3);
    }],
    ['one strike: not disabled; an "auto" slot key; no guard line: an empty guard', () => {
        const one = ST([hud('shown (us)'), 'guard: hud 0x323 0x1000400 0: 1 strike']).guard.hud;
        assert.deepStrictEqual([one.disabled, one.strikes], [false, 1]);
        const auto = ST(['guard: map auto 0x1000300 2: 3 strikes']).guard.map;
        assert.deepStrictEqual([auto.mapping, auto.disabled, auto.strikes], ['map auto 0x1000300 2', false, 3]);
        assert.deepStrictEqual(ST([hud('idle'), 'dcsm: Dcsm2 available for 5 s; subscription: no answer yet']).guard, {});
        assert.strictEqual(ST(['guard: hud 0x323 0x1000400 0: disabled, many strikes']).guard.hud, undefined, 'a line out of shape is ignored');
    }],
    ['dcsm "not available yet", "not available for N s" and no slot table since it came up', () => {
        const yet = ST(['dcsm: Dcsm2 not available yet; subscription: no answer yet', 'dcsm: since start: none; no slot table since Dcsm2 came up']).dcsm;
        assert.deepStrictEqual([yet.up, yet.secs, yet.tableSecs], [false, null, null]);
        const down = ST(['dcsm: Dcsm2 not available for 12 s; subscription: x', 'dcsm: since start: 1 request; last slot table 40 s ago']).dcsm;
        assert.deepStrictEqual([down.up, down.secs, down.tableSecs], [false, 12, 40]);
        assert.strictEqual(ST(['dcsm: since start: 1 request; last slot table 40 s ago']).dcsm, null, 'a since-start line alone is no link state');
    }],
];
