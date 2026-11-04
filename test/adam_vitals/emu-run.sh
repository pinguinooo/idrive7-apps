#!/usr/bin/env bash
# Run on claudius-vm: the emulator sweep of adam_vitals (test/adam_vitals/emu_sweep.mjs, Playwright).
# EMU_DIR: an upstream idrive7-apps clone with apps/adam_vitals linked in (it builds the app with its own kit).
# OUT: where screenshots, the raw video and logs go (never this repo). Nothing here talks to a car.
#   EMU_DIR=~/work/x/idrive7-apps OUT=~/work/x/out PORT=8079 bash test/adam_vitals/emu-run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$PWD
PORT=${PORT:-8079}
NODE22=${NODE22:-$HOME/.local/opt/node22/bin/node}
NODE=${NODE:-$HOME/.local/node/bin/node}          # Playwright's node
: "${EMU_DIR:?set EMU_DIR to the idrive7-apps clone}" "${OUT:?set OUT}"
DATA_DIR=$EMU_DIR/preview/emu/adam_vitals
EMU_PID=''

cleanup() {
  [ -n "$EMU_PID" ] && kill "$EMU_PID" 2>/dev/null || true
  sleep 1
  [ -n "$EMU_PID" ] && kill -9 "$EMU_PID" 2>/dev/null || true
  rm -f "$DATA_DIR/DISABLE"
}
trap cleanup EXIT

rm -rf "$OUT" "$DATA_DIR"           # a fresh run: no settings or log from an earlier one
mkdir -p "$OUT/raw"
(cd "$EMU_DIR" && exec "$NODE22" kit/tools/emu.js adam_vitals --port "$PORT") > "$OUT/raw/emu.log" 2>&1 &
EMU_PID=$!
for _ in $(seq 1 150); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then break; fi
  sleep 0.2
done
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" || { echo "emulator did not start:" >&2; cat "$OUT/raw/emu.log" >&2; exit 1; }
PORT=$PORT DATA_DIR=$DATA_DIR OUT=$OUT APP_DIR=$ROOT/apps/adam_vitals "$NODE" test/adam_vitals/emu_sweep.mjs
