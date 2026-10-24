// The app update check, against a fake GitHub. Nothing here goes online.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const up = require('../src/main/appupdate');

test('versions compare numerically, with or without the v', () => {
  assert.strictEqual(up.compare('0.1.0', 'v0.2.0'), 'newer');
  assert.strictEqual(up.compare('0.9.0', '0.10.0'), 'newer');
  assert.strictEqual(up.compare('1.0.0', 'v1.0.0'), 'current');
  assert.strictEqual(up.compare('1.2.0', '1.1.9'), 'current', 'running something newer than the release');
  assert.strictEqual(up.compare('1.0.0', 'nightly'), 'unknown');
});

test('repository field gives owner and repo', () => {
  assert.deepStrictEqual(up.repoOf(), { owner: 'JorjBauer', repo: 'scope-remote' });
  assert.deepStrictEqual(up.repoOf({ repository: 'github:a/b' }), { owner: 'a', repo: 'b' });
  assert.deepStrictEqual(up.repoOf({ repository: { url: 'git+https://github.com/a/b.git' } }), { owner: 'a', repo: 'b' });
  assert.strictEqual(up.repoOf({}), null);
});

test('only this repo\'s release pages may be opened', () => {
  assert.ok(up.isReleasePage('https://github.com/JorjBauer/scope-remote/releases/tag/v0.2.0'));
  assert.ok(!up.isReleasePage('https://github.com/someone/else/releases/tag/v0.2.0'));
  assert.ok(!up.isReleasePage('https://evil.example/JorjBauer/scope-remote/releases/'));
});

function fakeFetch(status, body) {
  return async (url) => {
    assert.strictEqual(url, 'https://api.github.com/repos/JorjBauer/scope-remote/releases/latest');
    return { ok: status < 400, status, json: async () => body };
  };
}

test('a newer release lights up, with its page', async () => {
  const page = 'https://github.com/JorjBauer/scope-remote/releases/tag/v0.2.0';
  const r = await up.checkAppUpdate('0.1.0', fakeFetch(200, { tag_name: 'v0.2.0', html_url: page }));
  assert.strictEqual(r.status, 'newer');
  assert.strictEqual(r.latest, '0.2.0');
  assert.strictEqual(r.page, page);
});

test('a page link elsewhere is replaced with the releases page', async () => {
  const r = await up.checkAppUpdate('0.1.0', fakeFetch(200, { tag_name: 'v0.2.0', html_url: 'https://evil.example/' }));
  assert.strictEqual(r.page, 'https://github.com/JorjBauer/scope-remote/releases/latest');
});

test('no releases yet, or GitHub trouble, is an error', async () => {
  await assert.rejects(up.checkAppUpdate('0.1.0', fakeFetch(404, {})), /no releases/);
  await assert.rejects(up.checkAppUpdate('0.1.0', fakeFetch(403, {})), /403/);
});
