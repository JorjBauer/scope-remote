// Page entry point: connection bar, live screen, status and measurement
// strips, settings. The panel, menus and shortcuts live in their own files.

import { h, fmtSI, toast, sleep, isInvalid } from './util.js';
import { core, emit, onChange, poll } from './core.js';
import { initPanel } from './panel.js';
import { initSheet, reload as reloadSheet } from './sheet.js';
import { initDrawer, toggleDrawer, closeDrawer, saveSetupShortcut } from './drawer.js';

const $ = (id) => document.getElementById(id);

const MEAS_CHOICES = [
  ['FREQuency', 'Freq', 'Hz'], ['PERiod', 'Period', 's'], ['VPP', 'Vpp', 'V'], ['VMAX', 'Max', 'V'], ['VMIN', 'Min', 'V'],
  ['VAVG', 'Avg', 'V'], ['VRMS', 'RMS', 'V'], ['VAMP', 'Ampl', 'V'], ['PDUTy', 'Duty', '%'], ['PWIDth', '+Width', 's'],
  ['NWIDth', '-Width', 's'], ['RTIMe', 'Rise', 's'], ['FTIMe', 'Fall', 's'], ['OVERshoot', 'Overshoot', '%'],
];

const actions = {
  async saveScreenshot() {
    try {
      const p = await window.scope.saveScreenshot(core.settings.format);
      if (p) toast(`Saved ${p}`, 'ok', 5000);
    } catch (e) {
      toast(e.message, 'error');
    }
  },
  async exportCsv(sources) {
    try {
      const p = await window.scope.exportCsv(sources || ['CHANnel1', 'CHANnel2']);
      if (p) toast(`Saved ${p}`, 'ok', 5000);
    } catch (e) {
      toast(e.message, 'error');
    }
  },
  saveSetupShortcut,
  checkFirmware: () => checkFirmware(true),
  async showErrors() {
    const r = await window.scope.run([], { checkErrors: true });
    toast(r.errors.length ? r.errors.join('; ') : 'No errors queued.', r.errors.length ? 'error' : 'ok', 7000);
  },
};

// ---------- connection ----------

async function connect() {
  const host = $('host').value.trim();
  if (!host) {
    $('host').focus();
    return;
  }
  // "192.168.1.50:5555" overrides the port setting.
  const [addr, portText] = host.split(':');
  setConnUi('connecting');
  try {
    const { idn } = await window.scope.connect(addr, Number(portText) || core.settings.port || 5555);
    core.idn = idn;
    core.connected = true;
    setConnUi('up');
    emit('conn');
    await poll().catch(() => {});
    reloadSheet();
    screenLoop();
    pollLoop();
    checkFirmware(false);
  } catch (e) {
    core.connected = false;
    setConnUi('down');
    const why = e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
    toast(`Could not connect to ${host}: ${why}`, 'error', 12000);
  }
}

// Fills in the first scope that answers a VXI-11 broadcast, but leaves the
// connecting to the user.
async function find() {
  const btn = $('find');
  btn.disabled = true;
  btn.textContent = '...';
  try {
    const found = await window.scope.find();
    if (found) {
      $('host').value = found;
      toast(`Found a scope at ${found}. Press Connect to use it.`, 'ok', 6000);
    } else {
      toast('No scope answered on this network. Is it on, and on the same subnet?', 'error', 8000);
    }
  } catch (e) {
    const why = e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
    toast(`Could not search the network: ${why}`, 'error', 12000);
  } finally {
    btn.textContent = 'Find';
    btn.disabled = $('host').disabled;
  }
}

async function disconnect() {
  core.connected = false;
  await window.scope.disconnect();
  setConnUi('down');
  emit('conn');
}

function setConnUi(s) {
  const btn = $('connect');
  const dot = $('dot');
  dot.className = `dot ${s}`;
  if (s === 'up') {
    const parts = core.idn.split(',');
    $('idn').textContent = `${parts[1] || 'Scope'}  fw ${parts[3] || '?'}`;
    btn.textContent = 'Disconnect';
    $('host').disabled = true;
    $('find').disabled = true;
    $('offline').classList.add('hidden');
  } else {
    $('idn').textContent = s === 'connecting' ? 'Connecting...' : 'Not connected';
    btn.textContent = s === 'connecting' ? '...' : 'Connect';
    $('host').disabled = s === 'connecting';
    $('find').disabled = s === 'connecting';
    if (s === 'down') $('offline').classList.remove('hidden');
  }
}

