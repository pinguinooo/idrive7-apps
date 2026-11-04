#!/usr/bin/env bash
# Self-check: Node 8 syntax of the app and the kit, the pinned cluster-render client, then the unit tests.
# NODE=/path/to/node8 tools/check.sh   (the car runs Node 8; a newer node still runs it but proves less)
set -euo pipefail
cd "$(dirname "$0")/.."
NODE=${NODE:-node}
CR_SHA=3b88e1898da6e2dd4c00b9dda816cbe242edde102fab7fc4dc3cb881d6c369d9  # idrive-apps@793da1e

ver=$("$NODE" --version)
echo "node $ver"
case "$ver" in v8.*) ;; *) echo "warning: not Node 8, the syntax check proves less than on the car" >&2 ;; esac

files=(apps/*/*.js kit/runtime/*.js)
if [ -d dist/adam_shiftlights/source/javascript ]; then
  while IFS= read -r f; do files+=("$f"); done < <(find dist/adam_shiftlights/source/javascript -name '*.js' | sort)
fi
for f in "${files[@]}"; do "$NODE" --check "$f"; done
echo "syntax ok: ${#files[@]} files"

f=apps/adam_shiftlights/cluster_render_client.js
if command -v sha256sum >/dev/null; then sum=$(sha256sum "$f"); else sum=$(shasum -a 256 "$f"); fi
[ "${sum%% *}" = "$CR_SHA" ] || { echo "$f does not match idrive-apps@793da1e" >&2; exit 1; }
echo "cluster_render_client.js matches idrive-apps@793da1e"

"$NODE" test/run.js
