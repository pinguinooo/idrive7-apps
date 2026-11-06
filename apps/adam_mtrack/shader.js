'use strict';
/**
 * shader.js - the effect-layer fragment shaders (GLSL ES 1.00, idrive-apps PROTOCOL.md "Shaders") and their uniforms.
 * Each program stays within 16 uniform vectors (GLSL ES 1.00's minimum; the KOMBI's GPU is unknown):
 * test/adam_mtrack/shader_check.mjs compiles them and counts. Every shader multiplies its alpha by u_alive, the
 * dead-man value: 0.1.3 keeps it at 1 while shown and re-arms a renderer animation that holds it (G's Dash's recipe,
 * output.js), 0 while a stage is lifted but not shown. The 0.1.3 programs pick highp only where the GPU has it.
 *
 *   tachsFs(quads, atlas)   the cover's stage 1: the whole panel, opaque: the background (its right half at half
 *                 resolution, mirrored), the bars' art (the right bar's, mirrored for the left), the fill to the revs
 *                 (a band mask; u_fill.x = the revs line's y) and the numerals 0..7 from the atlas (quads baked in)
 *   boxFs(boxes)  stage 2: both side panels and both corners: each box is an r8 asset twice its width, coverage in
 *                 the left half and a palette index in the right (output.js encodeBox), u_pal the palette
 *   centreFs(rect, atlas, badge)  stage 3: up to 7 quads from the r8 glyph atlas (gear, small gear digit, three speed
 *                 digits, the unit, the drive-mode tag), the centre's static line and stack icon, the M badge
 *   FS_SLATS      stage 4: apps/adam_shiftlights/shader.js FS_SLATS with u_alive and a 9-colour palette
 *   knownFs()     the Safety page's KNOWN step: G's Dash's full-screen cluster test shape (one layer over the panel,
 *                 one r8 1024 x 576 asset): two procedural dials with live needles, the test card, an edge ruler
 *   FS_SOLID, FS_TEX   the test steps' plain bars and tint, and the IMAGE step's asset
 */
const PREC = ['#ifdef GL_FRAGMENT_PRECISION_HIGH', 'precision highp float;', '#else', 'precision mediump float;', '#endif'];
const f1 = (v) => (Math.round(v) === v ? v.toFixed(1) : String(v));
const v2 = (x, y) => 'vec2(' + f1(x) + ', ' + f1(y) + ')';
const v4 = (a) => 'vec4(' + a.map(f1).join(', ') + ')';

