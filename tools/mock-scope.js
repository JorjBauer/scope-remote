#!/usr/bin/env node
// A pretend DS1202Z-E for testing without the real thing.
//
// Listens on 127.0.0.1 (port 5555 by default, or the first argument),
// remembers every setting it is sent, answers queries, and draws an 800x480
// BMP screen whose traces follow the channel, timebase and trigger settings.
// CH1 is a 1 kHz 0-3.3 V square wave, CH2 a 1 kHz 2 Vpp sine lagging 90 deg.
//
//   node tools/mock-scope.js [port] [--quiet]

'use strict';

const net = require('net');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv.find((a) => /^\d+$/.test(a))) || 5555;
const QUIET = process.argv.includes('--quiet');
const INVALID = '9.9E37';

const DEFAULTS = {
  'CHAN1:DISP': '1', 'CHAN1:SCAL': '1.000000e+00', 'CHAN1:OFFS': '0.000000e+00', 'CHAN1:COUP': 'DC', 'CHAN1:PROB': '1.000000e+01',
  'CHAN1:BWL': 'OFF', 'CHAN1:INV': '0', 'CHAN1:VERN': '0', 'CHAN1:UNIT': 'VOLT',
  'CHAN2:DISP': '0', 'CHAN2:SCAL': '1.000000e+00', 'CHAN2:OFFS': '0.000000e+00', 'CHAN2:COUP': 'DC', 'CHAN2:PROB': '1.000000e+01',
  'CHAN2:BWL': 'OFF', 'CHAN2:INV': '0', 'CHAN2:VERN': '0', 'CHAN2:UNIT': 'VOLT',
  'TIM:MODE': 'MAIN', 'TIM:SCAL': '1.000000e-06', 'TIM:OFFS': '0.000000e+00', 'TIM:DEL:ENAB': '0',
  'TRIG:MODE': 'EDGE', 'TRIG:SWE': 'AUTO', 'TRIG:EDG:SOUR': 'CHAN1', 'TRIG:EDG:SLOP': 'POS', 'TRIG:EDG:LEV': '0.000000e+00',
  'TRIG:COUP': 'DC', 'TRIG:HOLD': '1.600000e-08', 'TRIG:NREJ': '0',
  'ACQ:TYPE': 'NORM', 'ACQ:MDEP': 'AUTO', 'ACQ:AVER': '2',
  'MATH:DISP': '0', 'MATH:OPER': 'ADD', 'DEC1:DISP': '0', 'DEC2:DISP': '0', 'DEC1:MODE': 'PAR', 'DEC2:MODE': 'PAR',
  'CURS:MODE': 'OFF', 'DISP:TYPE': 'VECT', 'DISP:GRAD:TIME': 'MIN', 'DISP:GRID': 'FULL', 'DISP:WBR': '60', 'DISP:GBR': '50',
  'MEAS:SOUR': 'CHAN1', 'MEAS:COUN:SOUR': 'OFF', 'MEAS:ADIS': '0', 'MEAS:STAT:DISP': '0',
  'SYST:BEEP': '1', 'SYST:LOCK': '0', 'SYST:AUT': '1', 'STOR:IMAG:TYPE': 'PNG',
  'WAV:SOUR': 'CHAN1', 'WAV:MODE': 'NORM', 'WAV:FORM': 'BYTE', 'REF:DISP': '0',
};

let state = { ...DEFAULTS };
let runState = 'RUN';
const errors = [];

function log(...a) {
  if (!QUIET) console.log(...a);
}

// "CHANnel1" -> "CHAN1"; already-short or all-caps words pass through.
function shortWord(w) {
  return /[a-z]/.test(w) ? w.replace(/[a-z]/g, '') : w.toUpperCase();
}

function normHeader(h) {
  // TIMebase[:MAIN]:SCALe: the MAIN keyword is optional, so drop it.
  return h.replace(/^:/, '').split(':').map(shortWord).filter((w) => w !== 'MAIN').join(':');
}