// The main process reconnects by itself after a timeout; follow along.
window.scope.onState(({ connected }) => {
  const was = core.connected;
  core.connected = connected;
  if (connected && !was) {
    setConnUi('up');
    emit('conn');
    screenLoop();
    pollLoop();
  } else if (!connected && was) {
    $('dot').className = 'dot connecting';
    $('idn').textContent = 'Connection lost...';
    emit('conn');
    setTimeout(() => {
      if (!core.connected) setConnUi('down');
    }, 8000);
  }
});
window.scope.onNotice((msg) => toast(msg, 'info'));

// ---------- live screen ----------

let screenRunning = false;
let lastUrl = null;
let triedFallback = false;

async function screenLoop() {
  if (screenRunning) return;
  screenRunning = true;
  const img = $('screen');
  let frames = 0;
  let t0 = performance.now();
  while (core.connected) {
    if (!core.settings.live || document.hidden) {
      await sleep(300);
      continue;
    }
    try {
      const r = await window.scope.screen(core.settings.format);
      if (!r.mime.startsWith('image/')) throw new Error('scope did not send an image');
      const url = URL.createObjectURL(new Blob([r.data], { type: r.mime }));
      img.src = url;
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = url;
      frames++;
      const dt = performance.now() - t0;
      if (dt > 2000) {
        $('fps').textContent = `${(frames * 1000 / dt).toFixed(1)} fps, ${(r.data.length / 1024).toFixed(0)} KB/frame (${core.settings.format})`;
        frames = 0;
        t0 = performance.now();
      }
    } catch (e) {
      if (!core.connected) break;
      // Some firmware revisions only do BMP. Fall back once, quietly.
      if (!triedFallback && core.settings.format !== 'BMP24') {
        triedFallback = true;
        toast(`Screen grab as ${core.settings.format} failed; switching to BMP24.`, 'info', 5000);
        core.settings.format = 'BMP24';
        saveSettings();
      }
      await sleep(1000);
    }
    await sleep(30);
  }
  screenRunning = false;
}

// ---------- status polling and measurements ----------

let pollRunning = false;

async function pollLoop() {
  if (pollRunning) return;
  pollRunning = true;
  while (core.connected) {
    try {
      await poll();
      await pollMeasurements();
    } catch (e) {
      // a timeout already triggered a reconnect; just wait
    }
    await sleep(1200);
  }
  pollRunning = false;
}

const meas = { 1: {}, 2: {} };

async function pollMeasurements() {
  const s = core.state;
  const cmds = [];
  const keys = [];
  for (const n of [1, 2]) {
    if (!s[`ch${n}disp`]) continue;
    for (const item of core.settings.measItems) {
      cmds.push(`:MEASure:ITEM? ${item},CHANnel${n}`);
      keys.push([n, item]);
    }
  }
  if (!cmds.length) {
    renderMeas();
    return;
  }
  const r = await window.scope.run(cmds, { background: true });
  keys.forEach(([n, item], i) => (meas[n][item] = parseFloat(r.results[i])));
  renderMeas();
}

function renderMeas() {
  const el = $('meas');
  const s = core.state;
  const blocks = [];
  for (const n of [1, 2]) {
    if (!s[`ch${n}disp`]) continue;
    blocks.push(h(`div.mblock.c${n}`,
      h('div.mch', `CH${n}`),
      core.settings.measItems.map((item) => {
        const def = MEAS_CHOICES.find((c) => c[0] === item) || [item, item, ''];
        const v = meas[n][item];
        let text;
        if (isInvalid(v)) text = '--';
        else if (def[2] === '%') text = `${v.toFixed(1)} %`;
        else text = fmtSI(v, def[2], 4);
        return h('div.mcell', h('div.mlabel', def[1]), h('div.mval', text));
      }),
    ));
  }
  if (!blocks.length) blocks.push(h('div.mempty', core.connected ? 'Both channels are off.' : 'Live measurements show here once connected.'));
  blocks.push(h('button.icon.medit', { title: 'Choose measurements', onclick: editMeas }, '⚙'));
  el.replaceChildren(...blocks);
}