/** The tachs layer (stage 1). quads: geom.barNumeralQuads (the right bar's 8, then the left's); atlas: art.json's. */
function tachsFs(quads, atlas, R) {
    const num = (q) => '        a = max(a, num(p, ' + v4(q.dst) + ', ' + v2(q.src[0], q.src[1]) + '));';
    return PREC.concat([
        'varying vec2 v_uv;',
        'uniform sampler2D u_bg;     // r8 480 x 360: the background\'s right half at half resolution (bilinear), mirrored',
        'uniform sampler2D u_over;   // r8, twice the over-art\'s width: the right bar\'s lines, ticks and fields as coverage',
        '                            // (left half) and a palette index (right half, x 17), mirrored for the left bar',
        'uniform sampler2D u_opal;   // rgba8 16 x 1: the over-art\'s colours',
        'uniform sampler2D u_band;   // r8: the right band (where the fill goes), mirrored for the left',
        'uniform sampler2D u_atlas;  // r8: the numerals 0..7 (the atlas\'s bar style)',
        'uniform vec4 u_tint;        // the art\'s colour (rgb), brightness',
        'uniform vec4 u_fill;        // the revs line y, the cap\'s half height, the glow height above it, 0',
        'uniform float u_alive;',
        'vec3 over(vec3 d, vec4 s) { return mix(d, s.rgb, clamp(s.a, 0.0, 1.0)); }',
        'bool inside(vec2 u) { return u.x >= 0.0 && u.x <= 1.0 && u.y >= 0.0 && u.y <= 1.0; }',
        'vec4 art(vec2 q) {          // q: px in the over-art (whole pixels picked, so the mirror is exact)',
        '    vec2 t = (floor(q) + 0.5) / ' + v2(2 * R.overR.w, R.overR.h) + ';',
        '    float l = texture2D(u_over, t).r;',
        '    if (l <= 0.0) return vec4(0.0);',
        '    float k = floor(texture2D(u_over, t + ' + v2(0.5, 0) + ').r * 15.0 + 0.5);',
        '    return vec4(texture2D(u_opal, vec2((k + 0.5) / 16.0, 0.5)).rgb, l);',
        '}',
        'float num(vec2 p, vec4 d, vec2 s) {',
        '    vec2 q = p - d.xy;',
        '    if (q.x < 0.0 || q.y < 0.0 || q.x >= d.z || q.y >= d.w) return 0.0;',
        '    return texture2D(u_atlas, (s + q) / ' + v2(atlas.w, atlas.h) + ').r;',
        '}',
        'void main() {',
        '    vec2 p = vec2(v_uv.x * 1920.0, v_uv.y * 720.0);',
        '    vec2 m = vec2(p.x < 960.0 ? 1920.0 - p.x : p.x, p.y);',
        '    vec3 c = u_tint.rgb * texture2D(u_bg, vec2((m.x - 960.0) / 960.0, m.y / 720.0)).r;',
        '    vec2 bu = (m - ' + v2(R.band.x, R.band.y) + ') / ' + v2(R.band.w, R.band.h) + ';',
        '    if (inside(bu)) {',
        '        float k = texture2D(u_band, bu).r;',
        '        if (k > 0.0) {',
        '            float dy = p.y - u_fill.x, gh = u_fill.z;',
        '            if (dy >= 0.0) c = over(c, vec4(0.839, 0.839, 0.863, 0.28 * k));',
        '            if (dy < 0.0 && dy > -gh) {     // 0.1.5, BMW\'s glow (OEM photo): a crimson wash fading through pink into',
        '                float t = -dy / gh;          // the band, under a 6 px grid of darker crimson lines that fades with it',
        '                float g = t < 0.5 ? mix(0.8, 0.4, t / 0.5) : mix(0.4, 0.0, (t - 0.5) / 0.5);',
        '                c = over(c, vec4(0.93, 0.2, 0.22, g * k));',
        '                if (t < 0.8 && (mod(floor(p.x), 6.0) < 1.0 || mod(floor(p.y), 6.0) < 1.0)) c = over(c, vec4(0.6, 0.02, 0.06, 0.5 * (1.0 - t / 0.8) * k));',
        '            }',
        '            float d = abs(dy) - u_fill.y;    // the cap: BMW\'s solid orange-red block, a crisp edge',
        '            if (d <= 0.0) c = over(c, vec4(0.957, 0.353, 0.188, k));',
        '            else if (d < 4.0) { float e = 1.0 - d / 4.0; c = over(c, vec4(0.957, 0.353, 0.188, 0.5 * e * k)); }',
        '        }',
        '    }',
        '    vec2 oq = m - ' + v2(R.overR.x, R.overR.y) + ';',
        '    if (oq.x >= 0.0 && oq.y >= 0.0 && oq.x < ' + f1(R.overR.w) + ' && oq.y < ' + f1(R.overR.h) + ') {',
        '        c = over(c, art(oq));',
        '        float a = 0.0;',
        '        if (p.x >= 960.0) {',
    ]).concat(quads.slice(0, quads.length / 2).map(num)).concat([
        '        } else {',
    ]).concat(quads.slice(quads.length / 2).map(num)).concat([
        '        }',
        '        c = over(c, vec4(0.957, 0.965, 0.973, a));',
        '    }',
        '    gl_FragColor = vec4(c * u_tint.a, u_alive);',
        '}',
    ]).join('\n');
}

