// Small helpers shared by the page: DOM building, SI units, 1-2-5 steps.

// h('div.card#id', {onclick}, child, child...)
export function h(tag, attrs, ...kids) {
  const m = tag.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    kids.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

const PREFIXES = [
  [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''],
  [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'],
];

// The scope answers 9.9E37 when it cannot make a measurement.
export function isInvalid(v) {
  return v === null || v === undefined || Number.isNaN(v) || Math.abs(v) >= 9e37;
}

export function fmtSI(v, unit = '', digits = 3) {
  if (typeof v === 'string') v = parseFloat(v);
  if (isInvalid(v)) return '--';
  if (v === 0) return `0 ${unit}`.trim();
  const a = Math.abs(v);
  for (const [f, p] of PREFIXES) {
    if (a >= f * 0.9995) {
      const n = v / f;
      return `${trimNum(n.toPrecision(digits))} ${p}${unit}`.trim();
    }
  }
  return `${v.toExponential(2)} ${unit}`.trim();
}

function trimNum(s) {
  return s.includes('e') ? s : s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

// Parse "10m", "2.5 k", "100us", "1e-3", "3.3V" into a number.
export function parseSI(text) {
  const s = String(text).trim().replace(/\s+/g, '').replace(/u/g, 'µ');
  const m = s.match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)([TGMkmµnp]?)/i);
  if (!m) return NaN;
  let n = parseFloat(m[1]);
  const p = m[2];
  const table = { T: 1e12, G: 1e9, M: 1e6, k: 1e3, K: 1e3, m: 1e-3, 'µ': 1e-6, n: 1e-9, p: 1e-12 };
  if (p) n *= table[p];
  return n;
}

// 1-2-5 ladder between lo and hi inclusive.
export function ladder125(lo, hi) {
  const out = [];
  for (let e = -12; e <= 12; e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= lo * 0.999 && v <= hi * 1.001) out.push(Number(v.toPrecision(3)));
    }
  }
  return out;
}

// Step dir (+1/-1) along the ladder from the value nearest cur.
export function stepLadder(list, cur, dir) {
  let i = 0;
  let best = Infinity;
  list.forEach((v, j) => {
    const d = Math.abs(Math.log(v) - Math.log(Math.abs(cur) || list[0]));
    if (d < best) { best = d; i = j; }
  });
  return list[Math.max(0, Math.min(list.length - 1, i + dir))];
}

// Smallest 1-2-5 value that is >= target.
export function ceil125(target) {
  for (const v of ladder125(1e-9, 1e3)) if (v >= target * 0.999) return v;
  return 1e3;
}

// SCPI short form: the capital letters and digits of the long form.
// "CHANnel1" -> "CHAN1", "POSitive" -> "POS", "20M" -> "20M".
export function shortForm(s) {
  return String(s).replace(/[a-z]/g, '');
}

// Does the scope's reply match this option value?
export function sameValue(reply, option) {
  if (reply === undefined || reply === null) return false;
  const r = String(reply).trim().toUpperCase().replace(/^"|"$/g, '');
  const o = String(option);
  if (r === o.toUpperCase() || r === shortForm(o).toUpperCase()) return true;
  const rn = parseFloat(r);
  const on = parseFloat(o);
  if (!Number.isNaN(rn) && !Number.isNaN(on) && /^[-+\d.e]+$/i.test(r) && /^[-+\d.e]+$/i.test(o)) {
    return Math.abs(rn - on) <= Math.abs(on) * 1e-6 + 1e-15;
  }
  return false;
}

export function truthy(reply) {
  const r = String(reply).trim().toUpperCase();
  return r === '1' || r === 'ON';
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let toastTimer = null;
export function toast(msg, kind = 'info', ms = 3500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), ms);
}
