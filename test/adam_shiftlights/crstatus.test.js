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
            assert.deepStrictEqual(st, { targets: {}, layers: [] }, String(x));
            assert.deepStrictEqual(CS.othersOn(st, ['hud']), []);
            assert.strictEqual(CS.hudLine(x), '');
        });
        assert.deepStrictEqual(CS.othersOn(null, ['hud']), []);
        [null, undefined, '', 'Rendered', 'renderer not subscribed for x ms'].forEach((x) => assert.strictEqual(CS.renderingOf(x).kind, '', String(x)));
    }],
];
