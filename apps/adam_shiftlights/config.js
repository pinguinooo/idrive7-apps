'use strict';
/* ===================== EDIT HERE =====================
 * Every tunable of the shift lights lives in this file. Change numbers here only: app.json settings only
 * switch things on the car (a threshold setting of 0 means "the value here"), and test/config.test.js checks
 * that app.json's defaults match this file.
 * Values come from docs/mockups/shiftlights-v4-oem.html (cluster) and docs/mockups/hud-m-style.html (HUD).
 * [U] = a guess until Adam's photos / car day. Node 8: plain ES2017 only.
 *
 * Styles: the cluster and the HUD each show the style picked in the in-car settings ("Cluster: style",
 * "HUD: style"), independently. A slat bar is described at its base (bottom edge): `inner` = axis to the
 * innermost slat's inner edge, then `perSide` slats of width `slat` every `pitch` px; `shear` = how far the
 * top edge moves (px): 'mirror' = toward the axis on both sides ('/' left, '\' right), 'same' = right on
 * both sides ('/'), 'none' = upright. `palette` = one side in lighting order (outer end first when the fill
 * is inward); a bar with a centre slat (`centre` = its half width) gives it the palette's last letter.
 * `reds` = how many of the palette's last fields light together at the shift point.
 */
module.exports = Object.freeze({
    engine: {
        idle: 750,              // rpm at idle (preview only)
        limitWarm: 7000,        // the engine's allowed maximum, warm (rpm)
        limitCold: 4500,        // the allowed maximum with the oil fully cold (rpm)
        oilCold: 30,            // at or below this oil temperature (C) the limit is limitCold
        oilWarm: 80,            // at or above this oil temperature (C) the limit is limitWarm; linear in between
        shiftBelowLimit: 150,   // a shift point never sits closer than this to the current limit (rpm)
        limiterBand: 100,       // the whole bar flashes red from this far under the limit (rpm)
        hysteresisRpm: 50,      // a light, red or flash goes off only this far under where it came on (no flicker)
    },
    modes: {                    // per drive mode: first light at `start`, all red at `shift` (rpm)
        comfort: { start: 4000, shift: 5000 },     // an earlier shift hint
        sport: { start: 6000, shift: 6800 },       // OEM guess (Sport = Sport+)
        sportplus: { start: 6000, shift: 6800 },
    },
    display: 'off',             // first install shows nothing: off | cluster | hud | both (app.json default too)
    driveMode: 'sport',         // until a drive-mode signal is found, the mode is a setting (app.json default too)
    styles: { cluster: 'large', hud: 'large' },   // the style settings' defaults (app.json too)
    sizeSteps: [70, 80, 90, 100, 110, 120],       // "size" setting steps (%): scales the shift-light bar about its centre
    brightSteps: [20, 40, 60, 80, 100],           // "brightness" setting steps (%)
    nightDim: 0.35,             // "night dim" on: brightness x this [U] (no lights-on signal yet)
    flashHz: 4,                 // limiter flash, on half / off half per cycle (4 to 20) [U]
    brightness: 1.0,            // 0..1, multiplies every lit colour on the cluster and HUD (with the settings)
    colors: {
        y: '#ffc20e', o: '#ff7a00', r: '#ff2b1f', w: '#f2f5f8',   // the "before" looks: Row v3, classic HUD cells, stock
        a: '#ffa800', c: '#ff1a22',                               // cluster M slats large: amber, red
        A: '#f3ab10', C: '#ee1c25',                               // cluster M slats classic (and the stock blocks' red)
        Y: '#ffd000', O: '#ff7000', R: '#ff1a14',                 // HUD bar
        cream: '#ebecc8', rail: '#fbfbe8', zy: '#eef0a8', zr: '#ee6a64',   // HUD bracket: fill, rail, red-zone marks
    },
    // where the cluster style goes on the map target when both displays show (panel and hud share one scene):
    // the panel rect moved by this, y at least minY [U]
    mapOffset: { x: 416, y: 126, minY: 8 },
    clusterStyles: {            // on the 1920x720 panel, axis x 960 (cy = the bar's centre y)
        large: { palette: 'aaaaaaaacc', reds: 2, fill: 'inward', lean: 'mirror', perSide: 10, slat: 15.6, pitch: 18.6, inner: 36,
            centre: 0, h: 82.8, shear: 29.81, cx: 960, cy: 150, glow: 30, dim: 0.2 },        // v4 at size 1.8: 438 x 83 at 741,109
        classic: { palette: 'AAAAAAAACC', reds: 2, fill: 'inward', lean: 'mirror', perSide: 10, slat: 15, pitch: 18, inner: 30,
            centre: 0, h: 46, shear: 22.08, cx: 960, cy: 150, glow: 0, dim: 0.13 },           // v4 first version: 414 x 46 at 753,127
        row: { palette: 'yyyoor', reds: 1, fill: 'inward', lean: 'none', perSide: 6, slat: 25, pitch: 29, inner: 2,
            centre: 0, h: 22, shear: 0, cx: 960, cy: 145, glow: 0, dim: 0 },                   // v3: 12 fields, 344 x 22 at 788,134
        stock: { palette: 'yoC', reds: 1, fill: 'inward', lean: 'mirror', stage: true, perSide: 1, slat: 40, pitch: 40, inner: 205.3,
            centre: 0, h: 92, shear: 50.6, cx: 960, cy: 185, glow: 14, dim: 0 },               // one block a dial: yellow, orange, red [U]
    },
    hudStyles: {                // on the 800x480 HUD scene
        bar: { palette: 'YYYYYOOR', reds: 1, fill: 'inward', lean: 'same', perSide: 7, slat: 30, pitch: 36, inner: 33.6,
            centre: 30.6, h: 52, shear: 18.72, cx: 390.64, cy: 118, glow: 13, dim: 0.16 },     // 578 x 52 at 111,92
        cells: { palette: 'yyyyyoor', reds: 1, gap: 0.14, pad: 1.8 },   // classic: cells in the bracket's bar between start
                                                                        // and shift; gap = share of a cell, pad = u past the bar
        bracket: {              // the M tach bracket 0 to 7, in u (reference px) from its origin, drawn x scale
            path: [[0, 52], [73, 0], [331, 0]], round: 14, rail: 3.6, gapRail: 0.8, bar: 9, numH: 11, numOff: 24,
            tickMajor: 6, cellGap: 1.5, scale: 1.2, origin: [300, 131], below: 8, scaleMax: 7000,
            redzone: { yellow: 6000, red: 6500 },
            gear: { x: 401, y: 237, h: 27.6 }, line: { x0: 340, x1: 431, y: 261 }, unitAt: [434, 264], unit: 'mph',   // scene px [U]
        },
    },
    safety: {
        errorLimit: 5,          // this many caught errors ...
        errorWindowMs: 10000,   // ... within this window stop all cluster/HUD output (the app keeps running)
        killFile: 'DISABLE',    // a file of this name in the app's data folder turns all output off
        killPollMs: 1000,       // how often the kill file is looked for
    },
});
