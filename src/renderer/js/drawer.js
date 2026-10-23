// The Shortcuts drawer: built-in recipes, favorites, and setups the user
// saved from the scope itself.

import { h, toast, parseSI } from './util.js';
import { core, run, poll } from './core.js';
import { RECIPES } from './shortcuts.js';
import { reload as reloadSheet } from './sheet.js';

let root = null;
let listEl = null;
let filter = '';
let openId = null;
let lastParams = {};
let favorites = [];
let mySetups = [];
const results = {}; // recipe id -> { ok, errors }

export async function initDrawer(el) {
  root = el;
  lastParams = await window.appStore.get('recipeParams', {});
  favorites = await window.appStore.get('favorites', []);
  mySetups = await window.appStore.get('mySetups', []);
  listEl = h('div.drawer-list');
  root.replaceChildren(
    h('div.drawer-head',
      h('div.drawer-title', 'Shortcuts'),
      h('button.icon', { title: 'Close (Esc)', onclick: closeDrawer }, '×'),
    ),
    h('input.search', {
      type: 'search',
      placeholder: 'Search: uart, ripple, glitch...',
      oninput: (e) => {
        filter = e.target.value.toLowerCase();
        render();
      },
    }),
    listEl,
  );
  render();
}

export function openDrawer() {
  document.body.classList.add('drawer-open');
  root.querySelector('.search').focus();
}

export function closeDrawer() {
  document.body.classList.remove('drawer-open');
}

export function toggleDrawer() {
  if (document.body.classList.contains('drawer-open')) closeDrawer();
  else openDrawer();
}

function matches(r) {
  if (!filter) return true;
  return `${r.title} ${r.summary} ${r.group}`.toLowerCase().includes(filter);
}

function render() {
  const kids = [];

  const mine = mySetups.filter((s) => !filter || `${s.name} ${s.notes || ''}`.toLowerCase().includes(filter));
  kids.push(h('div.group-title', 'My saved setups'));
  kids.push(h('div.mysave',
    h('button.action', { onclick: saveSetupShortcut }, '+ Save what the scope is doing now'),
    h('div.row-help', 'Stores every setting on the scope under a name, so you can get back to it with one click.'),
  ));
  for (const s of mine) kids.push(mySetupCard(s));

  const favs = RECIPES.filter((r) => favorites.includes(r.id) && matches(r));
  if (favs.length) {
    kids.push(h('div.group-title', 'Favorites'));
    for (const r of favs) kids.push(recipeCard(r));
  }

  let group = null;
  for (const r of RECIPES) {
    if (!matches(r)) continue;
    if (r.group !== group) {
      group = r.group;
      kids.push(h('div.group-title', group));
    }
    kids.push(recipeCard(r));
  }
  listEl.replaceChildren(...kids);
}

function paramsFor(r) {
  const saved = lastParams[r.id] || {};
  const p = {};
  for (const prm of r.params) p[prm.key] = saved[prm.key] ?? prm.dflt;
  return p;
}

function resolved(r, p) {
  // Number fields accept "100n", "2.5k" and so on.
  const out = { ...p };
  for (const prm of r.params) {
    if (prm.type === 'number') {
      const n = parseSI(p[prm.key]);
      out[prm.key] = Number.isNaN(n) ? prm.dflt : String(n);
    }
  }
  return out;
}

