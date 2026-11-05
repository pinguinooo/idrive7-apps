'use strict';
/* tools/car-logs.sh on a copy of a head unit's files (--local): it collects cluster-render's status, log, guard, settings
 * and version, the two apps' logs (mtrack-diag.log too) and settings, the Store's logs but never its settings, and
 * changes nothing in the tree (every file's size, mtime and bytes the same after; no file added). The script's car
 * commands are read-only: no restart, stop, kill, rm, reboot or redirect into a unit path, and never `cluster-render
 * status` (its socket would start the service). CAR_LOGS_SH=busybox\ sh runs the collection with BusyBox's shell. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'tools', 'car-logs.sh');

function mkdirp(d) { if (fs.existsSync(d)) return; mkdirp(path.dirname(d)); fs.mkdirSync(d); }   // Node 8: no recursive mkdir
function put(root, rel, text) {
    const f = path.join(root, rel);
    mkdirp(path.dirname(f));
    fs.writeFileSync(f, text);
}
function walk(dir, out) {
    out = out || {};
    fs.readdirSync(dir).forEach((n) => {
        const f = path.join(dir, n), st = fs.lstatSync(f);
        if (st.isDirectory()) walk(f, out);
        else out[f] = st.size + ':' + st.mtimeMs + ':' + (st.isSymbolicLink() ? fs.readlinkSync(f) : fs.readFileSync(f).toString('base64'));
    });
    return out;
}
function unitTree() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'carlogs-root-'));
    put(root, 'run/cluster-render/status.txt', 'upload: cap 5500 KB/s (ceiling 5500, floor 2000): the ceiling\ntarget panel: slot 0x203 scene 0x1000400 1920x720: shown (us)\n');
    put(root, 'var/opt/cluster-render/log/cluster-render.log', '2026-11-04T23:00:00Z info client 3 (adam_mtrack): effect layer 9 on panel\n');
    put(root, 'var/opt/cluster-render/log/cluster-render.log.1', 'older\n');
    put(root, 'var/opt/cluster-render/state/guard.txt', 'version 0.3.10\n');
    put(root, 'var/opt/cluster-render/versions/0.3.10/component.json', '{"id":"cluster-render","version":"0.3.10"}');
    put(root, 'var/opt/cluster-render/versions/0.3.10/cluster-render.conf', 'panel_linger_ms = 3000\n');
    fs.symlinkSync('versions/0.3.10', path.join(root, 'var/opt/cluster-render/current'));
    put(root, 'var/opt/mgu-deploy/state.json', '{"pending":[]}');
    put(root, 'var/opt/public/oap/oap_12201/data/apps/adam_mtrack.json', '{"id":"adam_mtrack","userId":12250}');
    put(root, 'var/opt/public/oap/oap_12201/data/apps/adam_shiftlights.json', '{ "userId" : 12251, "id": "adam_shiftlights" }');
    put(root, 'var/opt/public/oap/oap_12201/data/apps/robertn_store.json', '{"userId":12202}');
    put(root, 'var/opt/public/oap/oap_12250/data/adam_mtrack.log', 'started: cover off\n');
    put(root, 'var/opt/public/oap/oap_12250/data/mtrack-diag.log', '> {"op":"hello"}\n');
    put(root, 'var/opt/public/oap/oap_12250/data/settings.json', '{"coverOn":false}');
    put(root, 'var/opt/public/oap/oap_12251/data/adam_shiftlights.log', 'cluster-render: layers hud slats#1\n');
    put(root, 'var/opt/public/oap/oap_12251/data/settings.json', '{"hudOn":true,"clusterOn":false}');
    put(root, 'var/opt/public/oap/oap_12202/data/robertn_store.log', 'store\n');
    put(root, 'var/opt/public/oap/oap_12202/data/settings.json', '{"secret":"never collected"}');
    put(root, 'var/opt/mgu-updater/credentials/tokens.json', '{"t":"never collected"}');
    return root;
}

module.exports = [
    ['car-logs.sh --local: collects the renderer, both apps (diag log too) and the Store\'s logs, changes nothing in the tree', () => {
        const root = unitTree(), before = walk(root), out = fs.mkdtempSync(path.join(os.tmpdir(), 'carlogs-out-')) + '/run';
        const env = Object.assign({}, process.env, { SH: process.env.CAR_LOGS_SH || 'sh' });
        const r = spawnSync('bash', [SCRIPT, '--local', root, out], { encoding: 'utf8', env });
        assert.strictEqual(r.status, 0, r.stdout + r.stderr);
        assert.deepStrictEqual(walk(root), before, 'the unit tree changed');
        const base = path.join(out, 'files') + root;     // tar keeps each path without its leading slash
        const got = Object.keys(walk(path.join(out, 'files'))).map((f) => f.slice(base.length));
        ['/run/cluster-render/status.txt', '/var/opt/cluster-render/log/cluster-render.log', '/var/opt/cluster-render/log/cluster-render.log.1',
            '/var/opt/cluster-render/state/guard.txt', '/var/opt/cluster-render/current/component.json', '/var/opt/cluster-render/current/cluster-render.conf',
            '/var/opt/mgu-deploy/state.json', '/var/opt/public/oap/oap_12201/data/apps/adam_mtrack.json', '/var/opt/public/oap/oap_12250/data/adam_mtrack.log',
            '/var/opt/public/oap/oap_12250/data/mtrack-diag.log', '/var/opt/public/oap/oap_12250/data/settings.json',
            '/var/opt/public/oap/oap_12251/data/adam_shiftlights.log', '/var/opt/public/oap/oap_12251/data/settings.json',
            '/var/opt/public/oap/oap_12202/data/robertn_store.log'].forEach((f) => assert.ok(got.indexOf(f) >= 0, f + ' not collected: ' + JSON.stringify(got)));
        assert.ok(got.indexOf('/var/opt/public/oap/oap_12202/data/settings.json') < 0, 'the Store\'s settings collected');
        assert.ok(!got.some((f) => /credentials/.test(f)), 'credentials collected');
        const comp = fs.readFileSync(path.join(out, 'files', root.slice(1), 'var/opt/cluster-render/current/component.json'), 'utf8');
        assert.ok(/0\.3\.10/.test(comp), 'the version through the current symlink');
        const cmds = fs.readFileSync(path.join(out, 'commands.txt'), 'utf8');
        assert.ok(/===== cluster-render folders/.test(cmds) && /adam_mtrack\.json/.test(cmds), cmds);
        assert.ok(fs.existsSync(out + '.tar.gz'), 'the archive to send');
        assert.ok(/send .*\.tar\.gz/.test(r.stdout), r.stdout);
    }],
    ['car-logs.sh: everything it runs on the car is read-only (no restart, stop, kill, rm, reboot, write; never cluster-render status)', () => {
        const s = fs.readFileSync(SCRIPT, 'utf8');
        const remote = s.split(/<<'EOF'\n/).slice(1).map((x) => x.split('\nEOF\n')[0]).join('\n');
        assert.ok(remote.length > 500, 'the remote parts found');
        [/systemctl\s+(restart|stop|start|kill|reload|enable|disable)/, /\bkill\b/, /\bpkill\b/, /\brm\b/, /\breboot\b/, /\bmv\b/, /\bcp\b/, /\btouch\b/,
            /\bmount\b/, /cluster-render\s+status/, /cluster-render\s+guard-reset/, /[^2&]>\s*["$/]/, /\btee\b/, /\bsed\s+-i/].forEach((re) => assert.ok(!re.test(remote), 'remote part matches ' + re));
        assert.ok(/tar -chf -/.test(s), 'the files go as a tar stream (read only)');
        assert.ok(!/systemctl\s+(restart|stop|start|kill)/.test(s) && !/\bpkill\b/.test(s), 'nothing restarted anywhere in the script');
    }],
];
