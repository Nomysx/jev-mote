// The small bridge the page gets in the desktop app (see client/src/desktop.ts). Nothing else from
// Electron or Node is exposed to the page.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('moteDesktop', {
  mode: new URLSearchParams(window.location.search).get('mode') === 'widget' ? 'widget' : 'app',
  platform: process.platform,
  openApp: () => ipcRenderer.send('mote:open', 'app'),
  openWidget: () => ipcRenderer.send('mote:open', 'widget'),
  hide: () => ipcRenderer.send('mote:hide'),
  getPrefs: () => ipcRenderer.invoke('mote:prefs'),
  setPref: (key: string, value: boolean) => ipcRenderer.invoke('mote:set-pref', key, value),
});
