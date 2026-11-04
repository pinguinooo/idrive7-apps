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
| Shift lights on | on / off | on |
| Show on | Off, Cluster, HUD, Cluster + HUD | Off |
| Cluster: style | M slats large, M slats classic, Row v3, Stock blocks, Off | M slats large |
| HUD: style | Bar + bracket large, Bar + bracket classic, Bar only, Bracket + gear only, Off | Bar + bracket large |
| Cluster: size / HUD: size | 70 to 120 % | 100 % |
| Cluster: brightness / HUD: brightness | 20 to 100 % | 100 % |
| Cluster: night dim / HUD: night dim | on / off | off |
| Drive mode | Comfort, Sport, Sport+ | Sport |
| Comfort / Sport / Sport+: first light | Default, 2000 to 6500 rpm | Default |
| Comfort / Sport / Sport+: shift (red) | Default, 2500 to 6900 rpm | Default |
| Screen layout | Full screen, Standard | Full screen |
| Renderer | GPU 60 fps, Software | GPU 60 fps |
| Demo data | Auto, Always, Never | Auto |

"Default" uses the built-in thresholds for that mode. Output starts with **Show on = Off**, so nothing is
drawn on the cluster or the HUD until you pick a display.

## Variants

The cluster and the HUD each pick their own style, switched live:

- Cluster: M slats large, M slats classic, Row v3, Stock blocks, Off.
- HUD: Bar + bracket large, Bar + bracket classic, Bar only, Bracket + gear only, Off.

## Safety

- Kill switches, fastest first: **Show on = Off** (or a display's style set to Off), "Shift lights on" off,
  a file named `DISABLE` in the app's data folder (its path is in the log line `kill switch file:`), or
  Remove in the Store.
- Never kill the app or MainApp by hand. The car counts a hand kill as a crash. Restart it only from the
  Store, and at most once.
- Never reinstall an app that crashed. Remove it with the Store.
- The app stops all cluster and HUD output after 5 errors in 10 seconds. Demo data never reaches the
  cluster or the HUD.

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

The app's own code is MIT (`LICENSE`). `kit/` is an unmodified part of
[idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps), MIT (`kit/LICENSE`, `kit/NOTICE`).
`apps/adam_shiftlights/cluster_render_client.js` is from
[idrive-apps](https://github.com/robertnisipeanu/idrive-apps), MPL-2.0 (`apps/adam_shiftlights/NOTICE`).
No BMW code or SDK is in this repo.
