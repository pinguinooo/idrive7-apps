#!/usr/bin/env bash
# tools/car-logs.sh - collect, READ-ONLY, the evidence for a cluster drawing problem (M Track Cluster, Shift Lights,
# the cluster-render service) from the car's head unit into a folder on this computer, plus a .tar.gz of it to send.
#
# Nothing on the car changes: no restart, no kill, no write, no service started. It only reads files (tar -c, cat, ls)
# and runs read-only commands (date, uptime, systemctl status/show, journalctl, ps, df). It never runs
# `cluster-render status`: connecting to the service's socket would start the service.
#
#   HU=root@<unit-ip> KEY=<root key, e.g. data/enrollments/<VIN>/id_rsa> [PORT=22] tools/car-logs.sh [out-dir]
#   SSH='ssh -p 2222 -i <key> root@127.0.0.1' tools/car-logs.sh [out-dir]   (the relay `deploy/hu connect` prints)
#   tools/car-logs.sh --local <root> <out-dir>      the same collection from a copy of the unit's files (the tests)
#
# Collected: cluster-render's status (/run/cluster-render/status.txt: targets, every client's layers and assets, the
# upload cap, the Dcsm2 slot rows), its log file and .1 (/var/opt/cluster-render/log/, the journal keeps only minutes),
# the mapping guard's file, the local and shipped settings, its installed version; the app logs of adam_mtrack (with
# mtrack-diag.log: what it sent to cluster-render and what came back) and adam_shiftlights and their settings.json;
# the Store's app logs (never its settings or tokens); mgu-deploy's state and last verify; the journal lines of
# cluster-render and the apps; the processes; the head-unit variant.
set -euo pipefail

