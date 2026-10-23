// The virtual front panel: buttons laid out like the DS1202Z-E, and knobs
// you can scroll, drag, or click.
//
// Knob conventions here (easier than the real thing):
//   scale knobs: "+" zooms in (bigger trace), "-" zooms out
//   position knobs: arrows move the trace that way
//   double-click a knob = push it (same as pressing the real knob)
//   hold Shift while scrolling or clicking for fine steps

import { h, fmtSI, ladder125, stepLadder, toast, isInvalid } from './util.js';
import { core, run, q, onChange, patchState, poll } from './core.js';
import { openSheet, reload as reloadSheet } from './sheet.js';

const knobs = [];

// Send only the newest value while a knob spins; older ones are skipped.
const inflight = new Map();
function sendLatest(key, cmd) {
  const slot = inflight.get(key);
  if (slot) {
    slot.next = cmd;
    return;
  }
  const s = { next: null };
  inflight.set(key, s);
  (async () => {
    let c = cmd;
    while (c) {
      try {
        await run([c], { checkErrors: false });
      } catch (e) {
        toast(e.message, 'error');
      }
      c = s.next;
      s.next = null;
    }
    inflight.delete(key);
    clearTimeout(sendLatest.t);
    sendLatest.t = setTimeout(() => {
      poll().catch(() => {});
      reloadSheet();
    }, 500);
  })();
}

function knob({ label, color, text, step, push, pushHint, arrows = ['−', '+'], tips = [] }) {
  let angle = 0;
  const dial = h('div.dial', h('div.mark'));
  const value = h('div.knob-val', '--');
  const turn = (dir, fine) => {
    if (!core.connected) return;
    angle += dir * 18;
    dial.style.transform = `rotate(${angle}deg)`;
    step(dir, fine);
  };
  let wheelAcc = 0;
  dial.addEventListener('wheel', (e) => {
    e.preventDefault();
    wheelAcc += e.deltaY;
    while (Math.abs(wheelAcc) >= 40) {
      const dir = wheelAcc < 0 ? 1 : -1;
      wheelAcc -= -dir * 40;
      turn(dir, e.shiftKey);
    }
  }, { passive: false });
  let dragY = null;
  dial.addEventListener('pointerdown', (e) => {
    dragY = e.clientY;
    dial.setPointerCapture(e.pointerId);
  });
  dial.addEventListener('pointermove', (e) => {
    if (dragY === null) return;
    const d = dragY - e.clientY;
    if (Math.abs(d) >= 14) {
      turn(d > 0 ? 1 : -1, e.shiftKey);
      dragY = e.clientY;
    }
  });
  dial.addEventListener('pointerup', () => (dragY = null));
  if (push) dial.addEventListener('dblclick', () => core.connected && push());
  dial.title = `Scroll or drag up/down to turn.${push ? ` Double-click to push: ${pushHint}.` : ''} Shift = fine.`;

  const el = h('div.knob', { style: { '--kc': color || 'var(--fg-dim)' } },
    h('div.knob-label', label),
    h('div.knob-row',
      h('button.kbtn', { title: tips[0] || '', onclick: (e) => turn(-1, e.shiftKey) }, arrows[0]),
      dial,
      h('button.kbtn', { title: tips[1] || '', onclick: (e) => turn(1, e.shiftKey) }, arrows[1]),
    ),
    value,
    push ? h('button.push', { onclick: () => core.connected && push() }, pushHint) : null,
  );
  knobs.push(() => (value.textContent = text()));
  return el;
}

const st = () => core.state;

function vscaleStep(n) {
  return (dir) => {
    const probe = st()[`ch${n}probe`] || 10;
    const cur = st()[`ch${n}scale`];
    if (!cur) return;
    const next = stepLadder(ladder125(1e-3 * probe, 10 * probe), cur, -dir);
    patchState({ [`ch${n}scale`]: next });
    sendLatest(`ch${n}scale`, `:CHANnel${n}:SCALe ${next}`);
  };
}

function vposStep(n) {
  return (dir, fine) => {
    const scale = st()[`ch${n}scale`] || 1;
    const next = (st()[`ch${n}offset`] || 0) + dir * scale * (fine ? 0.04 : 0.2);
    patchState({ [`ch${n}offset`]: next });
    sendLatest(`ch${n}offset`, `:CHANnel${n}:OFFSet ${next.toPrecision(4)}`);
  };
}

