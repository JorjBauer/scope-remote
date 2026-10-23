// Renders a menu sheet from menus.js and keeps it in sync with the scope.

import { h, fmtSI, parseSI, sameValue, shortForm, truthy, toast } from './util.js';
import { core, run, poll } from './core.js';
import { SHEETS } from './menus.js';

let host = null;
let ctx = null;
let current = null; // { sheet, values }
let loadSeq = 0;
let consoleLog = null;

export function initSheet(el, actionCtx) {
  host = el;
  ctx = actionCtx;
  renderEmpty();
}

export function currentSheet() {
  return current ? current.sheet.id : null;
}

function renderEmpty() {
  host.replaceChildren(
    h('div.sheet-empty',
      h('div.big', 'Pick a button'),
      h('p', 'Every button on the panel opens its menu here, with the same choices as the scope\'s own soft keys but in plain words.'),
      h('p', 'Or open ', h('b', 'Shortcuts'), ' (top left) for ready-made setups like "decode UART" or "measure ripple".'),
    ),
  );
}

export async function openSheet(id) {
  const sheet = SHEETS[id];
  if (!sheet) return;
  if (current && current.sheet.id === id) {
    closeSheet();
    return;
  }
  current = { sheet, values: {} };
  for (const it of sheet.items) if (it.local) current.values[it.key] = it.dflt;
  document.querySelectorAll('[data-sheet]').forEach((b) => b.classList.toggle('active', b.dataset.sheet === id));
  render();
  await reload();
}

export function closeSheet() {
  current = null;
  document.querySelectorAll('[data-sheet]').forEach((b) => b.classList.remove('active'));
  renderEmpty();
}

