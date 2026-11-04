# Adding an app

The Store lists every folder under `apps/` that holds an `app.json`. Adding one needs no change to
`mgu-repo.json`, the check script or the test runner.

## Steps

1. `cp -R apps/_template apps/<new_id>`.
2. Edit `apps/<new_id>/app.json`: `id` (the folder name), `title`, `description`, `version`, `loggingId`,
   `signals`, `screens`, `settings`.
3. Replace `apps/<new_id>/icon.png` (the template's is a placeholder, a copy of the Shift Lights icon).
4. Write `main.js` (and any modules next to it). Delete `README.md` from the copy or replace it with the app's own
   (what it does, settings, safety, status).
5. Optional: unit tests in `test/<new_id>/*.test.js` (the runner finds them).
6. Run `NODE=/path/to/node8 tools/check.sh`. Fix everything it reports.
7. Test it in the emulator (below), commit, push `main`. The Store picks up the new commit.

## Ids and versions

- `id` is the folder name, matches `[a-z0-9][a-z0-9_-]{0,63}`, and is global on a head unit: use the prefix
  `adam_` so it cannot collide with a BMW app id (`store`, `x_call`) or another source's app. `apps.test.js`
  fails when `id` differs from the folder name, or two apps share an id or `loggingId`.
- `version` is `x.y.z` (semver). Bump it on every change you want cars to update to. With the same version a
  new commit still shows as a new revision (its short sha), so the bump is for people reading it.
- `loggingId` is a 4-character log tag, unique per app (BMW uses `OA1x`, upstream `OA93` to `OAA2`; the template
  uses `OAT0`, Shift Lights `OAD1`).
- A folder starting with `_` is never an app (an id cannot start with `_`). The Store skips `_template` because
  `mgu-repo.json` lists it in `exclude`; to park another work-in-progress folder, add its name to that list.

## Icon

`apps/<id>/icon.png`: PNG, 140 x 140, at most 128 KiB (the Store's limit; the car's app list shows 140 x 140).
The self-check tests it. Draw it as SVG in `kit/icons/<id>.svg` and render it with
`python3 kit/tools/render_icons.py --tile <id>` (needs Pillow and headless Chromium), or supply your own PNG.

## Node 8 rules

The car runs Node 8. In `apps/<id>/*.js` use none of: `?.`, `??`, `import`/`export`, class fields, object
spread or rest in object literals, `Array.prototype.flat`/`flatMap`, optional catch binding, `Object.fromEntries`,
`String.prototype.matchAll`. `tools/check.sh` runs `node --check` on every app file, which only proves the syntax
under a real Node 8 (it warns when run under another). Pass `NODE=/path/to/node8`.

## Crash-loop safety

The platform treats a crash as a fault: an app's first crash wipes its data folder, its second uninstalls it, and
three MainApp deaths within about 33 seconds make it delete every app and its data. So:

- Nothing may throw out of a callback. The kit exits the app on an uncaught exception. Wrap every callback
  (samples, timers, settings changes, button clicks, draw loops, socket events) so an error is logged and counted,
  never thrown (the template's `guard`; Shift Lights' `safety.js`).
- Stop on repeated errors: after N errors in a short window, the app stops what it is doing (Shift Lights: 5
  in 10 seconds stop all output) and says so on screen, but keeps running.
- Give the owner kill switches, fastest first: a setting that turns the output off, a `DISABLE` file in the app's
  data folder (log its path at start), and Remove in the Store. Default anything that touches the cluster or HUD to
  off until the owner picks it.
- Never restart or kill an app or MainApp by hand while testing on a car; never reinstall an app that crashed,
  remove it with the Store.
- Bad saved settings fall back to defaults and log once; never throw.
- Demo or fake data must never reach the car's cluster or HUD.

## Which tools an app needs

`mgu-repo.json` `apps.requires` applies to every app: the GPU renderer and the controller gate. A pattern-level
`requires` replaces an app's own `requires` in `app.json`, so it cannot be used to add one tool for one app. If one
app needs different tools, add its folder to `exclude` and give it its own entry in a `components` list in
`mgu-repo.json` (`id`, `kind: "app"`, `path`, `manifest`, `icon`, `mguHmi`, `requires`, and the same `build` as the
pattern). Checked with the Store's own repo reader.

## Testing in the emulator

The emulator is upstream's, not in this repo (it needs the app's own build):

1. `git clone https://github.com/cauliflowermossgrape/idrive7-apps` next to this repo, and link or copy your app:
   `ln -s <this repo>/apps/<id> idrive7-apps/apps/<id>`.
2. In the clone: `python3 kit/tools/build.py <id>` then `node kit/tools/emu.js <id>`, open http://localhost:8077.
   It rebuilds on each save. Its docs: `docs/emulator.md` in that clone.
3. Click through every screen and setting, set the signals to extremes and to nothing, and read the app log for
   `error in` lines. Node 22 runs the emulator; keep the app code Node 8 (the check script proves that).
4. Stop the emulator when done.

Nothing here talks to a car. First installs on a car follow the owner's car-day checklist.
