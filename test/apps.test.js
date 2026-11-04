'use strict';
/**
 * The checks every app folder gets, found by listing apps/ (nothing to register for a new app):
 * app.json (id, version, loggingId), main.js, and the icon the Store lists.
 */
const fs = require('fs');
const path = require('path');

const APPS = path.join(__dirname, '..', 'apps');
const ICON_MAX = 128 * 1024;
const ids = fs.readdirSync(APPS).filter((d) => fs.existsSync(path.join(APPS, d, 'app.json'))).sort();

const specOf = (id) => JSON.parse(fs.readFileSync(path.join(APPS, id, 'app.json'), 'utf8'));
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

const tests = [['at least one app', () => ok(ids.length > 0, 'no apps/*/app.json')]];

ids.forEach((id) => {
    const dir = path.join(APPS, id);
    tests.push([id + ': app.json', () => {
        const s = specOf(id);
        // the Store takes the id from the folder name; a copy of _template must have both renamed
        ok(id[0] === '_' ? /^[a-z0-9][a-z0-9_-]{0,63}$/.test(s.id || '') : s.id === id, 'app.json "id" must be the folder name (' + id + '), got ' + s.id);
        ok(/^[a-z0-9][a-z0-9_-]{0,63}$/.test(s.id), 'id must match [a-z0-9][a-z0-9_-]{0,63}');
        ok(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(s.version || ''), 'version must be x.y.z, got ' + s.version);
        ok(typeof s.title === 'string' && s.title, 'title is missing');
        ok(/^[A-Za-z0-9]{4}$/.test(s.loggingId || ''), 'loggingId must be 4 letters or digits');
        ok(Array.isArray(s.screens) && s.screens.length > 0, 'screens is missing');
    }]);
    tests.push([id + ': main.js', () => ok(fs.existsSync(path.join(dir, 'main.js')), 'main.js is missing')]);
    tests.push([id + ': icon.png', () => {
        const p = path.join(dir, 'icon.png'), b = fs.readFileSync(p);
        ok(b.length >= 33 && b.slice(0, 8).toString('hex') === '89504e470d0a1a0a', 'icon.png is not a PNG');
        ok(b.readUInt32BE(16) === 140 && b.readUInt32BE(20) === 140, 'icon.png must be 140x140, is ' + b.readUInt32BE(16) + 'x' + b.readUInt32BE(20));
        ok(b.length <= ICON_MAX, 'icon.png is ' + b.length + ' bytes, the limit is ' + ICON_MAX);
    }]);
});

tests.push(['ids and loggingIds are unique across apps', () => {
    const seen = {}, logs = {};
    ids.forEach((id) => {
        const s = specOf(id);
        ok(!seen[s.id], id + ': id ' + s.id + ' is also in ' + seen[s.id]);
        ok(!logs[s.loggingId], id + ': loggingId ' + s.loggingId + ' is also in ' + logs[s.loggingId]);
        seen[s.id] = id; logs[s.loggingId] = id;
    });
}]);

module.exports = tests;
