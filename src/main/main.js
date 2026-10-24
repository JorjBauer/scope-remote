// Electron main process: owns the window, the socket to the scope, and the
// little JSON file that remembers settings and saved setups.

'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { Scpi } = require('./scpi');
const store = require('./store');
const { checkFirmware, FIRMWARE_PAGE } = require('./firmware');
const { findScope } = require('./discover');
const { checkAppUpdate, isReleasePage } = require('./appupdate');

const scope = new Scpi();
let win = null;
let reconnecting = false;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

scope.on('state', (up) => send('scope:state', { connected: up, host: scope.host }));
scope.on('traffic', (t) => send('scope:traffic', t));

// SCOPE_TRACE=1 prints every command and reply, for chasing the real
// scope's quirks.
if (process.env.SCOPE_TRACE) {
  const t0 = Date.now();
  scope.on('traffic', (t) => {
    const ms = String(Date.now() - t0).padStart(6);
    console.error(`${ms} ${t.dir === 'out' ? '>' : '<'} ${t.cmd}${t.dir === 'in' ? `  => ${JSON.stringify(t.text)}` : ''}`);
  });
}

// A timed-out reply leaves the stream in an unknown state, so the client
// hangs up. Dial straight back in so the user only sees a blip.
scope.on('reconnect', async ({ host, port }) => {
  if (reconnecting || !host) return;
  reconnecting = true;
  send('scope:notice', 'The scope stopped answering; reconnecting...');
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    try {
      await scope.connect(host, port);
      send('scope:notice', 'Reconnected.');
      break;
    } catch (e) {
      // keep trying
    }
  }
  reconnecting = false;
});

function mimeOf(buf) {
  if (buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.length > 2 && buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length > 2 && (buf[0] === 0x49 || buf[0] === 0x4d)) return 'image/tiff';
  return 'application/octet-stream';
}

function extOf(mime) {
  return { 'image/png': 'png', 'image/bmp': 'bmp', 'image/jpeg': 'jpg', 'image/tiff': 'tiff' }[mime] || 'bin';
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function grabScreen(format, urgent = false) {
  const t0 = Date.now();
  const data = await scope.queryBlock(`:DISPlay:DATA? ON,OFF,${format}`, { urgent, timeout: 20000 });
  return { data, mime: mimeOf(data), ms: Date.now() - t0 };
}

// Read one channel's on-screen waveform as volts.
async function readWaveform(src) {
  await scope.write(`:WAVeform:SOURce ${src}`, { urgent: true });
  await scope.write(':WAVeform:MODE NORMal', { urgent: true });
  await scope.write(':WAVeform:FORMat BYTE', { urgent: true });
  const pre = (await scope.query(':WAVeform:PREamble?', { urgent: true })).split(',').map(Number);
  const [, , , , xinc, xorg, xref, yinc, yorg, yref] = pre;
  const raw = await scope.queryBlock(':WAVeform:DATA?', { urgent: true });
  const t = new Array(raw.length);
  const v = new Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    t[i] = (i - xref) * xinc + xorg;
    v[i] = (raw[i] - yorg - yref) * yinc;
  }
  return { t, v };
}

// Socket errors say what failed, not what to do about it
function explainConnectError(err, host, port) {
  switch (err.code) {
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      // macOS reports a Local Network denial as "no route to host", which
      // looks just like a scope that's switched off.
      return `no route to ${host} (${err.code}). If the scope is up, macOS is probably blocking this app: ` +
        'allow it under System Settings, Privacy & Security, Local Network, then reconnect.';
    case 'ECONNREFUSED':
      return `${host} refused port ${port}. The scope only takes one remote client at a time, ` +
        'so check that nothing else (a script, UltraScope) is still connected.';
    case 'ENOTFOUND':
      return `can't find a host called "${host}".`;
    default:
      return err.message;
  }
}

