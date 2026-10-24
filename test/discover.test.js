// VXI-11 discovery against a fake portmapper on 127.0.0.1. Nothing here
// broadcasts onto the real network.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const dgram = require('dgram');
const { findScope, getportCall, parseGetportReply, broadcastAddresses } = require('../src/main/discover');

function reply(xid, port, { verfLen = 0, accept = 0 } = {}) {
  const pad = Math.ceil(verfLen / 4) * 4;
  const buf = Buffer.alloc(32 + pad);
  buf.writeUInt32BE(xid >>> 0, 0);
  buf.writeUInt32BE(1, 4); // REPLY
  buf.writeUInt32BE(0, 8); // MSG_ACCEPTED
  buf.writeUInt32BE(0, 12); // verf flavor
  buf.writeUInt32BE(verfLen, 16);
  buf.writeUInt32BE(accept, 20 + pad);
  buf.writeUInt32BE(port, 24 + pad);
  return buf;
}

// A portmapper that answers each call with the replies `answer` builds.
async function fakePortmapper(t, answer) {
  const sock = dgram.createSocket('udp4');
  const seen = [];
  sock.on('message', (buf, rinfo) => {
    seen.push(buf);
    for (const r of answer(buf.readUInt32BE(0))) sock.send(r, rinfo.port, rinfo.address);
  });
  await new Promise((r) => sock.bind(0, '127.0.0.1', r));
  t.after(() => sock.close());
  return { port: sock.address().port, seen };
}

test('GETPORT call asks the portmapper for VXI-11 core over TCP', () => {
  const b = getportCall(0xdeadbeef);
  assert.strictEqual(b.length, 56);
  const w = (i) => b.readUInt32BE(i * 4);
  assert.strictEqual(w(0), 0xdeadbeef);
  assert.deepStrictEqual([w(1), w(2), w(3), w(4), w(5)], [0, 2, 100000, 2, 3]);
  assert.deepStrictEqual([w(10), w(11), w(12), w(13)], [0x0607af, 1, 6, 0]);
});

test('reply parsing', () => {
  assert.strictEqual(parseGetportReply(reply(7, 1024), 7), 1024);
  assert.strictEqual(parseGetportReply(reply(7, 1024, { verfLen: 5 }), 7), 1024);
  assert.strictEqual(parseGetportReply(reply(8, 1024), 7), 0, 'wrong xid');
  assert.strictEqual(parseGetportReply(reply(7, 0), 7), 0, 'no VXI-11 here');
  assert.strictEqual(parseGetportReply(reply(7, 1024, { accept: 1 }), 7), 0, 'not SUCCESS');
  assert.strictEqual(parseGetportReply(Buffer.alloc(10), 7), 0, 'runt');
});

test('broadcast list always has the limited broadcast address', () => {
  assert.ok(broadcastAddresses().includes('255.255.255.255'));
});

test('takes the first real answer and skips the noise before it', async (t) => {
  const pm = await fakePortmapper(t, (xid) => [reply(xid ^ 1, 1024), reply(xid, 0), reply(xid, 1024)]);
  const host = await findScope({ targets: ['127.0.0.1'], port: pm.port, timeout: 2000 });
  assert.strictEqual(host, '127.0.0.1');
  assert.strictEqual(pm.seen.length, 1);
});

test('gives null when nothing answers', async (t) => {
  const pm = await fakePortmapper(t, () => []);
  const t0 = Date.now();
  assert.strictEqual(await findScope({ targets: ['127.0.0.1'], port: pm.port, timeout: 300 }), null);
  assert.ok(Date.now() - t0 >= 290);
});
