// SCPI over a raw TCP socket (the scope listens on port 5555).
//
// The DS1000Z-E answers one thing at a time, so every request goes through a
// single queue. Requests marked "urgent" (anything the user clicked) jump
// ahead of background work like screen grabs and status polling.

'use strict';

const net = require('net');
const { EventEmitter } = require('events');

const DEFAULT_PORT = 5555;

// Parse an IEEE 488.2 definite-length block ("#9001152054<data>") out of buf.
// Returns { data, consumed } once the whole block has arrived, or null.
function parseBlock(buf) {
  const start = buf.indexOf(0x23); // '#'
  if (start < 0 || buf.length < start + 2) return null;
  const n = buf[start + 1] - 0x30;
  if (n < 1 || n > 9) throw new Error('bad block header');
  if (buf.length < start + 2 + n) return null;
  const len = parseInt(buf.toString('ascii', start + 2, start + 2 + n), 10);
  const dataStart = start + 2 + n;
  if (buf.length < dataStart + len) return null;
  let consumed = dataStart + len;
  if (buf[consumed] === 0x0a) consumed++; // trailing newline, when present
  return { data: buf.subarray(dataStart, dataStart + len), consumed };
}

function blockHeader(len) {
  const digits = String(len);
  return Buffer.from('#' + digits.length + digits, 'ascii');
}

class Scpi extends EventEmitter {
  constructor() {
    super();
    this.sock = null;
    this.host = null;
    this.port = DEFAULT_PORT;
    this.rx = Buffer.alloc(0);
    this.queue = [];
    this.current = null;
    this.connected = false;
  }

  connect(host, port = DEFAULT_PORT, timeoutMs = 4000) {
    this.close();
    this.host = host;
    this.port = port;
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host, port });
      sock.setNoDelay(true);
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error(`no answer from ${host}:${port}`));
      }, timeoutMs);
      sock.once('connect', () => {
        clearTimeout(timer);
        this.sock = sock;
        this.connected = true;
        this.rx = Buffer.alloc(0);
        this.emit('state', true);
        resolve();
      });
      sock.on('data', (d) => this._onData(d));
      sock.on('error', (err) => {
        clearTimeout(timer);
        if (!this.connected) reject(err);
        this._drop(err);
      });
      sock.on('close', () => this._drop(new Error('connection closed')));
    });
  }

  close() {
    if (this.sock) {
      const s = this.sock;
      this.sock = null;
      s.removeAllListeners();
      s.destroy();
    }
    this._drop(new Error('disconnected'));
  }

  _drop(err) {
    const was = this.connected;
    this.connected = false;
    this.sock = null;
    if (this.current) {
      clearTimeout(this.current.timer);
      this.current.reject(err);
      this.current = null;
    }
    for (const r of this.queue.splice(0)) r.reject(err);
    if (was) this.emit('state', false);
  }

  // Fire-and-forget command. Resolves once written.
  write(cmd, opts = {}) {
    return this._enqueue({ cmd, expect: 'none', ...opts });
  }

  // Command that answers with one line of text.
  query(cmd, opts = {}) {
    return this._enqueue({ cmd, expect: 'line', timeout: 3000, ...opts });
  }

  // Command that answers with a binary block (screen, setup, waveform).
  queryBlock(cmd, opts = {}) {
    return this._enqueue({ cmd, expect: 'block', timeout: 15000, ...opts });
  }

  // Command followed by a binary block argument (":SYSTem:SETup #9...").
  writeBlock(cmd, data, opts = {}) {
    const payload = Buffer.concat([
      Buffer.from(cmd + ' ', 'ascii'),
      blockHeader(data.length),
      Buffer.from(data),
      Buffer.from('\n', 'ascii'),
    ]);
    return this._enqueue({ raw: payload, cmd, expect: 'none', ...opts });
  }

  _enqueue(req) {
    if (!this.connected) return Promise.reject(new Error('not connected'));
    return new Promise((resolve, reject) => {
      req.resolve = resolve;
      req.reject = reject;
      if (req.urgent) {
        // after any other urgent requests, ahead of background ones
        const i = this.queue.findIndex((r) => !r.urgent);
        if (i < 0) this.queue.push(req);
        else this.queue.splice(i, 0, req);
      } else {
        this.queue.push(req);
      }
      this._pump();
    });
  }

  _pump() {
    if (this.current || !this.sock || this.queue.length === 0) return;
    const req = this.queue.shift();
    this.current = req;
    this.emit('traffic', { dir: 'out', cmd: req.cmd });
    const buf = req.raw || Buffer.from(req.cmd + '\n', 'ascii');
    if (req.expect === 'none') {
      this.sock.write(buf, () => {
        // The scope drops commands that arrive back-to-back too quickly; a
        // small breather after each write keeps it happy.
        setTimeout(() => this._finish(null), req.gap ?? 15);
      });
      return;
    }
    req.timer = setTimeout(() => {
      // A late reply would desynchronize every later request, so start over.
      const err = new Error(`timeout waiting for reply to ${req.cmd}`);
      const host = this.host;
      const port = this.port;
      this.close();
      this.emit('timeout', err);
      this.emit('reconnect', { host, port });
    }, req.timeout);
    this.sock.write(buf);
    this._tryComplete();
  }

  _finish(value, err) {
    const req = this.current;
    if (!req) return;
    clearTimeout(req.timer);
    this.current = null;
    if (err) req.reject(err);
    else req.resolve(value);
    this._pump();
  }

  _onData(d) {
    this.rx = this.rx.length ? Buffer.concat([this.rx, d]) : d;
    this._tryComplete();
  }

  _tryComplete() {
    const req = this.current;
    if (!req || req.expect === 'none') {
      // Stray bytes with nothing waiting on them are discarded.
      if (!req) this.rx = Buffer.alloc(0);
      return;
    }
    if (req.expect === 'line') {
      const nl = this.rx.indexOf(0x0a);
      if (nl < 0) return;
      const line = this.rx.toString('ascii', 0, nl).trim();
      this.rx = this.rx.subarray(nl + 1);
      this.emit('traffic', { dir: 'in', cmd: req.cmd, text: line });
      this._finish(line);
      return;
    }
    let blk;
    try {
      blk = parseBlock(this.rx);
    } catch (e) {
      this.rx = Buffer.alloc(0);
      this._finish(null, e);
      return;
    }
    if (!blk) return;
    const data = Buffer.from(blk.data); // copy out of the shared rx buffer
    this.rx = this.rx.subarray(blk.consumed);
    this.emit('traffic', { dir: 'in', cmd: req.cmd, text: `<${data.length} bytes>` });
    this._finish(data);
  }
}

module.exports = { Scpi, parseBlock, blockHeader, DEFAULT_PORT };