const TB_LADDER = ladder125(5e-9, 50);

function hscaleStep(dir) {
  const cur = st().tbscale;
  if (!cur) return;
  const next = stepLadder(TB_LADDER, cur, -dir);
  patchState({ tbscale: next });
  sendLatest('tbscale', `:TIMebase:MAIN:SCALe ${next}`);
}

function hposStep(dir, fine) {
  // Rigol's offset is the time at screen center, so a positive offset
  // slides the waveform left. The arrow shows which way the trace goes.
  const scale = st().tbscale || 1e-3;
  const next = (st().tboffset || 0) - dir * scale * (fine ? 0.04 : 0.2);
  patchState({ tboffset: next });
  sendLatest('tboffset', `:TIMebase:MAIN:OFFSet ${next.toPrecision(4)}`);
}

function trigSrcN() {
  const m = String(st().trigsrc || '').match(/(\d)/);
  return m ? Number(m[1]) : 1;
}

function levelStep(dir, fine) {
  const scale = st()[`ch${trigSrcN()}scale`] || 1;
  const next = (st().triglevel || 0) + dir * scale * (fine ? 0.02 : 0.1);
  patchState({ triglevel: next });
  sendLatest('triglevel', `:TRIGger:EDGe:LEVel ${next.toPrecision(4)}`);
}

// Same as pushing the real LEVEL knob: put the level halfway up the signal.
async function level50() {
  const src = `CHANnel${trigSrcN()}`;
  const hi = parseFloat(await q(`:MEASure:ITEM? VMAX,${src}`));
  const lo = parseFloat(await q(`:MEASure:ITEM? VMIN,${src}`));
  if (isInvalid(hi) || isInvalid(lo)) {
    toast('No signal to center on yet.', 'error');
    return;
  }
  const mid = (hi + lo) / 2;
  patchState({ triglevel: mid });
  await run([`:TRIGger:EDGe:LEVel ${mid.toPrecision(4)}`]);
  toast(`Trigger level set to ${fmtSI(mid, 'V')}`, 'ok');
}

