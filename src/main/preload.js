// The only bridge between the page and the main process.

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function on(channel) {
  return (fn) => {
    const h = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  };
}

contextBridge.exposeInMainWorld('scope', {
  connect: (host, port) => ipcRenderer.invoke('scope:connect', host, port),
  find: () => ipcRenderer.invoke('scope:find'),
  disconnect: () => ipcRenderer.invoke('scope:disconnect'),
  status: () => ipcRenderer.invoke('scope:status'),
  run: (cmds, opts) => ipcRenderer.invoke('scope:run', cmds, opts),
  screen: (format) => ipcRenderer.invoke('scope:screen', format),
  saveScreenshot: (format) => ipcRenderer.invoke('scope:saveScreenshot', format),
  exportCsv: (sources) => ipcRenderer.invoke('scope:exportCsv', sources),
  getSetup: () => ipcRenderer.invoke('scope:getSetup'),
  putSetup: (b64) => ipcRenderer.invoke('scope:putSetup', b64),
  launchHost: () => ipcRenderer.invoke('app:launchHost'),
  checkFirmware: (fw) => ipcRenderer.invoke('fw:check', fw),
  openFirmwarePage: () => ipcRenderer.invoke('fw:openPage'),
  onState: on('scope:state'),
  onTraffic: on('scope:traffic'),
  onNotice: on('scope:notice'),
});

contextBridge.exposeInMainWorld('appStore', {
  get: (key, dflt) => ipcRenderer.invoke('store:get', key, dflt),
  set: (key, value) => ipcRenderer.invoke('store:set', key, value),
  path: () => ipcRenderer.invoke('store:path'),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
});
