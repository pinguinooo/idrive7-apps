'use strict';
/* ===================== EDIT HERE =====================
 * Every tunable of M Track Cluster. app.json settings only pick between the choices drawn from here;
 * test/adam_mtrack/manifest.test.js checks app.json's defaults against this file.
 * Geometry is in the panel's own pixels (1920 x 720, axis x 960) and comes from the approved mockup
 * (iDrive-Apps docs/mockups/mtrack-cluster.html, commits e6b1072 / aedb0f6); geom.js holds the traced paths.
 * [U] = unproven until the car. Node 8: plain ES2017 only.
 */
module.exports = Object.freeze({
    // the bar tachs: 0 to 7 (x1000 rpm), the B58's limit is 7000 (Adam: "my BMW doesn't go up to 8")
    tach: {
        max: 7000,              // the top of the scale = the top tick (the mockup's old "8" tick place)
        firstStep: 0.11,        // 0 to 1,000 rpm takes this share of the scale (shorter than the rest, mockup)
        tickEvery: 500,         // a tick every 500 rpm: majors at the 1000s, minors between
        amberFrom: 6000,        // amber dashes along the edge from here to redFrom (static)
        redFrom: 6500,          // red field from here to max (static; the cold limit shows on the slats)
    },
    engine: {
        limitWarm: 7000,        // the engine's allowed maximum, warm (rpm)
        limitCold: 4500,        // the allowed maximum with the oil fully cold (rpm) [U]
        oilCold: 30,            // at or below this oil temperature (C) the limit is limitCold
        oilWarm: 80,            // at or above this (C) the limit is limitWarm; linear in between
        shiftBelowLimit: 150,   // a shift point never sits closer than this to the current limit (rpm)
        limiterBand: 100,       // all slats flash from this far under the limit (rpm)
        hysteresisRpm: 50,      // a slat, red or flash goes off only this far under where it came on
    },
    modes: {                    // slats per drive mode: first light at start, all red at shift (as Shift Lights)
        comfort: { start: 4000, shift: 5000 },
        sport: { start: 6000, shift: 6800 },
        sportplus: { start: 6000, shift: 6800 },
    },
    flashHz: 4,                 // limiter flash rate [U]
    // our shift-light slats in the M badge's place (Shift Lights' "large" M slats, mockup CONFIG.row, cy 250)
    row: { palette: 'aaaaaaaacc', reds: 2, fill: 'inward', lean: 'mirror', perSide: 10, slat: 15.6, pitch: 18.6, inner: 36,
        centre: 0, h: 83, shear: 29.88, cx: 960, cy: 250, glow: 30, dim: 0.2 },
    colors: { a: '#ffa800', c: '#ff1a22' },
    safety: {
        errorLimit: 5,          // errors within errorWindowMs stop the cover (Shift Lights' rule)
        errorWindowMs: 10000,
        killFile: 'DISABLE',    // this file in the app's data folder turns the cover off (path logged at start)
        killPollMs: 250,        // the cover loop looks for it this often (and on every tick)
        speedStaleMs: 1000,     // no valid speed for longer than this: the cover drops (it covers the speedometer);
                                // the default of Safety > Speed timeout and what a bad saved value falls back to
        speedStaleMinMs: 500,   // the Speed timeout setting stays within these (app.json steps); outside: speedStaleMs
        speedStaleMaxMs: 3000,
        signalWaitMs: 10000,    // a signal not answered this long after start counts as missing (BMW popups waits for it)
        showHoldMs: 1000,       // every condition must hold this long before the cover shows (again)
        tickMs: 100,            // the cover loop's period: a drop happens within one tick of its cause
        aliveResendMs: 250,     // dead-man switch: u_alive's animation is restarted this often while shown
        aliveKeys: '0:1 1000:1 1200:0',   // the renderer blanks the cover 1.2 s after the last restart [U]
    },
    // speed (and rpm) are only notified on change: a parked car goes quiet, so the getter is polled
    speedPoll: { pollMs: 250, pollIdleMs: 500, pollTimeoutMs: 400, pollMaxBackoffMs: 2000 },
    rpmPoll: { pollMs: 50, pollIdleMs: 500, pollTimeoutMs: 200, pollMaxBackoffMs: 2000 },
    speedFactor: 1.0,           // shown speed = true speed x this; calibrate against the OEM reading on car day [U]
    tankLitres: 65,             // G01 tank for the fuel gauge (no signal for it) [U]
    nightDim: 0.35,             // "Night dim" on: brightness x this [U] (no lights-on signal is read)
    uploadBudgetBytes: 4500000, // asset bytes uploaded at arm, at most (art/art.json + the four panel boxes): under one
                                // second of cluster-render's shared 5500 KB/s ceiling (cluster-render.conf upload_kb_per_s)
    renderer: {                 // cluster-render's own behaviour (idrive-apps cluster-render.conf, README "Arbitration")
        lingerMs: 3000,         // panel_linger_ms: a panel no layer wants is released (unmapped) this long after
        verifyMs: 6000,         // a drop or close whose panel is not idle again by now is logged "release NOT confirmed"
        heldBackoffMs: 10000,   // after BMW's content took the panel, the cover asks again only this much later (no map /
                                // unmap churn on slot 0x203 while BMW keeps it)
    },
    test: {                     // the test pattern on the Safety page (ladder.js)
        stepMs: 10000,          // each step removes itself after this long
        statusAfterMs: 2500,    // the renderer's status is asked for this long into a step (shown on the page)
        parkedKmh: 3,           // a step runs only below this speed (or in P), and stops when the car goes faster
        connectMs: 5000,        // a step whose client gets no answer from cluster-render this long is given up
    },
    diagLogKb: 256,             // mtrack-diag.log (what was sent to cluster-render and what came back), then .1
    zBase: 900,                 // the cover's base layer z (overlay class, exclusive); its other layers sit above
    panelHz: 2,                 // side panels and corners redraw at most this often
    statsLogMs: 30000,          // the speed alive / poll log line
    // the car's raw values (BMW scalings, as Engine Vitals): value = raw x factor + offset; invalid = no value
    scaling: {
        temp: { factor: 1, offset: -48, invalid: 255 },
        ambient: { factor: 0.5, offset: -40, invalid: 255 },
        boost: { factor: 0.01, offset: 0, invalid: 255 },
        tyrePress: { factor: 0.1, offset: 0, invalidFrom: 65532 },
        tyreTemp: { factor: 1, offset: -40, invalid: 65535 },
        speedRaw: { factor: 0.015625, offset: 0, invalid: 65535 },
        rpmRaw: { factor: 0.25, offset: 0, invalid: 65535 },
    },
});
