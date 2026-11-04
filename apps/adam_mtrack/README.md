# M Track Cluster (`adam_mtrack`) 0.1.0

An M Track style cover over the instrument cluster, drawn by the cluster-render service on its `panel` target
(1920 x 720): two bar tachs from 0 to 7 (x1000 rpm, the B58's 7,000 rpm limit), the gear over a line over the speed
in mph, the M badge with our shift-light slats in its place, side panels you pick, fuel and oil corner gauges, range,
clock and outside temperature. Built for a 2024 X3 M40i (G01 LCI, iDrive 7, US units). **Off when installed.**

It covers the real speedometer, so it only shows while every guard holds, and drops at once when one fails.

## Settings (on the centre screen)

| Page | What |
|---|---|
| Home | **Cover the cluster** On/Off (default Off); **When to show**: Sport+ only (default), Sport and above (Sport, Sport individual, Sport+), Always; what the cover is doing now and why |
| Panels | Left panel, left lower half, right panel, right lower half (from the 22-widget catalogue: a whole widget takes both halves), Swap sides. Widgets with no signal on the car are skipped and say "No signal on this car" |
| Look | Units: US (mph, psi, F, lb-ft, hp, mi, mpg), Metric, Follow car; Brightness; Night dim; Shift lights in the cover |
| About | Version, what is unproven on the car, the widgets not in 0.1.0, how to remove it safely, Shift Lights |

Settings apply live and are saved; a bad saved value falls back to its default (logged once). The pages are drawn
only when something changes: no timers, no preview.

Widgets in 0.1.0: Tyre data, G-meter, Trip data, Drive-mode column, Coolant, Boost, Torque, Power, Consumption (average),
Oil temperature, Fuel level, Range, 0-60 mph timer, Warm-up, Empty. Not in 0.1.0 (no car signal for apps): Entertainment,
Intake air, Oil pressure, Gearbox oil, xDrive split, Battery voltage, Dyno peak, Service due.

## Safety

The cover shows only when all of these have held for 1 s (`logic.decide`):

- Cover the cluster is On, no kill file, not stopped after errors, live data (never on demo data);
- the drive mode is allowed by When to show (FES `statusFESVehicleDynamicSwitchHMI`, Shift Lights' decoding);
- a valid speed (`Vehicle2.statusCarSpeed2`, not the 65535 "no value") arrived within 1 s, notified or read with
  its getter (a parked car stops notifying; the app polls every 250 ms). No speed signal: the cover never shows;
- no active Check Control message and none new within 1 s; the Check Control list must be readable at all, or the
  cover never shows (`requireCheckControl`);
- BMW does not hold the panel (the target is not `waiting` / `parked`: a popup or the speech dialog), and the
  cluster renderer is connected;
- no error in the last second.

Any of them failing drops every layer (`drop`, not hidden) within one 100 ms tick. Any error inside a callback drops
it at once; five errors in 10 s stop it until Cover the cluster is turned off and on. Turning the cover off disarms
in the settings callback itself and closes the connection.

**Dead-man switch.** Every layer's shader multiplies its output by `u_alive`, whose value is 0; while shown, the app
restarts an animation every 250 ms that holds it at 1 for 1 s and then ramps it to 0. If the app hangs, the renderer
blanks the cover about 1.2 s after the last restart, on its own clock. If the app crashes or exits, its connection
closes and the service drops its layers at once (PROTOCOL.md: layers go with the connection). If the service itself
dies, the KOMBI drops the content within about 10 s.

**Kill switches**, fastest first: Home > Cover the cluster Off; a file named `DISABLE` in the app's data folder (its path
is the first log line); Store > M Track Cluster > Remove. Never kill or restart the app or MainApp by hand: three
crashes in about 30 s wipe every app.

## With Shift Lights

The cover's base layer is `overlay` z 900 and `exclusive`: while it shows, Shift Lights' cluster slats (same scene,
below it) are suspended, and they come back when it drops. The cover draws its own slats (Look > Shift lights in the
cover). The `hud` and `panel` targets share one scene and are never up at once: while Shift Lights' HUD holds it, the
cover waits (Home says so). Turn Shift Lights' HUD off to use the cover.

## How it draws

The static art is the approved mockup's (iDrive-Apps `docs/mockups/mtrack-cluster.html`) drawn by its own code in
headless Chromium (`tools/mtrack-art/`, re-run gives the same bytes) into `art/art.json`, with the tach scale 0-7 from
`geom.js`. At arm (cover turned on) the art goes up once as assets (about 4.3 MB, budget 4.5 MB, logged); showing and
dropping upload nothing. Effect layers sample it: the base (art, the tach fill up to the revs, the bars' over-art),
the glyphs (gear, speed, unit, mode), the badge, the slats (Shift Lights' shader), the two side panels and two corners
(drawn in software, only the changed rows sent, at most twice a second).

## The emulator

Yes, the cluster can be emulated. On the Mac (or claudius-vm), from this repo:

    bash test/adam_mtrack/view.sh        # then open http://localhost:8090 ; Ctrl-C stops everything

It runs the idrive7-apps emulator (centre screen, embedded in the page) with M Track talking to a stand-in
cluster-render service, and draws the panel from the app's real messages in the browser's WebGL, with buttons for
idle, a pull to 7,000, the drive modes, a speed loss, a Check Control popup, BMW holding the panel and the kill file.
`EMU_DIR` points at an idrive7-apps clone (default `~/Documents/Projects/idrive7-apps-upstream`).
The scripted sweep (`test/adam_mtrack/emu-run.sh`, on claudius-vm) runs every guard, the hang and the crash, and saves
PNGs and the pull clip. `test/adam_mtrack/shader_check.mjs` compiles every shader under WebGL1 and probes pixels.

**The emulator proves:** the app's logic and every guard with its timing (mode, speed loss, popup, BMW take-over, kill
file, error, hang, crash); the exact message stream (layers, assets, uniforms, animations); the shaders compiling and
drawing in GLSL ES 1.00; the art and geometry at 1920 x 720; the settings pages.
**Only the car proves:** that a G01 shows the `panel` scene at all, and in Sport+; that its opaque pixels hide the OEM
gauges; whether Check Control popups draw above or below; the KOMBI GPU's shader compile and frame rate; the renderer's
clock for the dead-man; pixel mapping, brightness, latency; the real signal values (drive modes, speed getter, boost
scale, range unit) and the speed factor against the OEM speedometer; coexistence with Shift Lights' HUD.
cluster-render's own unit emulator needs the head unit's root filesystem, so it is not used here.

## Untested on the car (0.1.0)

The panel on a G01, the speed factor (`config.speedFactor` 1.0: the OEM speedometer usually over-reads), popups above or
below, the KOMBI shader compile and GPU, the renderer clock for the dead-man, the speed getter poll, FES values, the boost
scale, the range unit, the clock time zone. First car test: parked, engine on, cover on, Sport+ only; check it appears only
in Sport+ and drops when leaving it. Never drive with it until the drop on leaving Sport+ is proven parked.

## Files

`main.js` wiring; `logic.js` decisions (pure); `geom.js` geometry; `output.js` the cluster-render side; `shader.js`;
`widgets.js` the live boxes; `pages.js` / `ui.js` the settings pages; `units.js`, `settings_check.js`, `safety.js`, `poll.js`
(copies from the sibling apps, extended); `catalogue.js`; `config.js` every tunable; `emufeed.js` emulator only (loaded only
when `MTRACK_EMU_FEED` is set, never on a car); `cluster_render_client.js` the pinned MPL client (see NOTICE).
Tests: `test/adam_mtrack/` (`node test/run.js`).
