// Every SCPI header the app can send must be in the DS1000Z-E programming
// guide. An undocumented query is worse than an error: the real scope never
// answers, and the app sits waiting until it times out.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function shortWord(w) {
  return /[a-z]/.test(w) ? w.replace(/[a-z]/g, '') : w.toUpperCase();
}
function norm(h) {
  return h.replace(/^:/, '').split(':').map(shortWord).filter((w) => w !== 'MAIN').join(':');
}

const known = new Set();
for (const raw of fs.readFileSync(path.join(root, 'tools', 'scpi-headers.txt'), 'utf8').split('\n')) {
  const line = raw.trim().replace(/\[:[A-Z]+\]/gi, '');
  if (!line || line.startsWith('#')) continue;
  for (let n = 1; n <= 10; n++) known.add(norm(line.replace(/<n>/g, String(n))));
}

// Placeholders used in template strings across the renderer.
const SUBST = [
  [/\$\{c\}/g, ':CHANnel1'], [/\$\{d\}/g, ':DECoder1'], [/\$\{cmd\}/g, ''],
  [/\$\{[^}]*\}/g, '1'],
];

function headersIn(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /['`](\*[A-Z]{3}\??|:[A-Z][A-Za-z0-9:${}.]*\??)[ '`]/g;
  let m;
  while ((m = re.exec(src))) {
    let h = m[1];
    for (const [a, b] of SUBST) h = h.replace(a, b);
    h = h.replace(/\?$/, '');
    if (!h || h === ':' || /^:\d/.test(h)) continue;
    out.push({ raw: m[1], h });
  }
  return out;
}

const files = [
  ...fs.readdirSync(path.join(root, 'src', 'renderer', 'js')).map((f) => path.join(root, 'src', 'renderer', 'js', f)),
  path.join(root, 'src', 'main', 'main.js'),
];

test('every SCPI header the app uses is documented', () => {
  const bad = [];
  let count = 0;
  for (const f of files) {
    for (const { raw, h } of headersIn(f)) {
      // ":CHANnel1" alone is the prefix passed into channelSheet(), not a command.
      if (/^:(CHANnel|DECoder)1$/.test(h)) continue;
      count++;
      if (!known.has(norm(h))) bad.push(`${path.basename(f)}: ${raw}`);
    }
  }
  assert.ok(count > 150, `only found ${count} commands; the scanner is broken`);
  assert.deepStrictEqual(bad, []);
});