// Every header the real scope documents, in the same short form as above.
// "<n>" expands to the channel/decoder/reference numbers that exist.
const KNOWN = new Set();
for (const raw of fs.readFileSync(path.join(__dirname, 'scpi-headers.txt'), 'utf8').split('\n')) {
  const line = raw.trim().replace(/\[:[A-Z]+\]/gi, '');
  if (!line || line.startsWith('#')) continue;
  const max = /REFerence<n>/.test(line) ? 10 : 2;
  const variants = line.includes('<n>') ? Array.from({ length: max }, (_, i) => line.replace(/<n>/g, String(i + 1))) : [line];
  for (const v of variants) KNOWN.add(normHeader(v));
}

const num = (k) => parseFloat(state[k]);
const on = (k) => state[k] === '1' || state[k] === 'ON';
const sci = (v) => v.toExponential(6);

// ----- the pretend signals -----

function rawSignal(n, t) {
  const f = 1000;
  const ph = ((t * f) % 1 + 1) % 1;
  if (n === 1) return ph < 0.5 ? 3.3 : 0;
  return Math.sin(2 * Math.PI * (ph - 0.25)) + (Math.random() - 0.5) * 0.04;
}

const MEANS = { 1: 1.65, 2: 0 };

function signal(n, t) {
  const c = `CHAN${n}`;
  const coup = state[`${c}:COUP`];
  if (coup === 'GND') return 0;
  let v = rawSignal(n, t);
  if (coup === 'AC') v -= MEANS[n];
  if (on(`${c}:INV`)) v = -v;
  return v;
}

function measure(item, src) {
  const n = Number((src.match(/(\d)/) || [])[1] || 1);
  if (!on(`CHAN${n}:DISP`)) return INVALID;
  const pts = [];
  for (let i = 0; i < 1000; i++) pts.push(signal(n, i * 1e-6));
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const avg = pts.reduce((a, b) => a + b, 0) / pts.length;
  const rms = Math.sqrt(pts.reduce((a, b) => a + b * b, 0) / pts.length);
  if (state[`CHAN${n}:COUP`] === 'GND') {
    if (/^(FREQ|PER|PDUT|NDUT|PWID|NWID|RTIM|FTIM)/.test(item)) return INVALID;
  }
  const table = {
    VMAX: max, VMIN: min, VPP: max - min, VTOP: max, VBAS: min, VAMP: max - min, VAVG: avg, VRMS: rms,
    FREQ: 1000, PER: 1e-3, PDUT: 50, NDUT: 50, PWID: 5e-4, NWID: 5e-4,
    RTIM: n === 1 ? 8e-9 : 3.3e-4, FTIM: n === 1 ? 8e-9 : 3.3e-4, OVER: n === 1 ? 0.6 : 0, PRES: 0.2,
    RDEL: 2.5e-4, FDEL: 2.5e-4, RPH: 90, FPH: 90,
  };
  const v = table[shortWord(item)];
  return v === undefined ? INVALID : sci(v);
}

// ----- screen -----

const W = 800;
const H = 480;
const GX = 100;
const GY = 40;
const DIV = 50;

const FONT = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001001001001', '8': '111101111101111', '9': '111101111001111',
  '.': '000000000000010', '-': '000000111000000', '/': '001001010100100', ' ': '000000000000000',
  V: '101101101101010', S: '111100111001111', M: '101111111101101', U: '101101101101111', N: '111101101101101',
  K: '101101110101101', H: '101101111101101', Z: '111001010100111', R: '110101110101101', T: '111010010010010',
  O: '111101101101111', P: '111101111100100', A: '010101111101101', I: '111010010010111', W: '101101111111101',
  G: '111100101101111', C: '111100100100111', D: '110101101101110', E: '111100111100111', L: '100100100100111',
};