function editMeas() {
  const box = h('div.modal-body',
    h('h3', 'Live measurements'),
    h('p.row-help', 'Shown under the screen for each channel that is on. These are read from the scope and do not clutter its own display.'),
    h('div.checks', MEAS_CHOICES.map(([k, label, unit]) => h('label.check',
      h('input', {
        type: 'checkbox',
        checked: core.settings.measItems.includes(k),
        onchange: (e) => {
          const set = new Set(core.settings.measItems);
          if (e.target.checked) set.add(k);
          else set.delete(k);
          core.settings.measItems = MEAS_CHOICES.map((c) => c[0]).filter((c) => set.has(c));
          saveSettings();
          renderMeas();
        },
      }),
      `${label} (${unit})`))),
  );
  showModal(box);
}

function renderStatus() {
  const s = core.state;
  const el = $('status');
  if (!core.connected || !s.tbscale) {
    el.replaceChildren(h('span.chip', 'No data'));
    return;
  }
  const chip = (cls, ...kids) => h(`span.chip${cls}`, ...kids);
  const chanChip = (n) => chip(`.c${n}${s[`ch${n}disp`] ? '' : '.off'}`,
    h('b', `CH${n}`), ` ${fmtSI(s[`ch${n}scale`], 'V')}/div  ${s[`ch${n}coup`] || ''}  ${s[`ch${n}probe`] || ''}x${s[`ch${n}bwl`] === '20M' ? '  BW20M' : ''}`);
  const slope = { POS: '↑', NEG: '↓', RFAL: '↕' }[String(s.trigslope).toUpperCase()] || '';
  const run = String(s.run || '').toUpperCase();
  el.replaceChildren(...[
    chip(`.run.r-${run.toLowerCase()}`, run || '?'),
    chanChip(1),
    chanChip(2),
    s.mathdisp ? chip('.cm', h('b', 'MATH')) : null,
    chip('', h('b', 'H'), ` ${fmtSI(s.tbscale, 's')}/div${s.tbmode && s.tbmode !== 'MAIN' ? `  ${s.tbmode}` : ''}`),
    s.trigmode === 'EDGE'
      ? chip('.ct', h('b', 'T'), ` EDGE ${String(s.trigsrc || '').replace('CHAN', 'CH')} ${slope} ${fmtSI(s.triglevel, 'V')}  ${s.sweep}`)
      : chip('.ct', h('b', 'T'), ` ${s.trigmode}  ${s.sweep}`),
    chip('', `${fmtSI(s.srate, 'Sa/s')}  ${s.mdepth === 'AUTO' ? 'mem auto' : `${fmtSI(parseFloat(s.mdepth), 'pts')}`}`),
    chip(`.acq`, s.acq),
  ].filter(Boolean));
}

onChange((what) => {
  if (what === 'state' || what === 'conn') {
    renderStatus();
    if (what === 'conn') renderMeas();
  }
  if (what === 'busy') document.body.classList.toggle('busy', core.busy > 0);
});

// ---------- firmware update check ----------

const DAY = 24 * 3600 * 1000;

// Compare the scope's firmware (from *IDN?) with the newest one Rigol lists.
// Automatic checks happen at most once a day; the result is cached.
async function checkFirmware(manual) {
  const fw = (core.idn.split(',')[3] || '').trim();
  if (!fw) return;
  if (!manual && core.settings.checkFirmware === false) return;
  let r = await window.appStore.get('firmwareCheck', null);
  const stale = !r || r.fw !== fw || Date.now() - r.checked > DAY;
  if (manual || stale) {
    try {
      r = { ...(await window.scope.checkFirmware(fw)), fw };
      await window.appStore.set('firmwareCheck', r);
    } catch (e) {
      if (manual) toast(`Firmware check failed: ${e.message}`, 'error', 6000);
      return;
    }
  }
  showFirmware(r);
  if (manual) {
    toast(r.status === 'newer'
      ? `Rigol lists firmware ${r.latest}; this scope has ${r.installed}.`
      : `Up to date: this scope has ${r.installed}, Rigol's newest is ${r.latest}.`, r.status === 'newer' ? 'info' : 'ok', 7000);
  }
}

function showFirmware(r) {
  const b = $('fw');
  if (!r || r.status === 'unknown') {
    b.className = 'fw hidden';
    return;
  }
  b.className = `fw ${r.status}`;
  b.textContent = r.status === 'newer' ? `Firmware ${r.latest} available` : 'Firmware up to date';
  b.title = `This scope: ${r.installed}. Newest on Rigol's site: ${r.latest} (checked ${new Date(r.checked).toLocaleString()}). Click to open Rigol's firmware page.`;
}

// ---------- settings ----------

async function loadSettings() {
  const saved = await window.appStore.get('settings', {});
  Object.assign(core.settings, saved);
}