/** The panels layer (stage 2). boxes: { panelL, panelR, cornerL, cornerR } panel rects; layer: its rect. */
function boxFs(boxes, layer) {
    const rel = (b) => v2(b.x, b.y) + ', ' + v2(b.w, b.h);
    return PREC.concat([
        'varying vec2 v_uv;',
        'uniform sampler2D u_pL;     // each box: r8, twice its width: coverage left, palette index (x 17) right',
        'uniform sampler2D u_pR;',
        'uniform sampler2D u_cL;',
        'uniform sampler2D u_cR;',
        'uniform sampler2D u_pal;    // rgba8 16 x 1: the boxes\' colours',
        'uniform float u_bright;',
        'uniform float u_alive;',
        'vec4 box(sampler2D s, vec2 p, vec2 o, vec2 wh) {',
        '    vec2 q = p - o;',
        '    if (q.x < 0.0 || q.y < 0.0 || q.x >= wh.x || q.y >= wh.y) return vec4(0.0);',
        '    vec2 t = (floor(q) + 0.5) / vec2(2.0 * wh.x, wh.y);',
        '    float l = texture2D(s, t).r;',
        '    if (l <= 0.0) return vec4(0.0);',
        '    float k = floor(texture2D(s, t + vec2(0.5, 0.0)).r * 15.0 + 0.5);',
        '    return vec4(texture2D(u_pal, vec2((k + 0.5) / 16.0, 0.5)).rgb, l);',
        '}',
        'vec4 over(vec4 d, vec4 s) {',
        '    float a = s.a + d.a * (1.0 - s.a);',
        '    return a > 0.0 ? vec4((s.rgb * s.a + d.rgb * d.a * (1.0 - s.a)) / a, a) : vec4(0.0);',
        '}',
        'void main() {',
        '    vec2 p = ' + v2(layer.x, layer.y) + ' + v_uv * ' + v2(layer.w, layer.h) + ';',
        '    vec4 c;',
        '    if (p.x < 960.0) c = over(box(u_pL, p, ' + rel(boxes.panelL) + '), box(u_cL, p, ' + rel(boxes.cornerL) + '));',
        '    else c = over(box(u_pR, p, ' + rel(boxes.panelR) + '), box(u_cR, p, ' + rel(boxes.cornerR) + '));',
        '    gl_FragColor = vec4(c.rgb * u_bright, c.a * u_alive);',
        '}',
    ]).join('\n');
}

const QUADS = 7;
/** The centre layer (stage 3): rect its panel rect, atlas art.json's (with its centre cell), badge the M badge's rect. */
function centreFs(rect, atlas, badge) {
    const c = atlas.centre;
    return PREC.concat([
        'varying vec2 v_uv;',
        'uniform sampler2D u_atlas;',
        'uniform sampler2D u_badge;',
        'uniform vec4 u_dst[' + QUADS + '];   // x, y, w, h in the layer (px); w 0: unused',
        'uniform vec4 u_src[' + QUADS + '];   // x, y in the atlas (px), intensity, 0',
        'uniform vec4 u_misc;     // brightness, the badge\'s alpha (0 while the slats are lit), 0, 0',
        'uniform float u_alive;',
        'void main() {',
        '    vec2 p = v_uv * ' + v2(rect.w, rect.h) + ';',
        '    vec2 A = ' + v2(atlas.w, atlas.h) + ';',
        '    float a = 0.0;',
        '    for (int i = 0; i < ' + QUADS + '; i++) {',
        '        vec4 d = u_dst[i];',
        '        if (d.z > 0.0 && p.x >= d.x && p.x < d.x + d.z && p.y >= d.y && p.y < d.y + d.w) a = max(a, texture2D(u_atlas, (u_src[i].xy + p - d.xy) / A).r * u_src[i].z);',
        '    }',
        '    vec2 q = p - ' + v2(c.px - rect.x, c.py - rect.y) + ';',
        '    if (q.x >= 0.0 && q.y >= 0.0 && q.x < ' + f1(c.w) + ' && q.y < ' + f1(c.h) + ') a = max(a, texture2D(u_atlas, (' + v2(c.x, c.y) + ' + q) / A).r);',
        '    vec4 b = vec4(0.0);',
        '    vec2 bu = (p - ' + v2(badge.x - rect.x, badge.y - rect.y) + ') / ' + v2(badge.w, badge.h) + ';',
        '    if (bu.x >= 0.0 && bu.x <= 1.0 && bu.y >= 0.0 && bu.y <= 1.0) { vec4 t = texture2D(u_badge, bu); b = vec4(t.rgb, t.a * u_misc.y); }',
        '    float oa = a + b.a * (1.0 - a);',
        '    vec3 rgb = oa > 0.0 ? (vec3(0.965, 0.973, 0.98) * a + b.rgb * b.a * (1.0 - a)) / oa : vec3(0.0);',
        '    gl_FragColor = vec4(rgb * u_misc.x, oa * u_alive);',
        '}',
    ]).join('\n');
}

