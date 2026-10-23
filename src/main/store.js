// Tiny JSON settings file in the app's userData folder.

'use strict';

const fs = require('fs');
const path = require('path');

let filePath = null;
let data = {};

function init(dir) {
  filePath = path.join(dir, 'settings.json');
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    data = {};
  }
}

function get(key, dflt) {
  return key in data ? data[key] : dflt;
}

function set(key, value) {
  data[key] = value;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
  return true;
}

module.exports = { init, get, set, file: () => filePath };
