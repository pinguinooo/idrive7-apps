<img src="icon.png" width="70" alt="Shift Lights icon">

# Shift Lights for iDrive 7

RPM shift lights for BMW iDrive 7 (MGU) on the instrument cluster and the HUD, as an app for the
[mgu-store](https://github.com/robertnisipeanu/mgu-store). OEM-style M slats light up from the outside in,
amber then red, with their own thresholds per drive mode and a lower limit while the engine is cold.
The centre-screen page shows a live preview and the settings.

## Status

**Untested on a real car.** So far it has only run in the upstream idrive7-apps emulator, against a fake
cluster-render service, and in Node 8 unit tests. Read the Safety section before you install it.

## Requirements

- An iDrive 7 head unit with the mgu-store installed.
- The **cluster-render** tool from `robertnisipeanu/idrive-apps` (Store, Cluster renderer). Install it
  first: the app draws on the cluster and the HUD through it. Without it the app runs, but nothing reaches
  the cluster or the HUD.
- The upstream idrive7-apps source, `cauliflowermossgrape/idrive7-apps` (one of the Store's default sources). The Store installs its GPU renderer and
  controller gate with this app. The controller gate loads into the HMI at the next head-unit start.

## Install

1. In the Store: Settings, **Add source**, type `pinguinooo/idrive7-apps`, OK (the [repo README](../../README.md) has the same steps for every app here).
2. If the repo's page opens, pick **Branch main**. Or type `github.com/pinguinooo/idrive7-apps/tree/main`
   in step 1 to add it on main directly.
3. In the Store: Shift Lights, Install. The head unit builds the app from this source with its own oap-sdk.

Updates follow the `main` branch.

## Settings

| Setting | Values | Default |
|---|---|---|
| HUD | on / off | off |
| Instrument cluster | on / off | off |
| Which display when both are on | HUD, Instrument cluster, Experimental: HUD + cluster centre area | HUD |
| Only in Sport+ | on / off | off |
| Start with the car | on / off | on |
| Shift lights lead (light up early by this much) | Off, 20 to 150 ms | 60 ms |
| Fast RPM (ask the car when its updates are slow) | on / off | on |
| HUD: style | Shift bar + rev bracket, large; Shift bar + rev bracket, small; Shift bar only; Rev bracket + gear only | large |
| HUD: size | 70 to 120 % | 100 % |
| HUD: move left / right | 100 px left to 100 px right, steps of 10 | Centre |
| HUD: move up / down | 60 px up to 60 px down, steps of 10 | Centre |
| HUD: brightness, Cluster: brightness | 20 to 100 % | 100 % |
| HUD: night dim, Cluster: night dim | on / off | off |
| Cluster: style | M slats, large; M slats, small; Centre row (12 segments); Stock look (one block per dial) | M slats, large |
| Cluster: size | 70 to 120 % | 100 % |
| Cluster: move left / right | 50 px left to 50 px right, steps of 5 | Default |
| Cluster: move up / down | 40 px up to 40 px down, steps of 5 | Default |
| Drive mode if the car does not send it | Comfort, Sport, Sport+ | Sport |
| Comfort / Sport / Sport+: first light | Default, 2000 to 6500 rpm | Default |
| Comfort / Sport / Sport+: shift (red) | Default, 2500 to 6900 rpm | Default |
| Screen layout | Full screen, Standard | Full screen |
| Renderer | GPU 60 fps, Software | GPU 60 fps |
| Demo data | Auto, Always, Never | Auto |

"HUD" and "Instrument cluster" each turn one display on or off, and the app screen has a button for each.
A new install starts with both off. Settings saved by 0.2.x move over on the first start: a display that was
showing stays on.

"Default" uses the built-in thresholds for that mode.

### HUD and cluster together

The car shows the cluster panel and the HUD from one scene, so only one of them at a time. With both on,
"Which display when both are on" picks the one you get: the HUD (default) or the instrument cluster. The app
screen says which one is showing and that the other is on but not showing. The third choice, HUD plus the
lights in the cluster's centre area, is experimental: on a G01 in the M layout that area showed nothing.

### Drive mode and Only in Sport+

The app reads the car's drive mode (Driving Experience Control). The per-mode thresholds follow it, and "Only
in Sport+" shows the lights only while the car is in Sport+. When the car sends no drive mode, the setting
"Drive mode if the car does not send it" is used, and the app screen says "(SETTING, NO SIGNAL)".

### Start with the car

The app starts with the car (it is installed as an autostart app). With this setting off, it still starts,
but sends nothing to the cluster or the HUD until you open its screen once.

### Cluster position

Since 0.3.1 the cluster bar sits 25 px lower than in 0.3.0 (the M slats' top edge at y 134 of the 1920 x 720
panel, was 109). "Cluster: move" shifts it from there in 5 px steps; a move that would put the bar off the
panel falls back to the default place. Keep it clear of the dial numerals either side.

### Lead and Fast RPM

The car sends the engine speed only when it changes, and not very often, so the lights trail the real rpm by up
to one update. Two settings close that gap:

- **Shift lights lead** lights each light that much earlier while the rpm climbs (from the slope of the last
  150 ms; nothing when the rpm is steady, falls, or climbs under 1,000 rpm/s). Lights go out a little later by
  the same amount, so they don't flicker. Off gives 0.3.0's behaviour.
- **Fast RPM** asks the car for the rpm (its getter) when no update came for 40 ms: at most 25 times a second,
  one request at a time, backing off to once every 2 s if the car doesn't answer.

### HUD position

The HUD art is centred on the stock speed. "HUD: move" shifts it if it sits off centre on your car; a bigger
size grows upward, away from the speed. The app draws no speed or unit: the stock HUD shows those.

## Safety

- Kill switches, fastest first: turn **HUD** and **Instrument cluster** off (or the app screen's buttons), a
  file named `DISABLE` in the app's data folder (its path is in the log line `kill switch file:`), or Remove
  in the Store.
- Never kill the app or MainApp by hand. The car counts a hand kill as a crash. Restart it only from the
  Store, and at most once.
- Never reinstall an app that crashed. Remove it with the Store.
- The app stops all cluster and HUD output after 5 errors in 10 seconds. Turn a display off and on to reset
  that. Demo data never reaches the cluster or the HUD.

## Latency

Measured on claudius-vm under Node 8 with `test/adam_shiftlights/latency_trace.js` (the real main.js and kit
car.js against a fake car and a fake cluster-render, 5 pulls at 3000 rpm/s; the getter is the best case):

- The app's own delay from an rpm update to the cluster-render message is about 0.2 ms (p50) in every mode.
  0.3.0's 30 fps software preview stalled it up to 25 ms; the 10 fps cap keeps it under 1 ms (p95).
- What the driver sees is set by the car's update rate: with no lead, 47 ms (p50) behind the rpm at 10 updates
  a second, 22 ms at 20. Fast RPM with a fresh getter: 19 and 15 ms. Lead 60: about 40 ms early at the socket,
  which leaves room for the cluster's own flush and refresh (not measured here).
- Re-run: `node --expose-gc test/adam_shiftlights/latency_trace.js --hz 10 --lead 60 --poll on --preview gpu`
  (`--app <older checkout>/apps/adam_shiftlights` for a before run).

## For developers

- Self-check from the repo root (Node 8 is what the car runs): `NODE=/path/to/node8 tools/check.sh`. It syntax-checks every app
  and the kit, checks the cluster-render client against its pinned commit, then runs the unit tests (this app's are in
  `test/adam_shiftlights/`).
- Build like the head unit does: put an `oap-sdk/` (index.js and package.json, made from your own car's
  donor with upstream idrive7-apps' `kit/tools/extract_sdk.js`) at the repo root, then
  `python3 kit/tools/build.py adam_shiftlights`. The package lands in `dist/`. Never commit `oap-sdk/` or a
  built package.
- Icon: `python3 kit/tools/render_icons.py --tile adam_shiftlights` (needs Pillow and headless Chromium)
  renders `kit/icons/adam_shiftlights.svg` to `apps/adam_shiftlights/icon.png`.
- The emulator and shader tests live in the private working repo, not here.
- Don't publish GitHub Releases or tags unless they carry packages. The Store reads this repo as a repo
  tree on its branch.

## Licences

The app's own code is MIT (`LICENSE`). `kit/` is part of
[idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps), MIT (`kit/LICENSE`, `kit/NOTICE`), unmodified
but for one line in `kit/tools/build.py` that copies app.json's `"mguAppStartType"` into `package.json`.
`apps/adam_shiftlights/cluster_render_client.js` is from
[idrive-apps](https://github.com/robertnisipeanu/idrive-apps), MPL-2.0 (`apps/adam_shiftlights/NOTICE`).
No BMW code or SDK is in this repo.