function saveSettings() {
  window.appStore.set('settings', core.settings);
}

function showModal(body) {
  const m = $('modal');
  m.replaceChildren(h('div.modal-card', h('button.icon.modal-x', { onclick: hideModal }, '×'), body));
  m.classList.add('show');
}

function hideModal() {
  $('modal').classList.remove('show');
}

async function openSettings() {
  const fld = (label, ctl, help) => h('label.field', h('span', label), ctl, help ? h('div.row-help', help) : null);
  const sel = (key, opts) => h('select', {
    onchange: (e) => {
      const v = e.target.value;
      core.settings[key] = /^\d+(\.\d+)?$/.test(v) ? Number(v) : v;
      saveSettings();
    },
  }, opts.map(([v, l]) => h('option', { value: v, selected: String(core.settings[key]) === String(v) }, l)));
  const file = await window.appStore.path();
  showModal(h('div.modal-body',
    h('h3', 'Settings'),
    fld('My probes are switched to', sel('probe', [['10', '10x (the usual)'], ['1', '1x']]), 'Shortcuts set the scope\'s probe ratio to match.'),
    fld('Screen image format', sel('format', [['PNG', 'PNG (small, scope compresses it)'], ['BMP8', 'BMP 8-bit'], ['BMP24', 'BMP 24-bit (largest, no compression)'], ['JPEG', 'JPEG']]),
      'The frame rate is shown under the screen. Try each and keep the fastest on your network.'),
    fld('Connect automatically at startup', sel('autoConnect', [['true', 'Yes'], ['false', 'No']])),
    fld('Check for firmware updates', sel('checkFirmware', [['true', 'Once a day, after connecting'], ['false', 'Only when I ask']]),
      'Reads Rigol\'s public firmware page (rigolna.com/firmware). The app never installs firmware; updating is done from a USB stick on the scope.'),
    fld('Port', h('input.num', {
      type: 'text',
      value: core.settings.port || 5555,
      onchange: (e) => {
        core.settings.port = Number(e.target.value) || 5555;
        saveSettings();
      },
    }), 'The scope listens for SCPI on TCP port 5555.'),
    h('p.row-help', 'Settings and saved setups are kept in ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); window.appStore.reveal(file); } }, file), '.'),
    h('h3', 'Keyboard'),
    h('table.keys',
      [['Space', 'Run / Stop'], ['S', 'Single'], ['A', 'Auto'], ['C', 'Clear'], ['F', 'Force trigger'], ['P', 'Save screenshot'], ['Tab', 'Shortcuts drawer'], ['Esc', 'Close drawer / dialog']]
        .map(([k, d]) => h('tr', h('td', h('kbd', k)), h('td', d)))),
  ));
}

// ---------- startup ----------

async function main() {
  await loadSettings();
  for (const k of ['autoConnect', 'checkFirmware']) {
    if (typeof core.settings[k] === 'string') core.settings[k] = core.settings[k] === 'true';
  }
  $('fw').addEventListener('click', () => window.scope.openFirmwarePage());

  $('connect').addEventListener('click', () => (core.connected ? disconnect() : connect()));
  $('host').addEventListener('keydown', (e) => e.key === 'Enter' && connect());
  $('find').addEventListener('click', find);
  $('btn-shortcuts').addEventListener('click', toggleDrawer);
  $('btn-shot').addEventListener('click', actions.saveScreenshot);
  $('btn-csv').addEventListener('click', () => actions.exportCsv());
  $('btn-settings').addEventListener('click', openSettings);
  $('btn-live').addEventListener('click', () => {
    core.settings.live = !core.settings.live;
    saveSettings();
    $('btn-live').textContent = core.settings.live ? 'Pause screen' : 'Resume screen';
  });
  $('btn-live').textContent = core.settings.live ? 'Pause screen' : 'Resume screen';
  $('modal').addEventListener('click', (e) => e.target.id === 'modal' && hideModal());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideModal();
      closeDrawer();
    }
    if (e.key === 'Tab' && !e.target.closest('input, select, textarea')) {
      e.preventDefault();
      toggleDrawer();
    }
  });

  initSheet($('sheet'), actions);
  initPanel($('panel'), actions);
  await initDrawer($('drawer'));
  renderStatus();
  renderMeas();

  const launchHost = await window.scope.launchHost();
  const host = launchHost || (await window.appStore.get('host', ''));
  $('host').value = host;
  setConnUi('down');
  if (host && (launchHost || core.settings.autoConnect !== false)) connect();
}

main();
