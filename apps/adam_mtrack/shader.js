'use strict';
/**
 * shader.js - the cover's effect-layer fragment shaders (GLSL ES 1.00, idrive-apps PROTOCOL.md "Shaders") and
 * their uniforms. Each program stays within 16 uniform vectors (GLSL ES 1.00's minimum; the KOMBI's GPU is
 * unknown): test/adam_mtrack/shader_check.mjs compiles them and counts. Every shader multiplies its alpha by
 * u_alive: its base value is 0 and output.js keeps restarting an animation that holds it at 1 for 1 s, then
 * ramps it to 0, so a hung app's cover blanks by itself (the dead-man switch, on the renderer's clock).
 *
 *   FS_BASE     the whole panel, opaque: the static art (r8, tinted), the bar tachs' fill to the revs (a band
 *               mask, mirrored for the left bar; u_fill.x = the revs line's y), the bars' over-art on top
 *   FS_TEX      one rgba asset (the M badge, a side panel, a corner gauge) times a tint and the brightness
 *   glyphFs()   up to 7 quads from the r8 glyph atlas: gear, small gear digit, three speed digits, the unit
 *               label, the drive-mode tag
 *   FS_SLATS    apps/adam_shiftlights/shader.js FS_SLATS with u_alive, and a 9-colour palette (the M slats'
 *               palette ends in two reds, so index 8 doubles as the flash colour; keeps 16 vectors)
 */
const FS_BASE = [
    'precision highp float;',
    'varying vec2 v_uv;',
    'uniform sampler2D u_lum;   // the static art, 1920 x 720, one byte a pixel',
    'uniform sampler2D u_band;  // the right bar\'s band (where the fill goes), u_bandBox',
    'uniform sampler2D u_overR; // the right bar\'s edge lines, ticks, numerals and fields, u_overBox',
    'uniform sampler2D u_overL; // the left bar\'s, in the mirror of u_overBox',
    'uniform vec4 u_bandBox;',
    'uniform vec4 u_overBox;',
    'uniform vec4 u_tint;       // the art\'s colour (rgb), brightness',
    'uniform vec4 u_fill;       // the revs line y, the cap\'s half height, the glow height above it, 0',
    'uniform float u_alive;',
    'vec3 over(vec3 d, vec4 s) { return mix(d, s.rgb, clamp(s.a, 0.0, 1.0)); }',
    'bool inside(vec2 u) { return u.x >= 0.0 && u.x <= 1.0 && u.y >= 0.0 && u.y <= 1.0; }',
    'void main() {',
    '    vec2 p = vec2(v_uv.x * 1920.0, v_uv.y * 720.0);',
    '    vec3 c = u_tint.rgb * texture2D(u_lum, v_uv).r;',
    '    vec2 bu = (vec2(p.x < 960.0 ? 1920.0 - p.x : p.x, p.y) - u_bandBox.xy) / u_bandBox.zw;',
    '    if (inside(bu)) {',
    '        float m = texture2D(u_band, bu).r;',
    '        if (m > 0.0) {',
    '            float dy = p.y - u_fill.x, gh = u_fill.z;',
    '            if (dy >= 0.0) c = over(c, vec4(0.839, 0.839, 0.863, 0.28 * m));            // swept: base to the revs',
    '            if (dy < 0.0 && dy > -gh) {                                                // the red glow above the revs',
    '                float t = -dy / gh;',
    '                float a = t < 0.45 ? mix(0.62, 0.24, t / 0.45) : mix(0.24, 0.0, (t - 0.45) / 0.55);',
    '                c = over(c, vec4(0.839, 0.071, 0.118, a * m));',
    '                if (t < 0.7 && (mod(floor(p.x), 6.0) < 1.0 || mod(floor(p.y), 6.0) < 1.0)) c = over(c, vec4(0.157, 0.0, 0.024, 0.22 * m));',
    '            }',
    '            float d = abs(dy) - u_fill.y;                                              // the red cap at the revs, glowing',
    '            if (d <= 0.0) c = over(c, vec4(0.945, 0.078, 0.114, m));',
    '            else if (d < 14.0) { float g = 1.0 - d / 14.0; c = over(c, vec4(0.945, 0.078, 0.114, 0.55 * g * g * m)); }',
    '        }',
    '    }',
    '    if (p.x >= 960.0) {',
    '        vec2 ou = (p - u_overBox.xy) / u_overBox.zw;',
    '        if (inside(ou)) c = over(c, texture2D(u_overR, ou));',
    '    } else {',
    '        vec2 ou = (p - vec2(1920.0 - u_overBox.x - u_overBox.z, u_overBox.y)) / u_overBox.zw;',
    '        if (inside(ou)) c = over(c, texture2D(u_overL, ou));',
    '    }',
    '    gl_FragColor = vec4(c * u_tint.a, u_alive);',
    '}',
].join('\n');

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

const QUADS = 7;
const f1 = (v) => (Math.round(v) === v ? v.toFixed(1) : String(v));
/** The glyph shader for a layer of lw x lh px sampling an atlas of aw x ah px (sizes baked in: 16 vectors). */
function glyphFs(lw, lh, aw, ah) {
    return [
        'precision highp float;',
        'varying vec2 v_uv;',
        'uniform sampler2D u_atlas;',
        'uniform vec4 u_dst[' + QUADS + '];   // x, y, w, h in the layer (px); w 0: unused',
        'uniform vec4 u_src[' + QUADS + '];   // x, y in the atlas (px), intensity, 0',
        'uniform float u_bright;',
        'uniform float u_alive;',
        'void main() {',
        '    vec2 p = v_uv * vec2(' + f1(lw) + ', ' + f1(lh) + ');',
        '    float a = 0.0;',
        '    for (int i = 0; i < ' + QUADS + '; i++) {',
        '        vec4 d = u_dst[i];',
        '        if (d.z > 0.0 && p.x >= d.x && p.x < d.x + d.z && p.y >= d.y && p.y < d.y + d.w) {',
        '            vec2 s = (u_src[i].xy + p - d.xy) / vec2(' + f1(aw) + ', ' + f1(ah) + ');',
        '            a = max(a, texture2D(u_atlas, s).r * u_src[i].z);',
        '        }',
        '    }',
        '    gl_FragColor = vec4(vec3(0.965, 0.973, 0.98) * u_bright, a * u_alive);',
        '}',
    ].join('\n');
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

/** Test pattern (ladder.js steps 1 and 2): one colour; u_alive 1, or the dead-man animation for step 1's blue bar. */
const FS_SOLID = [
    'precision mediump float;',
    'varying vec2 v_uv;',
    'uniform vec4 u_color;',
    'uniform float u_alive;',
    'void main() { gl_FragColor = vec4(u_color.rgb, u_color.a * u_alive); }',
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

module.exports = { FS_BASE, FS_TEX, FS_SLATS, FS_SOLID, glyphFs, slatUniforms, rgb, unlitAlpha, QUADS };