const FS_SLATS = [
    'precision highp float;',
    'varying vec2 v_uv;',
    'uniform vec4 u_colors[9];  // the palette in lighting order, padded with its last colour: [8] is the flash colour',
    'uniform vec4 u_rect;       // rect w, h (px); the bar axis x and base y in the rect',
    'uniform vec4 u_geo;        // slat width, pitch, axis to the innermost slat at the base, slats a side',
    'uniform vec4 u_geo2;       // lean (px over the bar height), centre slat half width (0: a gap), bar height, glow (px)',
    'uniform vec4 u_mode;       // mirrored lean (1) or the same lean on both sides (0), outward fill, stage, the flash fills the hull',
    'uniform vec4 u_st;         // lit, flash, brightness, unlit alpha (> 0: unlit slats show once one is lit; < 0: always, at -w)',
    'uniform float u_on;',
    'uniform float u_alive;    // the dead-man switch (output.js): 0 blanks the layer',
    'vec4 pal(float i) {',
    '    vec4 c = u_colors[8];',
    '    for (int j = 0; j < 9; j++) { if (float(j) == i) c = u_colors[j]; }   // constant-index access only (ES 1.00)',
    '    return c;',
    '}',
    'float slatIndex(float k, float n) { return u_mode.y > 0.5 ? k : n - 1.0 - k; }',
    'bool slatLit(float i) { return u_mode.z > 0.5 ? u_st.x > 0.5 : i < u_st.x; }',
    'vec4 slatColor(float i) { return u_mode.z > 0.5 ? pal(u_st.x - 1.0) : pal(i); }',
    'vec4 shade() {',
    '    float slat = u_geo.x, pitch = u_geo.y, inner = u_geo.z, n = u_geo.w;',
    '    float lean = u_geo2.x, cHalf = u_geo2.y, barH = u_geo2.z, glow = u_geo2.w, bright = u_st.z;',
    '    float px = v_uv.x * u_rect.x, py = v_uv.y * u_rect.y;',
    '    float u = (u_rect.w - py) / barH;                       // 0 at the base, 1 at the top',
    '    float d = u_mode.x > 0.5 ? abs(px - u_rect.z) + lean * u : abs(px - lean * u - u_rect.z);   // from the axis, at the base',
    '    float uOut = max(0.0, max(-u, u - 1.0)) * barH;          // px above or below the bar',
    '    float dd = d - inner, hw = inner + (n - 1.0) * pitch + slat;',
    '    float k = floor(dd / pitch);',
    '    bool inBar = uOut == 0.0;',
    '    bool isCentre = inBar && cHalf > 0.0 && d < cHalf;',
    '    bool isSlat = inBar && dd >= 0.0 && k < n && mod(dd, pitch) < slat;',
    '    float idx = isCentre ? n : slatIndex(k, n);',
    '    bool flash = u_st.y > 0.5;',
    '    if (flash && u_on < 0.5) { return vec4(0.0); }',
    '    vec4 flashC = vec4(u_colors[8].rgb * bright, 1.0);',
    '    if (flash) {',
    '        if ((u_mode.w > 0.5 && inBar && d <= hw) || isSlat || isCentre) { return flashC; }',
    '    } else if (isSlat || isCentre) {',
    '        if (slatLit(idx)) { return vec4(slatColor(idx).rgb * bright, 1.0); }',
    '        if ((u_st.x > 0.5 || u_st.w < 0.0) && u_st.w != 0.0) { return vec4(pal(idx).rgb * bright, abs(u_st.w)); }',
    '        return vec4(0.0);',
    '    }',
    '    if (glow <= 0.0) { return vec4(0.0); }',
    '    // glow: the distance (in the sheared frame of the bar) to the nearest lit shape: the hull while flashing,',
    '    // else slats k-1..k+1 and the centre slat',
    '    float best = 1e6; vec3 col = vec3(0.0);',
    '    if (flash) {',
    '        float dx = u_mode.w > 0.5 ? max(0.0, d - hw) : 1e6;',
    '        best = length(vec2(dx, uOut)); col = flashC.rgb;',
    '        if (u_mode.w < 0.5) {',
    '            float k0 = clamp(floor(dd / pitch), 0.0, n - 1.0);',
    '            for (int m = -1; m <= 1; m++) {',
    '                float kk = clamp(k0 + float(m), 0.0, n - 1.0), lo = kk * pitch;',
    '                float ex = max(0.0, max(lo - dd, dd - lo - slat)), dist = length(vec2(ex, uOut));',
    '                if (dist < best) best = dist;',
    '            }',
    '        }',
    '    } else {',
    '        float k0 = clamp(floor(dd / pitch), 0.0, n - 1.0);',
    '        for (int m = -1; m <= 1; m++) {',
    '            float kk = clamp(k0 + float(m), 0.0, n - 1.0), i = slatIndex(kk, n), lo = kk * pitch;',
    '            float ex = max(0.0, max(lo - dd, dd - lo - slat)), dist = length(vec2(ex, uOut));',
    '            if (slatLit(i) && dist < best) { best = dist; col = slatColor(i).rgb * bright; }',
    '        }',
    '        if (cHalf > 0.0 && slatLit(n)) {',
    '            float dist = length(vec2(max(0.0, d - cHalf), uOut));',
    '            if (dist < best) { best = dist; col = slatColor(n).rgb * bright; }',
    '        }',
    '    }',
    '    float t = best / glow;',
    '    if (t >= 1.0) { return vec4(0.0); }',
    '    return vec4(col, 0.55 * (1.0 - t) * (1.0 - t));',
    '}',
    'void main() { vec4 c = shade(); gl_FragColor = vec4(c.rgb, c.a * u_alive); }',].join('\n');

