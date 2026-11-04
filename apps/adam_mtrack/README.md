# M Track Cluster (`adam_mtrack`) 0.1.1

An M Track style cover over the instrument cluster, drawn by the cluster-render service on its `panel` target
(1920 x 720): two bar tachs from 0 to 7 (x1000 rpm, the B58's 7,000 rpm limit), the gear over a line over the speed
in mph, the M badge with our shift-light slats in its place, side panels you pick, fuel and oil corner gauges, range,
clock and outside temperature. Built for a 2024 X3 M40i (G01 LCI, iDrive 7, US units). **Off when installed.**

It covers the real speedometer, so it only shows while every guard holds, and drops at once when one fails.

## Settings (on the centre screen)

| Page | What |
|---|---|
| Home | **Cover the cluster** On/Off (default Off); **When to show**: Sport+ only (default), Sport and above (Sport, Sport individual, Sport+), Always; "Why the cover is off right now: ..." and the signals it reads (speed, drive mode, BMW popups) |
| Panels | Left panel, left lower half, right panel, right lower half (from the 22-widget catalogue: a whole widget takes both halves), Swap sides. Widgets with no signal on the car are skipped and say "No signal on this car" |
| Look | Units: US (mph, psi, F, lb-ft, hp, mi, mpg), Metric, Follow car; Brightness; Night dim; Shift lights in the cover |
| Safety | **BMW popups**: Use if sent (default), Require, Ignore; **Drop the cover if the drive-mode signal is missing** (default Off); **Speed timeout** 0.5 to 3 s (default 1 s, the guard itself is always on); why the cover is off right now; every signal the guards read (present / missing / stale); every always-on guard with its state and why it has no switch |
| About | Version, what is unproven on the car, the widgets not in this version, how to remove it safely, Shift Lights |

Settings apply live and are saved; a bad saved value falls back to its default (logged once), and a bad Safety value
to its strict side (BMW popups: Require; drop if no drive mode: On; speed timeout: 1 s). The pages are drawn only when
something changes (a setting, the reason the cover is off, a signal's status): no timers, no preview.

Widgets in 0.1.0: Tyre data, G-meter, Trip data, Drive-mode column, Coolant, Boost, Torque, Power, Consumption (average),
Oil temperature, Fuel level, Range, 0-60 mph timer, Warm-up, Empty. Not in 0.1.0 (no car signal for apps): Entertainment,
Intake air, Oil pressure, Gearbox oil, xDrive split, Battery voltage, Dyno peak, Service due.

## Safety

The cover shows only when every guard has held for 1 s (`logic.decide`); any one failing drops every layer (`drop`,
not hidden) within one 100 ms tick. Home and the Safety tab say which guard holds it off and its signal's status
("Why the cover is off right now: Speed timeout: speed signal stale (none for 1 s)"); the log has the same line
(`why off: ...`, once a reason per 10 s) and the popup signal's state (`BMW popup signal (CheckControlMaster): ...`).

| Guard (reason) | Protects | Switch |
|---|---|---|
| Cover the cluster (`off`) | the master switch | Home |
| Kill switch (`kill`): a file named `DISABLE` in the app's data folder; a failed check counts as found | an off switch that needs no screen | none |
| Error guard (`error`, `tripped`): any error drops it for 1 s; 5 in 10 s disarm it until Cover the cluster goes off and on | a broken app over the speedometer | none |
| Live data only (`demo`) | invented numbers over the real gauges | none |
| Art check (`noart`): art missing or damaged, never arms | a half-drawn cover | none |
| Cluster renderer (`renderer`) and BMW's panel (`held`, `hud`): BMW's popup or speech dialog, or Shift Lights' HUD, holds the panel | the renderer's own arbitration | none |
| **BMW popups** (`nocc`, `ccwait`, `cc`): CheckControlMaster `basicList` (an active message) and KombiInterface_2 `newCCMessage` (a new one, 1 s) | BMW warnings stay visible | Safety: Use if sent / Require / Ignore |
| **Speed timeout** (`nospeed`): a valid `Vehicle2.statusCarSpeed2` (not 65535) within the timeout, notified or polled every 250 ms; a speed stamped in the future (a clock jump) counts as stale | a frozen speed over the real speedometer | always on; only the time, 0.5 to 3 s |
| **Drop if no drive mode** (`nomode`) | no cover while the drive mode is unknown | Safety: On / Off (default Off) |
| When to show (`mode`): FES `statusFESVehicleDynamicSwitchHMI`, Shift Lights' decoding | the owner's choice of modes | Home |
| Show delay 1 s, clock-jump guard (a backward jump restarts the delay and the heartbeat, a future speed is stale) | flicker; an old speed kept alive | none |
| Heartbeat (dead-man), exit and crash cleanup | a hung or dead app's cover | none |

There is no engine-running guard (the cover can show with the engine off when the speed is fresh), so none was added.

**BMW popups.** *Use if sent* (default): when the car sends the Check Control signal, a popup drops the cover; a car
that never answers it does not block (the signal is "missing", not "present and idle": an empty list that arrived,
or a provider that answered, is present). For the first 10 s after start, before its watch has settled, the signal is
"waiting" and the cover waits for it. *Require* is 0.1.0's rule: no popup signal, no cover. *Ignore* is risky: a BMW
warning can be hidden under the cover (whether popups draw above it is unknown until the car); BMW holding the panel
still drops it. **0.1.0 blocked here on Adam's car**: CheckControlMaster never answered (parked, diagnostic mode),
and `requireCheckControl: true` (a config switch, no setting) kept the cover off for good.

Any error inside a callback drops it at once; five errors in 10 s stop it until Cover the cluster is turned off and
on. Turning the cover off disarms in the settings callback itself and closes the connection.

**Dead-man switch.** Every layer's shader multiplies its output by `u_alive`, whose value is 0; while shown, the app
restarts an animation every 250 ms that holds it at 1 for 1 s and then ramps it to 0. If the app hangs, the renderer
blanks the cover about 1.2 s after the last restart, on its own clock. If the app crashes or exits, its connection
closes and the service drops its layers at once (PROTOCOL.md: layers go with the connection). If the service itself
dies, the KOMBI drops the content within about 10 s.

**Kill switches**, fastest first: Home > Cover the cluster Off; a file named `DISABLE` in the app's data folder (its path
is the first log line); Store > M Track Cluster > Remove. Never kill or restart the app or MainApp by hand: three
crashes in about 30 s wipe every app. No saved setting can switch an always-on guard off: the speed timeout is held to
0.5 to 3 s in the decision itself, and the kill file name, the error limit and the heartbeat live in `config.js` only.

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
idle, a pull to 7,000, the drive modes, a speed loss, a Check Control popup, BMW holding the panel, the kill file and
the BMW popups choice, and the app's own "why off" line under the panel. `NO_POPUPS=1 bash test/adam_mtrack/view.sh`
plays a car that sends no Check Control signal (Adam's G01 in the 0.1.0 test).
`EMU_DIR` points at an idrive7-apps clone (default `~/Documents/Projects/idrive7-apps-upstream`).
The scripted sweep (`test/adam_mtrack/emu-run.sh`, on claudius-vm) runs every guard (first with no popup signal at
all: Use if sent shows, Require keeps it off and says why), the hang and the crash, and saves PNGs (every settings tab,
the Safety tab with a guard holding the cover off) and the pull clip. `test/adam_mtrack/shader_check.mjs` compiles
every shader under WebGL1 and probes pixels.

**The emulator proves:** the app's logic and every guard with its timing (mode, speed loss, popup, BMW take-over, kill
file, error, hang, crash); the exact message stream (layers, assets, uniforms, animations); the shaders compiling and
drawing in GLSL ES 1.00; the art and geometry at 1920 x 720; the settings pages.
**Only the car proves:** that a G01 shows the `panel` scene at all, and in Sport+; that its opaque pixels hide the OEM
gauges; whether Check Control popups draw above or below; the KOMBI GPU's shader compile and frame rate; the renderer's
clock for the dead-man; pixel mapping, brightness, latency; the real signal values (drive modes, speed getter, boost
scale, range unit) and the speed factor against the OEM speedometer; coexistence with Shift Lights' HUD.
cluster-render's own unit emulator needs the head unit's root filesystem, so it is not used here.

## Untested on the car (0.1.1)

The panel on a G01, the speed factor (`config.speedFactor` 1.0: the OEM speedometer usually over-reads), popups above or
below, the KOMBI shader compile and GPU, the renderer clock for the dead-man, the speed getter poll, FES values, the boost
scale, the range unit, the clock time zone, and which signals the car sends at all (in 0.1.0 CheckControlMaster never
answered, parked in diagnostic mode; the Safety tab lists each one as present, missing or stale). First car test: parked,
engine on, cover on, Sport+ only (or Always if the car sends no drive mode parked); read the Safety tab; check it appears
only when allowed and drops when leaving it. Never drive with it until the drops are proven parked, and never drive with
BMW popups on Ignore.

## Files

`main.js` wiring; `logic.js` decisions (pure); `geom.js` geometry; `output.js` the cluster-render side; `shader.js`;
`widgets.js` the live boxes; `pages.js` / `ui.js` the settings pages; `units.js`, `settings_check.js`, `safety.js`, `poll.js`
(copies from the sibling apps, extended); `catalogue.js`; `config.js` every tunable; `emufeed.js` emulator only (loaded only
when `MTRACK_EMU_FEED` is set, never on a car); `cluster_render_client.js` the pinned MPL client (see NOTICE).
Tests: `test/adam_mtrack/` (`node test/run.js`).