function registerIpc() {
  ipcMain.handle('scope:connect', async (_e, host, port) => {
    try {
      await scope.connect(host, port || 5555);
    } catch (err) {
      throw new Error(explainConnectError(err, host, port || 5555));
    }
    const idn = await scope.query('*IDN?', { urgent: true });
    store.set('host', host);
    return { idn };
  });

  // Only ever reports an address; connecting stays the user's call.
  ipcMain.handle('scope:find', async () => {
    try {
      return await findScope();
    } catch (err) {
      throw new Error(explainConnectError(err, 'the local network', 111));
    }
  });

  ipcMain.handle('scope:disconnect', () => {
    scope.close();
  });

  ipcMain.handle('scope:status', () => ({ connected: scope.connected, host: scope.host }));

  // Run a list of commands in order. Queries (ending in '?') come back in
  // the results array; plain commands give null. The whole list is queued
  // at once so it goes out as one run; queuing one command per reply let a
  // half-second screen grab slip in between every few, and a 25-query poll
  // took six seconds.
  ipcMain.handle('scope:run', async (_e, cmds, opts = {}) => {
    const pending = [];
    for (const c of cmds) {
      const cmd = String(c).trim();
      if (!cmd) continue;
      if (/\?(\s|$)/.test(cmd)) pending.push(scope.query(cmd, { urgent: !opts.background }));
      else pending.push(scope.write(cmd, { urgent: !opts.background, gap: opts.gap }).then(() => null));
    }
    const out = await Promise.all(pending);
    if (opts.checkErrors) {
      const errs = [];
      for (let i = 0; i < 20; i++) {
        const e = await scope.query(':SYSTem:ERRor?', { urgent: true });
        if (/^0\s*,|^\+0\s*,/.test(e)) break;
        errs.push(e);
      }
      return { results: out, errors: errs };
    }
    return { results: out, errors: [] };
  });

  ipcMain.handle('scope:screen', async (_e, format) => {
    const r = await grabScreen(format || 'PNG');
    return { data: new Uint8Array(r.data), mime: r.mime, ms: r.ms };
  });

  ipcMain.handle('scope:saveScreenshot', async (_e, format) => {
    const r = await grabScreen(format || 'PNG', true);
    const ext = extOf(r.mime);
    const res = await dialog.showSaveDialog(win, {
      title: 'Save screenshot',
      defaultPath: path.join(app.getPath('desktop'), `scope-${stamp()}.${ext}`),
      filters: [{ name: 'Image', extensions: [ext] }],
    });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, r.data);
    return res.filePath;
  });

  ipcMain.handle('scope:exportCsv', async (_e, sources) => {
    const cols = [];
    for (const s of sources) cols.push({ name: s, ...(await readWaveform(s)) });
    if (!cols.length) return null;
    const n = Math.min(...cols.map((c) => c.v.length));
    const lines = ['time_s,' + cols.map((c) => `${c.name}_V`).join(',')];
    for (let i = 0; i < n; i++) {
      lines.push([cols[0].t[i].toExponential(6), ...cols.map((c) => c.v[i].toExponential(6))].join(','));
    }
    const res = await dialog.showSaveDialog(win, {
      title: 'Export waveform',
      defaultPath: path.join(app.getPath('desktop'), `waveform-${stamp()}.csv`),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, lines.join('\n') + '\n');
    return res.filePath;
  });

  // The scope's own setup blob: everything it would put in a "Setups" file.
  ipcMain.handle('scope:getSetup', async () => {
    const blob = await scope.queryBlock(':SYSTem:SETup?', { urgent: true });
    return blob.toString('base64');
  });

  ipcMain.handle('scope:putSetup', async (_e, b64) => {
    await scope.writeBlock(':SYSTem:SETup', Buffer.from(b64, 'base64'), { urgent: true, gap: 400 });
  });

  ipcMain.handle('fw:check', (_e, fw) => checkFirmware(fw));
  // Only ever opens Rigol's firmware page or one of this app's GitHub
  // release pages; nothing else leaves the app.
  ipcMain.handle('fw:openPage', () => shell.openExternal(FIRMWARE_PAGE));

  // Automatic checks only from a packaged app: a source checkout has no
  // release of its own to compare with.
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), packaged: app.isPackaged }));
  ipcMain.handle('app:checkUpdate', () => checkAppUpdate(app.getVersion()));
  ipcMain.handle('app:openRelease', (_e, url) => {
    if (isReleasePage(url)) shell.openExternal(url);
  });

  // `make demo` (or SCOPE_HOST=...) points the app at a scope on launch.
  ipcMain.handle('app:launchHost', () => process.env.SCOPE_HOST || null);

  ipcMain.handle('store:get', (_e, key, dflt) => store.get(key, dflt));
  ipcMain.handle('store:set', (_e, key, value) => store.set(key, value));
  ipcMain.handle('store:path', () => store.file());
  ipcMain.handle('shell:reveal', (_e, p) => shell.showItemInFolder(p));
}

function createWindow() {
  const bounds = store.get('bounds', { width: 1500, height: 920 });
  // A capture run (below) opens without taking focus, so typing in another
  // app can't land on the panel and press RUN/STOP or AUTO on a real scope.
  const capture = !!process.env.SCOPE_CAPTURE;
  if (capture && app.dock) app.dock.hide();
  win = new BrowserWindow({
    ...bounds,
    show: !capture,
    minWidth: 1100,
    minHeight: 700,
    title: 'Scope Remote',
    backgroundColor: '#14161a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Local use only: the window never navigates away or opens other pages.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.on('close', () => store.set('bounds', win.getBounds()));
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // For testing the UI: SCOPE_CAPTURE=out.png saves a picture of the window
  // after SCOPE_CAPTURE_DELAY ms, optionally running SCOPE_CAPTURE_JS in the
  // page first, then quits.
  if (capture) {
    win.once('ready-to-show', () => win.showInactive());
    win.webContents.once('did-finish-load', async () => {
      const delay = Number(process.env.SCOPE_CAPTURE_DELAY) || 6000;
      await new Promise((r) => setTimeout(r, delay));
      if (process.env.SCOPE_CAPTURE_JS) {
        await win.webContents.executeJavaScript(process.env.SCOPE_CAPTURE_JS).catch((e) => console.error(e));
        await new Promise((r) => setTimeout(r, 2500));
      }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.SCOPE_CAPTURE, img.toPNG());
      app.quit();
    });
  }
}

// `make demo` and tests use their own settings folder, so they never pick up
// (and auto-connect to) the real scope's saved address.
if (process.env.SCOPE_USERDATA) app.setPath('userData', path.resolve(process.env.SCOPE_USERDATA));

app.whenReady().then(() => {
  store.init(app.getPath('userData'));
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => {
  scope.close();
  app.quit();
});