function makeScreen() {
  const px = Buffer.alloc(W * H * 3);
  const set = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    px[i] = r; px[i + 1] = g; px[i + 2] = b;
  };
  const rect = (x, y, w, hh, c) => {
    for (let j = y; j < y + hh; j++) for (let i = x; i < x + w; i++) set(i, j, c);
  };
  const text = (s, x, y, c, sc = 2) => {
    for (const ch of String(s).toUpperCase()) {
      const g = FONT[ch] || FONT[' '];
      for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) if (g[r * 3 + k] === '1') rect(x + k * sc, y + r * sc, sc, sc, c);
      x += 4 * sc;
    }
  };
  const si = (v, unit) => {
    const a = Math.abs(v);
    const [f, p] = a >= 1 ? [1, ''] : a >= 1e-3 ? [1e3, 'M'] : a >= 1e-6 ? [1e6, 'U'] : [1e9, 'N'];
    return `${+(v * f).toPrecision(3)}${p}${unit}`;
  };

  rect(0, 0, W, GY - 4, [16, 24, 48]);
  rect(0, GY + 8 * DIV + 4, W, H - GY - 8 * DIV - 4, [16, 24, 48]);
  rect(GX + 12 * DIV + 10, GY, W - GX - 12 * DIV - 10, 8 * DIV, [24, 24, 30]);

  const runColor = runState === 'STOP' ? [200, 30, 30] : runState === 'WAIT' ? [200, 140, 0] : [30, 170, 60];
  rect(8, 8, 60, 22, runColor);
  text(runState === 'TD' ? 'RUN' : runState, 14, 14, [255, 255, 255]);
  text(`H ${si(num('TIM:SCAL'), 'S')}`, 90, 14, [255, 255, 255]);
  text(`T ${si(num('TRIG:EDG:LEV'), 'V')}`, 300, 14, [249, 115, 22]);
  text(state['TRIG:SWE'], 470, 14, [200, 200, 200]);

  // grid
  const grid = state['DISP:GRID'];
  const gc = [70, 70, 70];
  for (let i = 0; i <= 12; i++) for (let y = GY; y <= GY + 8 * DIV; y += grid === 'FULL' || i === 6 ? 2 : 999) set(GX + i * DIV, y, gc);
  for (let j = 0; j <= 8; j++) for (let x = GX; x <= GX + 12 * DIV; x += grid === 'FULL' || j === 4 ? 2 : 999) set(x, GY + j * DIV, gc);

  const tb = num('TIM:SCAL');
  const toff = num('TIM:OFFS');
  const colors = { 1: [245, 217, 10], 2: [34, 211, 238] };
  for (const n of [1, 2]) {
    if (!on(`CHAN${n}:DISP`)) continue;
    const scale = num(`CHAN${n}:SCAL`);
    const off = num(`CHAN${n}:OFFS`);
    let prev = null;
    for (let x = 0; x < 12 * DIV; x++) {
      const t = toff + ((x - 6 * DIV) / DIV) * tb;
      const v = signal(n, t);
      let y = Math.round(GY + 4 * DIV - ((v + off) / scale) * DIV);
      y = Math.max(GY, Math.min(GY + 8 * DIV, y));
      const y0 = prev === null ? y : prev;
      for (let yy = Math.min(y0, y); yy <= Math.max(y0, y); yy++) set(GX + x, yy, colors[n]);
      prev = y;
    }
    // ground marker on the left edge
    const gy = Math.max(GY, Math.min(GY + 8 * DIV, Math.round(GY + 4 * DIV - (off / scale) * DIV)));
    rect(GX - 14, gy - 4, 12, 9, colors[n]);
    text(String(n), GX - 12, gy - 3, [0, 0, 0], 1);
    text(`${n} ${si(scale, 'V')}`, 20 + (n - 1) * 200, GY + 8 * DIV + 14, colors[n]);
  }
  // trigger level marker on the right edge
  const src = Number((state['TRIG:EDG:SOUR'].match(/(\d)/) || [])[1] || 1);
  const lv = num('TRIG:EDG:LEV');
  const ty = Math.round(GY + 4 * DIV - ((lv + num(`CHAN${src}:OFFS`)) / num(`CHAN${src}:SCAL`)) * DIV);
  if (ty >= GY && ty <= GY + 8 * DIV) rect(GX + 12 * DIV + 1, ty - 3, 8, 7, [249, 115, 22]);
  // trigger position marker on the top edge
  const tx = Math.round(GX + 6 * DIV - (toff / tb) * DIV);
  if (tx >= GX && tx <= GX + 12 * DIV) rect(tx - 3, GY - 8, 7, 6, [249, 115, 22]);
  if (on('DEC1:DISP')) {
    rect(GX, GY + 6 * DIV, 12 * DIV, 18, [30, 60, 20]);
    text(`DECODE ${state['DEC1:MODE']}`, GX + 8, GY + 6 * DIV + 4, [163, 230, 53]);
  }
  if (on('MATH:DISP')) text(`MATH ${state['MATH:OPER']}`, 440, GY + 8 * DIV + 14, [232, 121, 249]);
  text('MOCK DS1202Z-E', 600, H - 22, [120, 120, 140]);

  // BMP, bottom-up rows, BGR
  const rowLen = W * 3;
  const out = Buffer.alloc(54 + rowLen * H);
  out.write('BM', 0, 'ascii');
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(W, 18);
  out.writeInt32LE(H, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(rowLen * H, 34);
  for (let y = 0; y < H; y++) {
    const dst = 54 + (H - 1 - y) * rowLen;
    for (let x = 0; x < W; x++) {
      const s = (y * W + x) * 3;
      const d = dst + x * 3;
      out[d] = px[s + 2]; out[d + 1] = px[s + 1]; out[d + 2] = px[s];
    }
  }
  return out;
}