function recipeCard(r) {
  const open = openId === r.id;
  const fav = favorites.includes(r.id);
  const head = h('div.card-head', {
    onclick: () => {
      openId = open ? null : r.id;
      render();
    },
  },
  h('div.card-title', r.title),
  h('button.star', {
    className: `star ${fav ? 'on' : ''}`,
    title: fav ? 'Remove from favorites' : 'Add to favorites',
    onclick: (e) => {
      e.stopPropagation();
      favorites = fav ? favorites.filter((f) => f !== r.id) : [...favorites, r.id];
      window.appStore.set('favorites', favorites);
      render();
    },
  }, fav ? '★' : '☆'));

  if (!open) return h('div.card', head, h('div.card-sum', r.summary));

  const p = paramsFor(r);
  const pre = h('pre.cmds');
  const updatePre = () => {
    try {
      pre.textContent = r.build(resolved(r, p), { probe: core.settings.probe }).join('\n');
    } catch (e) {
      pre.textContent = `(${e.message})`;
    }
  };
  const fields = r.params.map((prm) => {
    let ctl;
    const onchange = (e) => {
      p[prm.key] = e.target.value;
      lastParams[r.id] = { ...p };
      window.appStore.set('recipeParams', lastParams);
      updatePre();
    };
    if (prm.type === 'select') {
      ctl = h('select', { onchange }, prm.options.map(([v, l]) => h('option', { value: v, selected: String(p[prm.key]) === v }, l)));
    } else {
      ctl = h('input.num', { type: 'text', value: p[prm.key], placeholder: prm.unit || '', oninput: onchange, spellcheck: false });
    }
    return h('label.field', h('span', prm.label + (prm.unit ? ` (${prm.unit})` : '')), ctl);
  });
  updatePre();

  const res = results[r.id];
  return h('div.card.open',
    head,
    h('div.card-sum', r.summary),
    fields.length ? h('div.fields', fields) : null,
    h('div.card-actions',
      h('button.apply', { onclick: () => apply(r, p) }, 'Apply to scope'),
      h('details.cmd-peek', h('summary', 'Show the commands'), pre),
    ),
    res ? h('div.result', { className: `result ${res.errors.length ? 'bad' : 'good'}` },
      res.errors.length ? `Applied, but the scope objected: ${res.errors.join('; ')}` : 'Applied.') : null,
    h('div.look', h('b', 'What to look at: '), r.look),
  );
}

async function apply(r, p) {
  if (!core.connected) {
    toast('Connect to the scope first.', 'error');
    return;
  }
  if (r.confirm && !window.confirm(r.confirm)) return;
  try {
    const cmds = r.build(resolved(r, p), { probe: core.settings.probe });
    const out = await run(cmds);
    results[r.id] = out;
    if (out.errors.length) toast(`${r.title}: scope reported ${out.errors.length} problem(s)`, 'error', 6000);
    else toast(`${r.title}: done`, 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
  render();
  poll().catch(() => {});
  reloadSheet();
}

function mySetupCard(s) {
  return h('div.card.mine',
    h('div.card-head',
      h('div.card-title', s.name),
      h('button.icon.small', {
        title: 'Delete',
        onclick: async () => {
          if (!window.confirm(`Delete the saved setup "${s.name}"?`)) return;
          mySetups = mySetups.filter((x) => x !== s);
          await window.appStore.set('mySetups', mySetups);
          render();
        },
      }, '✕'),
    ),
    s.notes ? h('div.card-sum', s.notes) : null,
    h('div.card-actions',
      h('button.apply', {
        onclick: async () => {
          if (!core.connected) return toast('Connect to the scope first.', 'error');
          try {
            await window.scope.putSetup(s.blob);
            toast(`Restored "${s.name}"`, 'ok');
          } catch (e) {
            toast(e.message, 'error');
          }
          setTimeout(() => {
            poll().catch(() => {});
            reloadSheet();
          }, 800);
        },
      }, 'Restore'),
      h('span.when', new Date(s.saved).toLocaleString()),
    ),
  );
}

// Ask for a name inline (window.prompt does not exist in Electron).
export function saveSetupShortcut() {
  if (!core.connected) {
    toast('Connect to the scope first.', 'error');
    return;
  }
  openDrawer();
  const name = h('input.num', { type: 'text', placeholder: 'Name, e.g. "Bench supply ripple"' });
  const notes = h('input.num', { type: 'text', placeholder: 'Notes (optional): probe on TP3, ground at J2' });
  const box = h('div.card.open.saving',
    h('div.card-title', 'Save current scope setup'),
    h('div.fields', h('label.field', h('span', 'Name'), name), h('label.field', h('span', 'Notes'), notes)),
    h('div.card-actions',
      h('button.apply', {
        onclick: async () => {
          const n = name.value.trim();
          if (!n) return name.focus();
          try {
            const blob = await window.scope.getSetup();
            mySetups = [{ name: n, notes: notes.value.trim(), blob, saved: Date.now() }, ...mySetups];
            await window.appStore.set('mySetups', mySetups);
            toast(`Saved "${n}"`, 'ok');
          } catch (e) {
            toast(e.message, 'error');
          }
          render();
        },
      }, 'Save'),
      h('button.action', { onclick: render }, 'Cancel'),
    ),
  );
  const anchor = listEl.querySelector('.mysave');
  anchor.after(box);
  name.focus();
}
