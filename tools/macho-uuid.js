// Give a Mach-O executable its own LC_UUID.
//
//   node tools/macho-uuid.js <executable> <name>
//
// macOS Local Network privacy tells apps apart by the main executable's
// Mach-O UUID (Apple TN3179), not by bundle ID. The packager just renames
// Electron's stock binary, so without this the app shares a UUID with
// every other copy of the same Electron, and an "Allow" for one lands on
// the wrong app: connections keep failing with EHOSTUNREACH.
//
// The new UUID is a hash of <name> and the slice's CPU type, so it stays
// put across rebuilds and the user's permission survives an upgrade. Run
// this before signing; it invalidates any existing signature.

'use strict';

const fs = require('fs');
const crypto = require('crypto');

const MH_MAGIC_64 = 0xfeedfacf;
const FAT_MAGIC = 0xcafebabe;
const LC_UUID = 0x1b;

function uuidFor(name, cputype) {
  const h = crypto.createHash('sha256').update(`${name}\0${cputype}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50; // version 5 style: name-derived
  h[8] = (h[8] & 0x3f) | 0x80; // RFC 4122 variant
  return h.subarray(0, 16);
}

function fmt(u) {
  const x = u.toString('hex').toUpperCase();
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

// Rewrites the LC_UUID of the thin 64-bit slice starting at `base`.
function patchSlice(buf, base, name) {
  if (buf.readUInt32LE(base) !== MH_MAGIC_64) throw new Error(`no 64-bit Mach-O header at ${base}`);
  const cputype = buf.readUInt32LE(base + 4);
  const ncmds = buf.readUInt32LE(base + 16);
  let at = base + 32;
  for (let i = 0; i < ncmds; i++) {
    const cmd = buf.readUInt32LE(at);
    if (cmd === LC_UUID) {
      const u = uuidFor(name, cputype);
      u.copy(buf, at + 8);
      return fmt(u);
    }
    at += buf.readUInt32LE(at + 4);
  }
  throw new Error('no LC_UUID load command');
}

function main() {
  const [file, name] = process.argv.slice(2);
  if (!file || !name) {
    console.error('usage: macho-uuid.js <executable> <name>');
    process.exit(2);
  }
  const buf = fs.readFileSync(file);
  const done = [];
  if (buf.readUInt32BE(0) === FAT_MAGIC) {
    const n = buf.readUInt32BE(4);
    for (let i = 0; i < n; i++) done.push(patchSlice(buf, buf.readUInt32BE(8 + i * 20 + 8), name));
  } else {
    done.push(patchSlice(buf, 0, name));
  }
  fs.writeFileSync(file, buf);
  console.log(`${file}: UUID ${done.join(', ')}`);
}

main();
