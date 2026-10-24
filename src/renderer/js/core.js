// Shared state and the command runner used by every part of the page.

import { sleep, truthy } from './util.js';

const listeners = new Set();

export const core = {
  connected: false,
  idn: '',
  // Last known scope settings, refreshed by poll(). Keys are filled in by
  // POLL_LIST below.
  state: {},
  settings: {
    probe: 10, // what the user's probes are switched to
    format: 'PNG', // screen grab format
    live: true,
    measItems: ['FREQuency', 'VPP', 'VMAX', 'VMIN', 'VAVG', 'PDUTy'],
    autoConnect: true,
  },
  busy: 0,
};

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(what) {
  for (const fn of listeners) fn(what);
}

// Run a script of SCPI lines. Two pseudo-commands are understood:
//   @wait <ms>     pause (after *RST or AUToscale the scope needs a moment)
//   # comment      ignored
export async function run(lines, { checkErrors = true, background = false } = {}) {
  if (!core.connected) throw new Error('Not connected to the scope.');
  const results = [];
  const errors = [];
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const r = await window.scope.run(batch, { background });
    results.push(...r.results);
    batch = [];
  };
  core.busy++;
  emit('busy');
  try {
    for (const raw of lines) {
      const line = String(raw).trim();
      if (!line || line.startsWith('#')) continue;
      const w = line.match(/^@wait\s+(\d+)/i);
      if (w) {
        await flush();
        await sleep(Number(w[1]));
        continue;
      }
      batch.push(line);
    }
    await flush();
    if (checkErrors) {
      const r = await window.scope.run([], { checkErrors: true });
      errors.push(...r.errors);
    }
  } finally {
    core.busy--;
    emit('busy');
  }
  return { results, errors };
}

export async function q(cmd, background = false) {
  const r = await window.scope.run([cmd], { background });
  return r.results[0];
}

export async function send(cmd) {
  await window.scope.run([cmd], {});
}

// What the status strip and knobs need to know. Polled in the background.
const POLL_LIST = [
  ['run', ':TRIGger:STATus?'],
  ['ch1disp', ':CHANnel1:DISPlay?'],
  ['ch1scale', ':CHANnel1:SCALe?'],
  ['ch1offset', ':CHANnel1:OFFSet?'],
  ['ch1coup', ':CHANnel1:COUPling?'],
  ['ch1probe', ':CHANnel1:PROBe?'],
  ['ch1bwl', ':CHANnel1:BWLimit?'],
  ['ch2disp', ':CHANnel2:DISPlay?'],
  ['ch2scale', ':CHANnel2:SCALe?'],
  ['ch2offset', ':CHANnel2:OFFSet?'],
  ['ch2coup', ':CHANnel2:COUPling?'],
  ['ch2probe', ':CHANnel2:PROBe?'],
  ['ch2bwl', ':CHANnel2:BWLimit?'],
  ['mathdisp', ':MATH:DISPlay?'],
  ['tbmode', ':TIMebase:MODE?'],
  ['tbscale', ':TIMebase:MAIN:SCALe?'],
  ['tboffset', ':TIMebase:MAIN:OFFSet?'],
  ['trigmode', ':TRIGger:MODE?'],
  ['sweep', ':TRIGger:SWEep?'],
  ['trigsrc', ':TRIGger:EDGe:SOURce?'],
  ['trigslope', ':TRIGger:EDGe:SLOPe?'],
  ['triglevel', ':TRIGger:EDGe:LEVel?'],
  ['acq', ':ACQuire:TYPE?'],
  ['srate', ':ACQuire:SRATe?'],
  ['mdepth', ':ACQuire:MDEPth?'],
];

const NUMERIC = new Set(['ch1scale', 'ch1offset', 'ch1probe', 'ch2scale', 'ch2offset', 'ch2probe',
  'tbscale', 'tboffset', 'triglevel', 'srate']);
const BOOL = new Set(['ch1disp', 'ch2disp', 'mathdisp']);

// Everything that changes a setting asks for a poll afterward, so calls pile
// up. Only one runs at a time; a call made while one is running gets one
// more pass after it, so it still sees the change it asked about.
let polling = null;
let pollAgain = false;

export function poll() {
  if (!core.connected) return Promise.resolve();
  if (polling) {
    pollAgain = true;
    return polling;
  }
  polling = (async () => {
    do {
      pollAgain = false;
      await pollOnce();
    } while (pollAgain && core.connected);
  })().finally(() => {
    polling = null;
  });
  return polling;
}

async function pollOnce() {
  const r = await window.scope.run(POLL_LIST.map((p) => p[1]), { background: true });
  const s = {};
  POLL_LIST.forEach(([k], i) => {
    const v = r.results[i];
    s[k] = NUMERIC.has(k) ? parseFloat(v) : BOOL.has(k) ? truthy(v) : v;
  });
  core.state = s;
  emit('state');
}

// Update the local copy right away so knobs feel instant; the next poll
// corrects anything the scope did not accept.
export function patchState(obj) {
  Object.assign(core.state, obj);
  emit('state');
}
