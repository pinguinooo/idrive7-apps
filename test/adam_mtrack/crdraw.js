/* The renderer stand-in: draws a target's effect layers (crstate.mjs layersAt) over black in WebGL1, as the service
 * does: each layer's quad over its rect, its fragment shader (GLSL ES 1.00, varying v_uv 0,0 top-left), its last
 * uniforms, its samplers bound to assets (r8 as a one-byte texture read as .r, rgba8 straight alpha), straight-alpha
 * blending. A browser script (no modules): composite.mjs loads it into headless Chromium, view.html into the
 * owner's browser. CRDraw.create(canvas, { under }) -> { putAsset(key, version, meta, bytes), draw(list, W, H, under), gl }.
 * under: [r, g, b] 0-255, what shows where no layer draws (default black; draw's own under for one draw). */
(function (root) {
    'use strict';
    const VS = 'attribute vec2 a_position; varying vec2 v_uv; void main() { v_uv = vec2((a_position.x + 1.0) * 0.5, (1.0 - a_position.y) * 0.5); gl_Position = vec4(a_position, 0.0, 1.0); }';
    function create(canvas, opts) {
        const under0 = (opts && opts.under) || [0, 0, 0];
        const gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
        if (!gl) throw new Error('no WebGL');
        const progs = {}, assets = {}, errors = [];
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        function prog(fs) {
            if (progs[fs] !== undefined) return progs[fs];
            const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
            let p = null;
            try {
                p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
                if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
            } catch (e) { errors.push(String(e)); p = null; }
            progs[fs] = p;
            return p;
        }
        /** An asset's pixels (bytes: Uint8Array, w * h * (r8 ? 1 : 4)); sent again only when its version changes. */
        function putAsset(key, version, meta, bytes) {
            let a = assets[key];
            if (!a) a = assets[key] = { tex: gl.createTexture(), version: -1 };
            if (a.version === version) return;
            const f = meta.format === 'r8' ? gl.LUMINANCE : gl.RGBA, filt = meta.sampling === 'bilinear' ? gl.LINEAR : gl.NEAREST;
            gl.bindTexture(gl.TEXTURE_2D, a.tex);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, f, meta.w, meta.h, 0, f, gl.UNSIGNED_BYTE, bytes);
            a.version = version;
        }
        function draw(list, W, H, under) {
            const u = under || under0;
            canvas.width = W; canvas.height = H;
            gl.viewport(0, 0, W, H); gl.clearColor(u[0] / 255, u[1] / 255, u[2] / 255, 1); gl.clear(gl.COLOR_BUFFER_BIT);
            gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            for (const l of list) {
                if (l.kind !== 'effect') continue;
                const p = prog(l.fs);
                if (!p) continue;
                gl.useProgram(p);
                const a = gl.getAttribLocation(p, 'a_position');
                gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
                gl.viewport(l.x, H - l.y - l.h, l.w, l.h);
                for (const u of l.uniforms) {
                    const n = u[0], v = u[1], type = u[2];
                    const loc = gl.getUniformLocation(p, type ? n + '[0]' : n) || gl.getUniformLocation(p, n);
                    if (!loc) continue;
                    const f = new Float32Array(v);
                    if (type === 'vec4') gl.uniform4fv(loc, f); else [gl.uniform1fv, gl.uniform2fv, gl.uniform3fv, gl.uniform4fv][v.length - 1].call(gl, loc, f);
                }
                let unit = 0, ok = true;
                for (const b of l.binds) {
                    const as = assets[b[1]], loc = gl.getUniformLocation(p, b[0]);
                    if (!as) { ok = false; break; }      // the service stalls a layer whose asset has no pixels
                    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, as.tex);
                    if (loc) gl.uniform1i(loc, unit);
                    unit++;
                }
                if (ok) gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            }
            gl.activeTexture(gl.TEXTURE0);
        }
        return { putAsset, draw, gl, errors };
    }
    root.CRDraw = { create };
})(typeof window !== 'undefined' ? window : this);