function block(buf) {
  const len = String(buf.length);
  return Buffer.concat([Buffer.from(`#${len.length}${len}`, 'ascii'), buf, Buffer.from('\n')]);
}

// ----- waveform readout -----

function waveform() {
  const n = Number((state['WAV:SOUR'].match(/(\d)/) || [])[1] || 1);
  const scale = num(`CHAN${n}:SCAL`);
  const off = num(`CHAN${n}:OFFS`);
  const tb = num('TIM:SCAL');
  const yinc = scale / 25;
  const yorg = Math.round(off / yinc);
  const xinc = (12 * tb) / 1200;
  const xorg = -6 * tb + num('TIM:OFFS');
  const data = Buffer.alloc(1200);
  for (let i = 0; i < 1200; i++) {
    const v = signal(n, xorg + i * xinc);
    data[i] = Math.max(0, Math.min(255, Math.round(v / yinc + yorg + 127)));
  }
  const pre = [0, 0, 1200, 1, xinc, xorg, 0, yinc, yorg, 127].map((x) => (Number.isInteger(x) ? x : sci(x))).join(',');
  return { data, pre };
}

// ----- command handling -----

function query(hdr, args) {
  switch (hdr) {
    case '*IDN': return 'RIGOL TECHNOLOGIES,DS1202Z-E,MOCK0000000001,00.06.03';
    case '*OPC': return '1';
    case 'SYST:ERR': return errors.shift() || '0,"No error"';
    case 'TRIG:STAT': return runState;
    case 'ACQ:SRAT': {
      const both = on('CHAN1:DISP') && on('CHAN2:DISP');
      return sci(both ? 5e8 : 1e9);
    }
    case 'MEAS:ITEM': {
      const [item, src = state['MEAS:SOUR']] = args.split(',');
      return measure(item, src);
    }
    case 'MEAS:COUN:VAL': return state['MEAS:COUN:SOUR'] === 'OFF' ? '0.000000e+00' : sci(1000);
    case 'CURS:MAN:XDEL': return sci(((num('CURS:MAN:BX') || 200) - (num('CURS:MAN:AX') || 100)) / DIV * num('TIM:SCAL'));
    case 'CURS:MAN:IXDEL': return sci(Math.abs(1 / ((((num('CURS:MAN:BX') || 200) - (num('CURS:MAN:AX') || 100)) / DIV * num('TIM:SCAL')) || 1)));
    case 'CURS:MAN:YDEL': return sci(((num('CURS:MAN:AY') || 100) - (num('CURS:MAN:BY') || 200)) / DIV * num('CHAN1:SCAL'));
    case 'WAV:PRE': return waveform().pre;
    default:
      if (hdr in state) return state[hdr];
      log(`  (mock has no value for ${hdr}?, answering 0)`);
      return '0';
  }
}

