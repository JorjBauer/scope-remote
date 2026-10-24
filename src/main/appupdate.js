// App update check. Asks GitHub for this repo's newest published release
// and compares its tag with the running version. It only tells the user;
// the builds are unsigned zips, so there's nothing it could install. The
// badge it lights opens the release page in the browser.

'use strict';

const pkg = require('../../package.json');

// "https://github.com/JorjBauer/scope-remote" (or git+https, or .git) ->
// { owner, repo }.
function repoOf(p = pkg) {
  const url = typeof p.repository === 'string' ? p.repository : (p.repository && p.repository.url) || '';
  const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/) || url.match(/^github:([^/]+)\/([^/.]+)$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

// "v1.2.3" or "1.2.3" -> [1, 2, 3]. Anything after the numbers is ignored;
// /releases/latest never returns a prerelease anyway.
function parseVersion(s) {
  const m = String(s || '').match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compare(installed, latest) {
  const a = parseVersion(installed);
  const b = parseVersion(latest);
  if (!a || !b) return 'unknown';
  for (let i = 0; i < 3; i++) {
    if (b[i] !== a[i]) return b[i] > a[i] ? 'newer' : 'current';
  }
  return 'current';
}

// The release pages this app will open, and nothing else.
function isReleasePage(url, r = repoOf()) {
  return !!r && String(url).startsWith(`https://github.com/${r.owner}/${r.repo}/releases/`);
}

async function checkAppUpdate(installed, fetchImpl = fetch) {
  const r = repoOf();
  if (!r) throw new Error('package.json has no GitHub repository');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${r.owner}/${r.repo}/releases/latest`, {
      signal: ctl.signal,
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ScopeRemote' },
    });
    if (res.status === 404) throw new Error('no releases on GitHub yet');
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const rel = await res.json();
    const latest = String(rel.tag_name || '').replace(/^v/, '');
    const page = isReleasePage(rel.html_url, r) ? rel.html_url : `https://github.com/${r.owner}/${r.repo}/releases/latest`;
    return { latest, installed, status: compare(installed, latest), page, checked: Date.now() };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { checkAppUpdate, compare, parseVersion, repoOf, isReleasePage };
