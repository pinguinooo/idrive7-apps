'use strict';
/* Distances between points, boxes and convex polygons ([[x, y], ...]) for the corner-label clearance tests. */
const segDist = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
const edges = (q) => q.map((a, i) => [a, q[(i + 1) % q.length]]);
const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
/** p inside (or on) convex polygon q, either winding. */
function inside(p, q) {
    const s = edges(q).map((e) => cross(e[0], e[1], p));
    return s.every((v) => v >= 0) || s.every((v) => v <= 0);
}
const crosses = (e, f) => cross(e[0], e[1], f[0]) * cross(e[0], e[1], f[1]) < 0 && cross(f[0], f[1], e[0]) * cross(f[0], f[1], e[1]) < 0;
/** Distance from point p to convex polygon q: 0 inside. */
function pointPoly(p, q) {
    return inside(p, q) ? 0 : Math.min.apply(null, edges(q).map((e) => segDist(p, e[0], e[1])));
}
/** Distance between convex polygons a and b: 0 if they overlap. */
function polyPoly(a, b) {
    if (a.some((p) => inside(p, b)) || b.some((p) => inside(p, a))) return 0;
    if (edges(a).some((e) => edges(b).some((f) => crosses(e, f)))) return 0;
    return Math.min(Math.min.apply(null, a.map((p) => pointPoly(p, b))), Math.min.apply(null, b.map((p) => pointPoly(p, a))));
}
/** The w x h axis-aligned box centred at c, as a polygon. */
const box = (c, w, h) => [[c[0] - w / 2, c[1] - h / 2], [c[0] + w / 2, c[1] - h / 2], [c[0] + w / 2, c[1] + h / 2], [c[0] - w / 2, c[1] + h / 2]];

module.exports = { pointPoly, polyPoly, box };