async function simple(cmds, msg) {
  try {
    const r = await run(cmds);
    if (r.errors.length) toast(`Scope said: ${r.errors.join('; ')}`, 'error', 6000);
    else if (msg) toast(msg, 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
  poll().catch(() => {});
  reloadSheet();
}

function sheetBtn(label, id, cls = '') {
  return h(`button.pbtn${cls}`, { dataset: { sheet: id }, onclick: () => openSheet(id) }, label);
}

function chanBlock(n) {
  const color = `var(--ch${n})`;
  const onoff = h('button.chan-eye', {
    title: `Show or hide CH${n}`,
    onclick: () => simple([`:CHANnel${n}:DISPlay ${st()[`ch${n}disp`] ? 0 : 1}`]),
  });
  knobs.push(() => {
    const on = !!st()[`ch${n}disp`];
    onoff.textContent = on ? 'ON' : 'OFF';
    onoff.classList.toggle('on', on);
  });
  return h('div.chan', { style: { '--kc': color } },
    h('div.chan-head', sheetBtn(`CH${n}`, `ch${n}`, '.chanbtn'), onoff),
    knob({
      label: 'Scale', color, step: vscaleStep(n), tips: ['Zoom out (more volts per square)', 'Zoom in (fewer volts per square)'],
      text: () => fmtSI(st()[`ch${n}scale`], 'V/div'),
    }),
    knob({
      label: 'Position', color, step: vposStep(n), arrows: ['▼', '▲'], tips: ['Move trace down', 'Move trace up'],
      text: () => fmtSI(st()[`ch${n}offset`], 'V'),
      push: () => simple([`:CHANnel${n}:OFFSet 0`]), pushHint: 'center',
    }),
  );
}

export function initPanel(el, actions) {
  const runBtn = h('button.pbtn.runstop', { title: 'Space', onclick: () => toggleRun() }, 'RUN / STOP');
  const sweepBtn = h('button.pbtn', {
    title: 'Trigger mode: Auto always draws, Normal waits for a trigger, Single captures once',
    onclick: () => {
      const order = ['AUTO', 'NORMal', 'SINGle'];
      const cur = String(st().sweep || 'AUTO').slice(0, 4).toUpperCase();
      const i = order.findIndex((o) => o.slice(0, 4).toUpperCase() === cur);
      simple([`:TRIGger:SWEep ${order[(i + 1) % order.length]}`]);
    },
  }, 'MODE');
  knobs.push(() => {
    const s = String(st().run || '').toUpperCase();
    runBtn.classList.toggle('running', s && s !== 'STOP');
    runBtn.classList.toggle('stopped', s === 'STOP');
    const sw = String(st().sweep || '').toUpperCase();
    sweepBtn.textContent = `MODE: ${sw.startsWith('NORM') ? 'Normal' : sw.startsWith('SING') ? 'Single' : 'Auto'}`;
  });

  el.replaceChildren(
    h('div.psec',
      h('div.prow.big',
        runBtn,
        h('button.pbtn.single', { title: 'S', onclick: () => simple([':SINGle'], 'Armed: waiting for one trigger') }, 'SINGLE'),
      ),
      h('div.prow',
        h('button.pbtn.auto', { title: 'A: let the scope pick settings for whatever is connected', onclick: () => simple([':AUToscale', '@wait 1500'], 'Auto-scaled') }, 'AUTO'),
        h('button.pbtn', { title: 'C: wipe traces (and persistence)', onclick: () => simple([':CLEar']) }, 'CLEAR'),
        h('button.pbtn.danger', {
          title: 'Reset the scope to factory default settings',
          onclick: () => {
            if (window.confirm('Reset the scope to its factory default settings?')) simple(['*RST', '@wait 2500'], 'Scope reset to defaults');
          },
        }, 'Default'),
      ),
    ),
    h('div.psec',
      h('div.ptitle', 'Menus'),
      h('div.pgrid3', ...['measure', 'acquire', 'storage', 'cursor', 'display', 'utility'].map((id) =>
        sheetBtn(id[0].toUpperCase() + id.slice(1), id))),
    ),
    h('div.psec',
      h('div.ptitle', 'Vertical'),
      h('div.chans', chanBlock(1), chanBlock(2)),
      h('div.pgrid3',
        sheetBtn('MATH', 'math', '.mathbtn'),
        sheetBtn('REF', 'ref', '.refbtn'),
        sheetBtn('Decode', 'decode', '.decbtn'),
      ),
    ),
    h('div.psec',
      h('div.ptitle', 'Horizontal'),
      h('div.chans',
        knob({ label: 'Time / div', step: hscaleStep, tips: ['Zoom out (more time on screen)', 'Zoom in (less time on screen)'], text: () => fmtSI(st().tbscale, 's/div') }),
        knob({
          label: 'Position', step: hposStep, arrows: ['◀', '▶'], tips: ['Move trace left', 'Move trace right'],
          text: () => fmtSI(st().tboffset, 's'), push: () => simple([':TIMebase:MAIN:OFFSet 0']), pushHint: 'center',
        }),
      ),
      h('div.prow', sheetBtn('Horizontal menu', 'horiz')),
    ),
    h('div.psec',
      h('div.ptitle', 'Trigger'),
      h('div.chans',
        knob({
          label: 'Level', color: 'var(--trig)', step: levelStep, arrows: ['▼', '▲'], tips: ['Lower the trigger level', 'Raise the trigger level'],
          text: () => fmtSI(st().triglevel, 'V'), push: level50, pushHint: 'set to 50%',
        }),
        h('div.trig-btns',
          sheetBtn('Trigger menu', 'trigger'),
          sweepBtn,
          h('button.pbtn', { title: 'F: fire one trigger now', onclick: () => simple([':TFORce']) }, 'FORCE'),
        ),
      ),
    ),
  );

  onChange((what) => {
    if (what === 'state' || what === 'conn') for (const k of knobs) k();
  });
  for (const k of knobs) k();

  // Keyboard: the same keys work anywhere except while typing in a field.
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!core.connected) return;
    const map = {
      ' ': () => toggleRun(),
      s: () => simple([':SINGle'], 'Armed: waiting for one trigger'),
      a: () => simple([':AUToscale', '@wait 1500'], 'Auto-scaled'),
      c: () => simple([':CLEar']),
      f: () => simple([':TFORce']),
      p: () => actions.saveScreenshot(),
    };
    const fn = map[e.key.toLowerCase()];
    if (fn) {
      e.preventDefault();
      fn();
    }
  });
}

function toggleRun() {
  const stopped = String(st().run || '').toUpperCase() === 'STOP';
  patchState({ run: stopped ? 'RUN' : 'STOP' });
  simple([stopped ? ':RUN' : ':STOP']);
}