/**
 * The KNOWN step: one effect layer over the whole panel, as G's Dash's full-screen cluster test: two dials (speed 0-160
 * mph, rpm 0-8), live needles from u_val (-1: none), the r8 1024 x 576 test card in the middle, alpha u_alive. 0.1.4: a
 * 2 px frame on the panel's exact edges and a ruler in panel pixels along all four, so a car photo shows where the
 * glass clips the 1920 x 720 layer (procedural: no new uniform).
 */
function knownFs() {
    return PREC.concat([
        'varying vec2 v_uv;',
        'uniform sampler2D u_lab;   // r8 1024 x 576, bilinear: the test card',
        'uniform vec4 u_val;        // speed mph, rpm / 1000, 0, 0 (-1: no needle)',
        'uniform float u_alive;',
        'float aa(float d) { return clamp(d + 0.5, 0.0, 1.0); }',
        'vec2 dirOf(float a) { return vec2(sin(a), -cos(a)); }',
        '// one edge ruler: a 2 px tick every 40 px along the edge (36 px long every 200 px, else 12), at depth d from it',
        'float ticks(float along, float d) { return (1.0 - step(2.0, mod(along + 1.0, 40.0))) * (1.0 - step(mod(along + 1.0, 200.0) < 2.0 ? 36.0 : 12.0, d)); }',
        'vec3 dial(vec3 col, vec2 q, vec2 c, float vmax, float val) {',
        '    vec2 p = q - c; float r = length(p);',
        '    if (r > 262.0) return col;',
        '    col = mix(vec3(0.06, 0.064, 0.072), vec3(0.018, 0.019, 0.022), r / 262.0);',
        '    col = mix(col, vec3(0.72, 0.74, 0.78), aa(2.0 - abs(r - 252.0)));',
        '    float a = atan(p.x, -p.y), t = (a + 2.1817) / 4.3634, n = clamp(floor(t * 32.0 + 0.5), 0.0, 32.0);',
        '    vec2 d = dirOf(-2.1817 + n / 32.0 * 4.3634);',
        '    float al = dot(p, d), pe = abs(dot(p, vec2(-d.y, d.x))), maj = 1.0 - step(0.5, mod(n, 4.0));',
        '    col = mix(col, vec3(0.94, 0.95, 0.96), aa((maj > 0.5 ? 3.0 : 1.5) - pe) * aa(al - (maj > 0.5 ? 196.0 : 214.0)) * aa(232.0 - al));',
        '    if (val >= 0.0) {',
        '        vec2 nd = dirOf(-2.1817 + clamp(val / vmax, 0.0, 1.02) * 4.3634);',
        '        float nl = dot(p, nd), np = abs(dot(p, vec2(-nd.y, nd.x)));',
        '        col = mix(col, vec3(1.0, 0.27, 0.07), aa(mix(6.0, 1.6, clamp(nl / 228.0, 0.0, 1.0)) - np) * aa(nl + 30.0) * aa(228.0 - nl));',
        '    }',
        '    if (r < 26.0) col = mix(col, vec3(0.16, 0.16, 0.17), aa(26.0 - r));',
        '    return col;',
        '}',
        'void main() {',
        '    vec2 q = v_uv * vec2(1920.0, 720.0);',
        '    vec3 col = vec3(0.012, 0.013, 0.016);',
        '    col = dial(col, q, vec2(340.0, 360.0), 160.0, u_val.x);',
        '    col = dial(col, q, vec2(1580.0, 360.0), 8.0, u_val.y);',
        '    vec2 u = (q - vec2(640.0, 180.0)) / vec2(640.0, 360.0);',
        '    if (u.x >= 0.0 && u.x <= 1.0 && u.y >= 0.0 && u.y <= 1.0) col = mix(col, vec3(0.28, 0.62, 1.0), texture2D(u_lab, u).r);',
        '    float dy = min(q.y, 720.0 - q.y), dx = min(q.x, 1920.0 - q.x);',
        '    float rule = max(1.0 - step(2.0, min(dx, dy)), max(ticks(q.x, dy), ticks(q.y, dx)));',
        '    col = mix(col, vec3(0.94, 0.95, 0.96), rule);',
        '    gl_FragColor = vec4(col, clamp(u_alive, 0.0, 1.0));',
        '}',
    ]).join('\n');
}

