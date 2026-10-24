// Find a scope on the LAN the way VISA does it: broadcast one Sun RPC
// portmapper GETPORT asking who runs VXI-11, and take whoever answers.
// LXI instruments (the DS1000Z-E family included) run a portmapper on
// UDP 111 for exactly this. Only the local subnet hears a broadcast, so a
// scope behind a router won't show up.

'use strict';

const dgram = require('dgram');
const os = require('os');

const PORTMAPPER = 100000;
const PMAP_VERS = 2;
const PMAPPROC_GETPORT = 3;
const VXI11_CORE = 0x0607af;
const VXI11_VERS = 1;
const IPPROTO_TCP = 6;

// An RPC call is all big-endian 32-bit words; with empty credentials this
// one is 14 of them.
function getportCall(xid) {
  const words = [
    xid, 0 /* CALL */, 2 /* RPC version */, PORTMAPPER, PMAP_VERS, PMAPPROC_GETPORT,
    0, 0 /* cred: AUTH_NONE, no body */, 0, 0 /* verf: same */,
    VXI11_CORE, VXI11_VERS, IPPROTO_TCP, 0,
  ];
  const buf = Buffer.alloc(words.length * 4);
  words.forEach((w, i) => buf.writeUInt32BE(w >>> 0, i * 4));
  return buf;
}

// The VXI-11 port from a reply to our call, or 0 if this isn't one. A
// portmapper without VXI-11 answers too, just with port 0.
function parseGetportReply(buf, xid) {
  if (buf.length < 24) return 0;
  if (buf.readUInt32BE(0) !== xid >>> 0) return 0;
  if (buf.readUInt32BE(4) !== 1 /* REPLY */) return 0;
  if (buf.readUInt32BE(8) !== 0 /* MSG_ACCEPTED */) return 0;
  // The verifier body is padded out to a word.
  const at = 20 + Math.ceil(buf.readUInt32BE(16) / 4) * 4;
  if (buf.length < at + 8) return 0;
  if (buf.readUInt32BE(at) !== 0 /* SUCCESS */) return 0;
  return buf.readUInt32BE(at + 4);
}

// The directed broadcast address of every IPv4 interface that's up. On
// macOS 255.255.255.255 only leaves by the primary interface, so the
// per-subnet addresses are the ones that matter.
function broadcastAddresses() {
  const out = new Set();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      // A /32 (VPNs like Tailscale) has no subnet to broadcast to.
      if (a.family !== 'IPv4' || a.internal || a.netmask === '255.255.255.255') continue;
      const ip = a.address.split('.').map(Number);
      const mask = a.netmask.split('.').map(Number);
      out.add(ip.map((b, i) => (b | (~mask[i] & 255))).join('.'));
    }
  }
  out.add('255.255.255.255');
  return [...out];
}

// Resolves with the address of the first instrument to answer, or null if
// none does within `timeout` ms. Tests aim it at a fake portmapper with
// `targets` and `port`.
function findScope({ timeout = 1500, targets = broadcastAddresses(), port = 111 } = {}) {
  const xid = Math.floor(Math.random() * 0x100000000);
  const msg = getportCall(xid);
  const sock = dgram.createSocket('udp4');

  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err, host) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.close();
      if (err) reject(err);
      else resolve(host);
    };
    const timer = setTimeout(() => finish(null, null), timeout);

    sock.on('error', (err) => finish(err));
    sock.on('message', (buf, rinfo) => {
      if (parseGetportReply(buf, xid)) finish(null, rinfo.address);
    });

    sock.bind(0, () => {
      sock.setBroadcast(true);
      // If nothing could even be sent, waiting out the timeout only hides
      // the reason (usually a Local Network denial).
      let failed = 0;
      for (const t of targets) {
        sock.send(msg, port, t, (err) => {
          if (err && ++failed === targets.length) finish(err);
        });
      }
    });
  });
}

module.exports = { findScope, getportCall, parseGetportReply, broadcastAddresses };