export async function reload() {
  if (!current || !core.connected) return;
  const seq = ++loadSeq;
  const items = current.sheet.items.filter((it) => it.get);
  try {
    const r = await run(items.map((it) => it.get), { checkErrors: false });
    if (seq !== loadSeq || !current) return;
    items.forEach((it, i) => (current.values[it.key] = normalize(it, r.results[i])));
    render();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function normalize(it, reply) {
  if (reply === null || reply === undefined) return undefined;
  if (it.kind === 'toggle') return truthy(reply);
  if (it.kind === 'select') {
    const o = it.options.find(([v]) => sameValue(reply, v));
    return o ? shortForm(o[0]).toUpperCase() : String(reply).toUpperCase();
  }
  if (it.kind === 'number' || it.kind === 'slider') return parseFloat(reply);
  return reply;
}

async function apply(it, value) {
  try {
    const cmds = [].concat(it.set(value));
    const r = await run(cmds);
    if (r.errors.length) toast(`Scope said: ${r.errors.join('; ')}`, 'error', 6000);
  } catch (e) {
    toast(e.message, 'error');
  }
  await reload();
  poll().catch(() => {});
}

async function doAction(it) {
  try {
    const out = await it.run(current.values, ctx);
    if (Array.isArray(out)) {
      const r = await run(out);
      if (r.errors.length) toast(`Scope said: ${r.errors.join('; ')}`, 'error', 6000);
      else toast(`Done: ${it.label}`, 'ok');
    }
  } catch (e) {
    toast(e.message, 'error');
  }
  await reload();
  poll().catch(() => {});
}

function render() {
  if (!current) return;
  const { sheet, values } = current;
  const rows = [];
  for (const it of sheet.items) {
    if (it.showIf && !it.showIf(values)) continue;
    rows.push(renderItem(it, values));
  }
  host.replaceChildren(
    h('div.sheet',
      h('div.sheet-head', { style: { borderColor: sheet.color } },
        h('div.sheet-title', sheet.title),
        h('button.icon', { title: 'Close', onclick: closeSheet }, '×'),
      ),
      h('p.sheet-intro', sheet.intro),
      core.connected ? null : h('p.warn', 'Not connected: values below are blank until you connect.'),
      rows,
    ),
  );
}

function row(it, control) {
  return h('div.row',
    h('label.row-label', it.label),
    h('div.row-ctl', control),
    it.help ? h('div.row-help', it.help) : null,
  );
}

function renderItem(it, values) {
  const v = values[it.key];
  switch (it.kind) {
    case 'select': {
      const s = h('select', {
        onchange: (e) => {
          const val = e.target.value;
          if (it.local) {
            values[it.key] = val;
            render();
          } else {
            values[it.key] = shortForm(val).toUpperCase();
            apply(it, val);
          }
        },
      });
      let matched = false;
      for (const [val, label] of it.options) {
        const isSel = it.local ? v === val : v !== undefined && shortForm(val).toUpperCase() === v;
        matched ||= isSel;
        s.append(h('option', { value: val, selected: isSel }, label));
      }
      if (!matched) s.prepend(h('option', { value: '', selected: true, disabled: true }, v === undefined ? '...' : String(v)));
      return row(it, s);
    }
    case 'toggle': {
      const b = h('button.toggle', {
        className: `toggle ${v ? 'on' : ''}`,
        onclick: () => {
          values[it.key] = !v;
          render();
          apply(it, !v);
        },
      }, h('span.sw'), h('span.txt', v === undefined ? '...' : v ? 'On' : 'Off'));
      return row(it, b);
    }
    case 'number': {
      const shown = v === undefined || Number.isNaN(v) ? '' : fmtSI(v, it.unit, 4);
      const inp = h('input.num', {
        type: 'text',
        value: shown,
        placeholder: it.unit,
        spellcheck: false,
        onkeydown: (e) => {
          if (e.key === 'Enter') e.target.blur();
          if (e.key === 'Escape') {
            e.target.value = shown;
            e.target.blur();
          }
        },
        onchange: (e) => {
          const n = parseSI(e.target.value);
          if (Number.isNaN(n)) {
            toast(`"${e.target.value}" is not a number. Try 10m, 2.5k, 100u.`, 'error');
            e.target.value = shown;
            return;
          }
          values[it.key] = n;
          apply(it, n);
        },
      });
      return row(it, inp);
    }
    case 'slider': {
      const out = h('span.slider-val', v === undefined ? '' : String(Math.round(v)));
      const inp = h('input', {
        type: 'range', min: it.min, max: it.max, value: v ?? it.min,
        oninput: (e) => (out.textContent = e.target.value),
        onchange: (e) => apply(it, Number(e.target.value)),
      });
      return row(it, h('div.slider', inp, out));
    }
    case 'readout': {
      let text = v === undefined ? '...' : String(v);
      if (it.unit && v !== undefined && !Number.isNaN(parseFloat(v))) text = fmtSI(parseFloat(v), it.unit, 5);
      return row(it, h('span.readout', text, h('button.icon.small', { title: 'Refresh', onclick: reload }, '↻')));
    }
    case 'action':
      return h('div.row.action-row',
        h('button.action', { className: `action ${it.danger ? 'danger' : ''}`, onclick: () => doAction(it) }, it.label),
        it.help ? h('div.row-help', it.help) : null,
      );
    case 'note':
      return h('p.note', it.text);
    case 'console':
      return renderConsole();
    default:
      return null;
  }
}

// Raw SCPI console: type any command, see the answer.
const history = [];
let histPos = 0;

function renderConsole() {
  if (!consoleLog) consoleLog = h('div.console-log');
  const inp = h('input.console-in', {
    type: 'text',
    placeholder: ':CHANnel1:SCALe?   (Enter to send, Up for history)',
    spellcheck: false,
    onkeydown: async (e) => {
      if (e.key === 'ArrowUp' && history.length) {
        histPos = Math.max(0, histPos - 1);
        e.target.value = history[histPos];
        e.preventDefault();
      } else if (e.key === 'ArrowDown' && history.length) {
        histPos = Math.min(history.length, histPos + 1);
        e.target.value = history[histPos] || '';
        e.preventDefault();
      } else if (e.key === 'Enter') {
        const cmd = e.target.value.trim();
        if (!cmd) return;
        history.push(cmd);
        histPos = history.length;
        e.target.value = '';
        logLine('out', cmd);
        try {
          const r = await run([cmd]);
          if (r.results[0] !== null && r.results[0] !== undefined) logLine('in', r.results[0]);
          for (const err of r.errors) logLine('err', err);
          if (!r.errors.length && r.results[0] === null) logLine('ok', 'ok');
        } catch (err) {
          logLine('err', err.message);
        }
      }
    },
  });
  return h('div.console',
    h('div.row-label', 'SCPI console'),
    consoleLog,
    inp,
    h('div.row-help', 'Commands are listed in the DS1000Z-E Programming Guide. A query ends in "?". Tip: a query the scope does not understand gets no answer, so the app waits a few seconds and reconnects.'),
  );
}

function logLine(kind, text) {
  consoleLog.append(h(`div.log-${kind}`, (kind === 'out' ? '> ' : '') + text));
  consoleLog.scrollTop = consoleLog.scrollHeight;
}
