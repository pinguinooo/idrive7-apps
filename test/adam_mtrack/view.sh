#!/usr/bin/env bash
# The live M Track cluster emulator, on the Mac or claudius-vm:
#   bash test/adam_mtrack/view.sh            then open http://localhost:8090 (Ctrl-C stops everything)
# EMU_DIR: an upstream idrive7-apps clone (default ~/Documents/Projects/idrive7-apps-upstream). This script links
# apps/adam_mtrack into it and adds the emulator's placeholder oap-sdk/ if it is missing (both idempotent).
# EMU_PORT (8077) is the centre screen, VIEW_PORT (8090) the panel view. Needs node 22 or newer. Nothing talks to a car.
# NO_POPUPS=1 bash test/adam_mtrack/view.sh   a car that sends no Check Control signal (Adam's G01 in the 0.1.0 test): see
# the cover with Safety > BMW popups = Use if sent, and the "why off" line with Require (centre screen Safety tab, and
# the app line under the panel).
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$PWD
EMU_DIR=${EMU_DIR:-$HOME/Documents/Projects/idrive7-apps-upstream}
NODE=${NODE:-$(command -v node || echo "$HOME/.local/opt/node22/bin/node")}
[ -d "$EMU_DIR/kit/tools" ] || { echo "no idrive7-apps clone at $EMU_DIR (git clone https://github.com/cauliflowermossgrape/idrive7-apps there, or set EMU_DIR)" >&2; exit 1; }
ln -sfn "$ROOT/apps/adam_mtrack" "$EMU_DIR/apps/adam_mtrack"
if [ ! -f "$EMU_DIR/oap-sdk/index.js" ]; then
  mkdir -p "$EMU_DIR/oap-sdk"
  printf '// emulator placeholder, never shipped (the head unit supplies its own SDK)\nmodule.exports = {};\n' > "$EMU_DIR/oap-sdk/index.js"
  printf '{"name": "oap-sdk", "version": "0.0.0-placeholder", "main": "index.js"}\n' > "$EMU_DIR/oap-sdk/package.json"
fi
(cd "$EMU_DIR" && python3 kit/tools/build.py adam_mtrack >/dev/null)
exec env EMU_DIR="$EMU_DIR" NODE_EMU="$NODE" "$NODE" "$ROOT/test/adam_mtrack/view.mjs"