/** Test pattern steps (ladder.js): one colour; u_alive per bar (step 2: plain, 0.1.3's dead-man, 0.1.1's dead-man). */
const FS_SOLID = [
    'precision mediump float;',
    'varying vec2 v_uv;',
    'uniform vec4 u_color;',
    'uniform float u_alive;',
    'void main() { gl_FragColor = vec4(u_color.rgb, u_color.a * u_alive); }',
].join('\n');

/** The IMAGE step's asset half: one rgba asset times a tint and a brightness. */
const FS_TEX = [
    'precision mediump float;',
    'varying vec2 v_uv;',
    'uniform sampler2D u_tex;',
    'uniform vec4 u_tint;       // rgb x, alpha x (0 hides it)',
    'uniform float u_bright;',
    'uniform float u_alive;',
    'void main() {',
    '    vec4 c = texture2D(u_tex, v_uv);',
    '    gl_FragColor = vec4(c.rgb * u_tint.rgb * u_bright, c.a * u_tint.a * u_alive);',
    '}',
].join('\n');

const rgb = (hex) => [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) / 255 * 10000) / 10000);
const r2 = (v) => Math.round(v * 100) / 100;
const unlitAlpha = (st) => (st.idle ? -st.dim : st.dim);

/** The slats layer's static uniforms (geom.slatBar g): [[name, values, opts]]; u_st [lit, flash, level, unlit]. */
function slatUniforms(g, colors, level) {
    const st = g.style, d = g.dims, cols = [];
    for (let j = 0; j < 9; j++) Array.prototype.push.apply(cols, rgb(colors[st.palette[Math.min(j, st.palette.length - 1)]]).concat([1]));
    return [
        ['u_colors', cols, { type: 'vec4' }],
        ['u_rect', [g.rect.w, g.rect.h, r2(g.local.cx), r2(g.local.yb)]],
        ['u_geo', [r2(d.slat), r2(d.pitch), r2(d.inner), d.perSide]],
        ['u_geo2', [r2(d.shear), r2(d.centre), r2(d.h), st.glow]],
        ['u_mode', [st.lean === 'same' ? 0 : 1, st.fill === 'outward' ? 1 : 0, st.stage ? 1 : 0, 1]],
        ['u_st', [0, 0, level, unlitAlpha(st)]],
        ['u_on', [1]],
    ];
}

module.exports = { tachsFs, boxFs, centreFs, knownFs, FS_SLATS, FS_SOLID, FS_TEX, slatUniforms, rgb, unlitAlpha, QUADS, PREC };
