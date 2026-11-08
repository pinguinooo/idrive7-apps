'use strict';
/**
 * crstatus.js - the cluster-render service's status text (idrive-apps server.cpp status_text, slots.cpp rendering_text),
 * read back for the Check tab and the HUD self-heal (0.4.4). Pure, Node 8. parseStatus and othersOn are copied from
 * apps/adam_mtrack/renderer.js (assets and upload lines left out); renderingOf reads the target line's rendering part,
 * the strongest proof the app can get that the renderer took our scene (not a photo of the HUD).
 *
 *   parseStatus(text)        -> { targets: { name: { state, holder, reason, rendering, published, line } }, layers: [...] }
 *   othersOn(st, names)      other apps' layers on those targets: ['adam_mtrack on panel', ...]
 *   renderingOf(rendering)   -> { kind: 'rendered' | 'unsubscribed' | 'unobservable' | 'published' | '', secs, ms }
 *   hudLine(text, name)      the raw 'target <name>:' line (default hud), cut to 120 characters, or ''
 */
const MINE = /^adam_shiftlights$/;
const LINE_MAX = 120;

function parseStatus(text) {
    const out = { targets: {}, layers: [] };
    String(text || '').split('\n').forEach((line) => {
        let m = /^target (\w+): slot \S+ scene \S+ \d+x\d+: (\w+)(?: \((\w+)\))?(.*)$/.exec(line);
        if (m) {
            const rest = m[4], semi = rest.indexOf('; ');
            const reason = (semi >= 0 ? rest.slice(0, semi) : rest).trim(), rendering = semi >= 0 ? rest.slice(semi + 2).trim() : '';
            out.targets[m[1]] = { state: m[2], holder: m[3] || '', reason, rendering, published: rendering === 'scene published', line: line.slice(0, LINE_MAX) };
            return;
        }
        m = /^layer (\d+) (\w+) of (\S+) on (\w+), (\w+) z (-?\d+)[^:]*: (\w+)(?: - (.*))?$/.exec(line);
        if (m) out.layers.push({ id: Number(m[1]), kind: m[2], app: m[3], target: m[4], klass: m[5], z: Number(m[6]), state: m[7], reason: m[8] || '' });
    });
    return out;
}

const othersOn = (st, names) => (st ? st.layers : []).filter((l) => !MINE.test(l.app) && names.indexOf(l.target) >= 0)
    .map((l) => l.app + ' on ' + l.target).filter((x, i, a) => a.indexOf(x) === i);

function renderingOf(rendering) {
    const r = String(rendering || '');
    let m = /^rendered(?:: renderer \S+ subscribed for (\d+) s)?/.exec(r);
    if (m) return { kind: 'rendered', secs: m[1] === undefined ? null : Number(m[1]), ms: null };
    m = /^renderer not subscribed for (\d+) ms/.exec(r);
    if (m) return { kind: 'unsubscribed', secs: null, ms: Number(m[1]) };
    if (/^renderer subscription not observable/.test(r)) return { kind: 'unobservable', secs: null, ms: null };
    if (r === 'scene published') return { kind: 'published', secs: null, ms: null };
    return { kind: '', secs: null, ms: null };
}

function hudLine(text, name) {
    const t = parseStatus(text).targets[name || 'hud'];
    return t ? t.line : '';
}

module.exports = { parseStatus, othersOn, renderingOf, hudLine, MINE };