function command(hdr, args) {
  switch (hdr) {
    case 'RUN': runState = 'RUN'; return;
    case 'STOP': runState = 'STOP'; return;
    case 'SING':
      runState = 'WAIT';
      setTimeout(() => { if (runState === 'WAIT') runState = 'STOP'; }, 1500);
      return;
    case '*RST': state = { ...DEFAULTS }; runState = 'RUN'; return;
    case 'AUT':
      Object.assign(state, {
        'CHAN1:DISP': '1', 'CHAN1:SCAL': sci(1), 'CHAN1:OFFS': sci(-1.65), 'TIM:SCAL': sci(2e-4), 'TIM:OFFS': sci(0),
        'TRIG:EDG:LEV': sci(1.65), 'TRIG:MODE': 'EDGE', 'TRIG:SWE': 'AUTO',
      });
      if (on('CHAN2:DISP')) Object.assign(state, { 'CHAN2:SCAL': sci(0.5), 'CHAN2:OFFS': sci(0) });
      runState = 'RUN';
      return;
    case 'TFOR': case 'CLE': case 'DISP:CLE': case 'MEAS:CLE': case 'MEAS:ITEM': case 'MEAS:STAT:RES':
    case 'REF1:SAV': case 'REF1:RES': case 'MATH:RES':
      return;
    case 'SYST:SET':
      return; // handled as a block in onLine
    case 'TEST:ERR':
      errors.push('-113,"Undefined header"');
      return;
    default: {
      const v = /^[A-Za-z][A-Za-z]*\d*$/.test(args) ? shortWord(args) : args;
      state[hdr] = /^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(v) && /SCAL|OFFS|LEV|PROB|WIDT|HOLD|TIM$/.test(hdr) ? sci(parseFloat(v)) : v;
    }
  }
}

function handle(sock, line) {
  const m = line.trim().match(/^(\S+)\s*(.*)$/);
  if (!m) return;
  const isQuery = m[1].endsWith('?');
  const hdr = normHeader(m[1].replace(/\?$/, ''));
  const args = m[2];
  if (isQuery) {
    if (hdr === 'DISP:DATA') {
      sock.write(block(makeScreen()));
      log(`> ${line.trim()}  -> <screen>`);
      return;
    }
    if (hdr === 'WAV:DATA') {
      sock.write(block(waveform().data));
      log(`> ${line.trim()}  -> <1200 bytes>`);
      return;
    }
    if (hdr === 'SYST:SET') {
      sock.write(block(Buffer.from(JSON.stringify({ state, runState }))));
      log(`> ${line.trim()}  -> <setup>`);
      return;
    }
    if (!KNOWN.has(hdr)) {
      // The real scope just stays silent, and the client times out.
      console.error(`!! UNDOCUMENTED QUERY ${line.trim()}: no reply (a real scope would hang here too)`);
      return;
    }
    const r = query(hdr, args);
    log(`> ${line.trim()}  -> ${r}`);
    sock.write(r + '\n');
  } else {
    log(`> ${line.trim()}`);
    command(hdr, args);
  }
}

const server = net.createServer((sock) => {
  log(`client ${sock.remoteAddress} connected`);
  let buf = Buffer.alloc(0);
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      // ":SYSTem:SETup #9000000123<binary>" carries a block, not a line.
      const hashAt = buf.indexOf(' #');
      const nl = buf.indexOf(0x0a);
      if (hashAt >= 0 && (nl < 0 || hashAt < nl)) {
        const nd = buf[hashAt + 2] - 0x30;
        if (buf.length < hashAt + 3 + nd) return;
        const len = parseInt(buf.toString('ascii', hashAt + 3, hashAt + 3 + nd), 10);
        const start = hashAt + 3 + nd;
        if (buf.length < start + len) return;
        const hdr = normHeader(buf.toString('ascii', 0, hashAt));
        const payload = buf.subarray(start, start + len);
        let end = start + len;
        if (buf[end] === 0x0a) end++;
        buf = buf.subarray(end);
        if (hdr === 'SYST:SET') {
          try {
            const s = JSON.parse(payload.toString());
            state = { ...DEFAULTS, ...s.state };
            runState = s.runState || 'RUN';
            log('> :SYSTem:SETup <block>  (restored)');
          } catch (e) {
            errors.push('-104,"Data type error"');
          }
        }
        continue;
      }
      if (nl < 0) return;
      const line = buf.toString('ascii', 0, nl);
      buf = buf.subarray(nl + 1);
      handle(sock, line);
    }
  });
  sock.on('error', () => {});
  sock.on('close', () => log('client disconnected'));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock DS1202Z-E listening on 127.0.0.1:${PORT}`);
});

module.exports = { server };
