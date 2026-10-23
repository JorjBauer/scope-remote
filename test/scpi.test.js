// Tests run against tools/mock-scope.js on 127.0.0.1, never a real scope.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const { Scpi, parseBlock, blockHeader } = require('../src/main/scpi');
const fw = require('../src/main/firmware');

const PORT = 20000 + Math.floor(Math.random() * 20000);
let mock;

test.before(async () => {
  mock = spawn(process.execPath, [path.join(__dirname, '..', 'tools', 'mock-scope.js'), String(PORT), '--quiet'], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    mock.stdout.on('data', (d) => /listening/.test(d) && resolve());
    mock.on('exit', (c) => reject(new Error(`mock exited ${c}`)));
  });
});

test.after(() => mock && mock.kill());

test('parseBlock waits for the whole block and strips the header', () => {
  const full = Buffer.concat([blockHeader(5), Buffer.from('hello\nrest')]);
  assert.strictEqual(parseBlock(full.subarray(0, 4)), null);
  assert.strictEqual(parseBlock(full.subarray(0, 7)), null);
  const r = parseBlock(full);
  assert.strictEqual(r.data.toString(), 'hello');
  assert.strictEqual(full.subarray(r.consumed).toString(), 'rest');
});

test('parseBlock handles a 9-digit header', () => {
  const data = Buffer.alloc(1234, 7);
  const r = parseBlock(Buffer.concat([Buffer.from('#9000001234'), data]));
  assert.strictEqual(r.data.length, 1234);
});

test('talks to the mock scope', async (t) => {
  const s = new Scpi();
  await s.connect('127.0.0.1', PORT);
  t.after(() => s.close());

  assert.match(await s.query('*IDN?'), /DS1202Z-E/);

  await s.write(':CHANnel1:SCALe 0.5');
  assert.strictEqual(parseFloat(await s.query(':CHAN1:SCAL?')), 0.5);

  await s.write(':TIMebase:MAIN:SCALe 0.001');
  assert.strictEqual(parseFloat(await s.query(':TIMebase:SCALe?')), 0.001);

  const img = await s.queryBlock(':DISPlay:DATA? ON,OFF,PNG');
  assert.strictEqual(img.toString('ascii', 0, 2), 'BM');
  assert.strictEqual(img.length, 54 + 800 * 480 * 3);

  // Saving and restoring the setup blob puts settings back.
  const blob = await s.queryBlock(':SYSTem:SETup?');
  await s.write(':CHANnel1:SCALe 2');
  await s.writeBlock(':SYSTem:SETup', blob);
  assert.strictEqual(parseFloat(await s.query(':CHANnel1:SCALe?')), 0.5);

  // Error queue
  await s.write(':TEST:ERR');
  assert.match(await s.query(':SYSTem:ERRor?'), /^-113/);
  assert.match(await s.query(':SYSTem:ERRor?'), /^0,/);
});

test('urgent requests jump ahead of background ones', async (t) => {
  const s = new Scpi();
  await s.connect('127.0.0.1', PORT);
  t.after(() => s.close());
  const order = [];
  const bg = [1, 2, 3].map((i) => s.query('*IDN?').then(() => order.push(`bg${i}`)));
  const urgent = s.query(':TRIGger:STATus?', { urgent: true }).then(() => order.push('urgent'));
  await Promise.all([...bg, urgent]);
  // bg1 was already on the wire; the urgent one goes next.
  assert.deepStrictEqual(order, ['bg1', 'urgent', 'bg2', 'bg3']);
});

test('measurements follow channel state', async (t) => {
  const s = new Scpi();
  await s.connect('127.0.0.1', PORT);
  t.after(() => s.close());
  await s.write(':CHANnel1:DISPlay 1');
  await s.write(':CHANnel1:COUPling DC');
  assert.ok(Math.abs(parseFloat(await s.query(':MEASure:ITEM? VPP,CHANnel1')) - 3.3) < 0.01);
  await s.write(':CHANnel2:DISPlay 0');
  assert.ok(parseFloat(await s.query(':MEASure:ITEM? VPP,CHANnel2')) > 1e37);
});

test('firmware page parsing picks the DS1000Z-E row, not DS1000Z', () => {
  const html = `<table>
    <tr><td><span>DS1000Z / MSO1000Z / DS1000Z-Plus</span></td><td><a href="#">v4.05</a></td><td>Release Notes</td></tr>
    <tr><td><span>DS1000Z-E</span></td><td><a href="#"><span>v6.04</span></a></td><td>Release Notes</td></tr>
  </table>`;
  const latest = fw.parseLatest(html);
  assert.deepStrictEqual(latest, { major: 6, minor: 4, label: 'v6.04' });
  assert.strictEqual(fw.compare(fw.parseInstalled('00.06.03'), latest), 'newer');
  assert.strictEqual(fw.compare(fw.parseInstalled('00.06.04.SP1'), latest), 'current');
  assert.strictEqual(fw.compare(fw.parseInstalled(''), latest), 'unknown');
  assert.strictEqual(fw.parseLatest('<td>nothing here</td>'), null);
});

test('firmware check uses the fetched page', async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, text: async () => '<td>DS1000Z-E</td><td>v6.04</td>' });
  const r = await fw.checkFirmware('00.06.03', fakeFetch);
  assert.strictEqual(r.status, 'newer');
  assert.strictEqual(r.latest, 'v6.04');
});
