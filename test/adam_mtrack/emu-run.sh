#!/usr/bin/env bash
# Run on claudius-vm: the emulator sweep of adam_mtrack (test/adam_mtrack/emu_sweep.mjs, Playwright).
# Starts the fake cluster-render service (test/adam_mtrack/fake_cluster_render.js, it logs every message and keeps the
# pixels) and the idrive7-apps emulator with M Track's emulator hooks (MTRACK_CR_SOCKET, MTRACK_EMU_FEED), runs the
# sweep, stops everything on any exit. EMU_DIR: an upstream idrive7-apps clone with apps/adam_mtrack linked in (it
# builds the app with its own kit). OUT: screenshots, the pull clip, raw logs (never this repo). Nothing talks to a car.
#   EMU_DIR=~/work/mtrack/idrive7-apps OUT=~/work/mtrack/out bash test/adam_mtrack/emu-run.sh
#   SCRIPT=emu_ladder.mjs ...: the Safety page's test pattern instead of the sweep
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$PWD
PORT=${PORT:-8081}
NODE22=${NODE22:-$HOME/.local/opt/node22/bin/node}
NODE=${NODE:-$HOME/.local/node/bin/node}          # Playwright's node
: "${EMU_DIR:?set EMU_DIR to the idrive7-apps clone}" "${OUT:?set OUT}"
DATA_DIR=$EMU_DIR/preview/emu/adam_mtrack
SOCK=$(mktemp -u /tmp/mt-cr-XXXXXX.sock)
FEED=$(mktemp -u /tmp/mt-feed-XXXXXX.sock)
CR_LOG=$OUT/raw/cluster-render.jsonl
FAKE_PID='' EMU_PID=''

cleanup() {
  [ -n "$EMU_PID" ] && kill "$EMU_PID" 2>/dev/null || true
  [ -n "$FAKE_PID" ] && kill "$FAKE_PID" 2>/dev/null || true
  sleep 1
  [ -n "$EMU_PID" ] && kill -9 "$EMU_PID" 2>/dev/null || true
  [ -n "$FAKE_PID" ] && kill -9 "$FAKE_PID" 2>/dev/null || true
  pkill -9 -f "hu-stub.js .*adam_mtrack" 2>/dev/null || true
  rm -f "$SOCK" "$SOCK.ctl" "$FEED" "$DATA_DIR/DISABLE"
}
trap cleanup EXIT

rm -rf "$OUT" "$DATA_DIR"           # a fresh run: no settings or log from an earlier one
mkdir -p "$OUT/raw"
"$NODE22" test/adam_mtrack/fake_cluster_render.js "$SOCK" "$CR_LOG" > "$OUT/raw/fake.log" 2>&1 &
FAKE_PID=$!
(cd "$EMU_DIR" && MTRACK_CR_SOCKET=$SOCK MTRACK_EMU_FEED=$FEED exec "$NODE22" kit/tools/emu.js adam_mtrack --port "$PORT") > "$OUT/raw/emu.log" 2>&1 &
EMU_PID=$!
for _ in $(seq 1 150); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then break; fi
  sleep 0.2
done
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" || { echo "emulator did not start:" >&2; cat "$OUT/raw/emu.log" >&2; exit 1; }
PORT=$PORT CR_LOG=$CR_LOG FEED=$FEED CTL=$SOCK.ctl DATA_DIR=$DATA_DIR OUT=$OUT "$NODE" "test/adam_mtrack/${SCRIPT:-emu_sweep.mjs}"