remote_files() {   # $1: root prefix ('' on the car). Prints the files that exist, one a line (unit paths have no spaces)
cat <<'EOF'
R="$1"
for f in "$R/run/cluster-render/status.txt" \
         "$R/var/opt/cluster-render/log/cluster-render.log" "$R/var/opt/cluster-render/log/cluster-render.log.1" \
         "$R/var/opt/cluster-render/state/guard.txt" "$R/var/opt/cluster-render/cluster-render.local.conf" \
         "$R/var/opt/cluster-render/current/component.json" "$R/var/opt/cluster-render/current/cluster-render.conf" \
         "$R/var/opt/mgu-deploy/state.json" "$R/var/opt/mgu-deploy/last-verify.json"; do
  [ -f "$f" ] && echo "$f"
done
for id in adam_mtrack adam_shiftlights robertn_store; do
  reg="$R/var/opt/public/oap/oap_12201/data/apps/$id.json"
  [ -f "$reg" ] || continue
  echo "$reg"
  uid=$(sed -n 's/.*"userId"[^0-9]*\([0-9][0-9]*\).*/\1/p' "$reg" | head -n 1)
  [ -n "$uid" ] || continue
  d="$R/var/opt/public/oap/oap_$uid/data"
  for f in "$d"/*.log "$d"/*.log.1; do [ -f "$f" ] && echo "$f"; done
  if [ "$id" != robertn_store ] && [ -f "$d/settings.json" ]; then echo "$d/settings.json"; fi
done
exit 0
EOF
}

remote_cmds() {    # $1: root prefix; LOCAL=1 skips the unit's system commands (not the unit)
cat <<'EOF'
R="$1"
sec() { echo; echo "===== $*"; }
sec "collected"; date; date -u
if [ -z "$LOCAL" ]; then
  sec "uptime"; uptime 2>&1
  sec "head-unit variant (kernel command line)"; tr ' ' '\n' < /proc/cmdline 2>/dev/null | grep -E '^hwvariant=' || echo "no hwvariant= on the command line"
  sec "systemctl status cluster-render"; systemctl status cluster-render.service cluster-render.socket --no-pager -l 2>&1 | head -n 80
  sec "systemctl show cluster-render"; systemctl show cluster-render.service -p ActiveState -p SubState -p Result -p NRestarts -p ExecMainStartTimestamp 2>&1
  sec "journal: cluster-render (the unit keeps only minutes)"; journalctl -u cluster-render --no-pager -o short-iso 2>&1 | tail -n 3000
  sec "journal: apps and the renderer (last 6000 lines, filtered)"; journalctl --no-pager -o short-iso -n 6000 2>&1 | grep -i -E 'cluster-render|adam_|dcsm|ramses|mainapp|oap|kombi' | tail -n 2500
  sec "processes"; ps -ef 2>/dev/null | grep -E 'cluster-render|node|MainApp|oap' | grep -v grep || ps 2>&1 | grep -E 'cluster-render|node'
  sec "disk"; df -h /var/opt 2>&1
fi
sec "cluster-render folders"; ls -la "$R/var/opt/cluster-render" "$R/var/opt/cluster-render/versions" "$R/var/opt/cluster-render/log" "$R/run/cluster-render" 2>&1
sec "app registry"; ls -la "$R/var/opt/public/oap/oap_12201/data/apps" 2>&1 | grep -E 'adam_|robertn_' || echo "no adam_ or robertn_ app registered"
exit 0
EOF
}

die() { echo "car-logs: $*" >&2; exit 2; }

if [ "${1:-}" = "--local" ]; then
  ROOT=${2:?--local <root> <out-dir>}; OUT=${3:?--local <root> <out-dir>}
  run() { LOCAL=1 ${SH:-sh} -s -- "$ROOT"; }      # SH=busybox\ sh: the unit's shell
else
  OUT=${1:-$HOME/car-logs/$(date +%Y%m%d-%H%M%S)}
  OPTS=(-o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa -o BatchMode=yes -o ConnectTimeout=15
        -o ControlMaster=auto -o "ControlPath=/tmp/car-logs-%C" -o ControlPersist=60)
  if [ -n "${SSH:-}" ]; then
    read -r -a SSHA <<< "$SSH"                       # options go right after "ssh", before the host
    run() { "${SSHA[0]}" "${OPTS[@]}" "${SSHA[@]:1}" 'sh -s -- ""'; }
  else
    [ -n "${HU:-}" ] || die "set HU=root@<unit-ip> and KEY=<root key> (or SSH='ssh ... root@host'); see the comments at the top"
    SSHA=(ssh -p "${PORT:-22}" -o IdentitiesOnly=yes)
    [ -n "${KEY:-}" ] && SSHA+=(-i "$KEY")
    run() { "${SSHA[@]}" "${OPTS[@]}" "$HU" 'sh -s -- ""'; }
  fi
fi

mkdir -p "$OUT/files"
echo "car-logs: reading from the car (read-only) into $OUT"
# 1. the file list, then the files themselves as a tar stream (tar -c only reads)
{ remote_files; } | run > "$OUT/files.txt" || die "could not reach the head unit (ssh): nothing was collected"
LIST=$(tr '\n' ' ' < "$OUT/files.txt")
if [ -n "$LIST" ]; then
  { printf 'set --\nfor f in %s; do set -- "$@" "$f"; done\ntar -chf - "$@" 2>/dev/null\nexit 0\n' "$LIST"; } | run > "$OUT/files.tar"
  tar -xf "$OUT/files.tar" -C "$OUT/files" 2>/dev/null || echo "car-logs: some files did not unpack (see files.tar)" >&2
  rm -f "$OUT/files.tar"
fi
# 2. the read-only commands' output
{ remote_cmds; } | run > "$OUT/commands.txt" 2>&1 || true
# 3. one archive to send
tar -czf "$OUT.tar.gz" -C "$(dirname "$OUT")" "$(basename "$OUT")"
echo "car-logs: $(wc -l < "$OUT/files.txt" | tr -d ' ') files, commands.txt $(wc -c < "$OUT/commands.txt" | tr -d ' ') bytes"
while IFS= read -r f; do echo "  $f"; done < "$OUT/files.txt"
echo "car-logs: send $OUT.tar.gz"
