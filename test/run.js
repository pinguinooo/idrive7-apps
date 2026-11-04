'use strict';
/**
 * Unit tests, Node 8 (the car's major): `node test/run.js` (or `tools/check.sh`).
 * Every test/*.test.js exports [[name, fn], ...]; fn may return a promise. Exit 1 on any failure.
 */
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname).filter((f) => /\.test\.js$/.test(f)).sort();
const tests = [];
files.forEach((f) => require(path.join(__dirname, f)).forEach((t) => tests.push([f.replace(/\.test\.js$/, '') + ': ' + t[0], t[1]])));

let passed = 0, failed = 0;
(async () => {
    for (const t of tests) {
        try {
            await Promise.race([Promise.resolve().then(t[1]), new Promise((res, rej) => setTimeout(() => rej(new Error('timed out after 20 s')), 20000).unref())]);
            passed++;
        } catch (e) {
            failed++;
            console.log('FAIL ' + t[0] + '\n  ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n  '));
        }
    }
    console.log(passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
})();
