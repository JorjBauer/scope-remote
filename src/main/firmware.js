// Firmware update check. Rigol North America keeps a table of the newest
// firmware per product family; the DS1202Z-E is in the "DS1000Z-E" row.
// Besides the app update check (appupdate.js), this is the app's only trip
// to the internet, and it only reads that page.

'use strict';

const FIRMWARE_PAGE = 'https://www.rigolna.com/firmware/';
const FAMILY = 'DS1000Z-E';

// Pull "v6.04" out of the row whose first cell is exactly the family name.
// (The DS1000Z row sits right above it, so an exact match matters.)
function parseLatest(html, family = FAMILY) {
  const cells = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .split(/<\/?t[dh][^>]*>/i)
    .map((c) => c.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== family) continue;
    for (let j = i + 1; j < Math.min(i + 4, cells.length); j++) {
      const m = cells[j].match(/^v?(\d+)\.(\d+)/i);
      if (m) return { major: Number(m[1]), minor: Number(m[2]), label: `v${m[1]}.${m[2]}` };
    }
  }
  return null;
}

// "00.06.03" or "00.06.03.SP2" from *IDN? -> { major: 6, minor: 3 }.
function parseInstalled(fw) {
  const m = String(fw || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: Number(m[2]), minor: Number(m[3]), label: m[0] };
}

function compare(installed, latest) {
  if (!installed || !latest) return 'unknown';
  if (latest.major !== installed.major) return latest.major > installed.major ? 'newer' : 'current';
  if (latest.minor > installed.minor) return 'newer';
  return 'current';
}

async function checkFirmware(fwString, fetchImpl = fetch) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetchImpl(FIRMWARE_PAGE, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 ScopeRemote' } });
    if (!res.ok) throw new Error(`Rigol firmware page answered ${res.status}`);
    const latest = parseLatest(await res.text());
    if (!latest) throw new Error(`could not find ${FAMILY} on Rigol's firmware page`);
    const installed = parseInstalled(fwString);
    return { latest: latest.label, installed: installed ? installed.label : fwString, status: compare(installed, latest), page: FIRMWARE_PAGE, checked: Date.now() };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { checkFirmware, parseLatest, parseInstalled, compare, FIRMWARE_PAGE };
