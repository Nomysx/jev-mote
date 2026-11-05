// Mote on the desktop. Runs everything Mote needs in one app: its journal, its life (it keeps
// thinking, sleeping and dreaming while the window is closed) and, if you don't have Ollama, its own
// engine. Mote lives in the tray, and shows either as a normal window or as a small widget on your
// desktop. Data lives in the app's user-data folder; nothing leaves this computer.

import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell, Tray, type Rectangle } from 'electron';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Mode = 'app' | 'widget';

interface Prefs {
  onTop: boolean;
  autostart: boolean;
  widgetFirst: boolean;
  appBounds?: Rectangle;
  widgetBounds?: Rectangle;
  trayHintShown?: boolean;
}

const here = path.dirname(fileURLToPath(import.meta.url)); // dist/desktop
const root = app.isPackaged ? app.getAppPath() : path.resolve(here, '..', '..');
const dataDir = app.getPath('userData');
const prefsFile = path.join(dataDir, 'desktop.json');
const logFile = path.join(dataDir, 'mote.log');
const startHidden = process.argv.includes('--hidden');

let prefs: Prefs = { onTop: true, autostart: false, widgetFirst: false };
let url = '';
let win: BrowserWindow | null = null;
let mode: Mode = 'app';
let tray: Tray | null = null;
let quitting = false;
let closeMote: (() => Promise<void>) | null = null;

function log(msg: string) {
  console.log(msg);
  try {
    appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* fine */
  }
}

function loadPrefs() {
  try {
    prefs = { ...prefs, ...(JSON.parse(readFileSync(prefsFile, 'utf8')) as Partial<Prefs>) };
  } catch {
    /* first run */
  }
}

function savePrefs() {
  try {
    writeFileSync(prefsFile, JSON.stringify(prefs, null, 2));
  } catch {
    /* fine */
  }
}

function icon(name: string) {
  return nativeImage.createFromPath(path.join(root, 'build', name));
}

/** Start with your computer: Windows and macOS through the OS; Linux through an autostart file. */
function applyAutostart() {
  if (process.platform === 'linux') {
    const dir = path.join(os.homedir(), '.config', 'autostart');
    const file = path.join(dir, 'mote.desktop');
    if (prefs.autostart && process.env.APPIMAGE) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Mote\nExec="${process.env.APPIMAGE}" --hidden\nX-GNOME-Autostart-enabled=true\n`);
    } else if (!prefs.autostart && existsSync(file)) rmSync(file);
    return;
  }
  app.setLoginItemSettings({ openAtLogin: prefs.autostart, args: ['--hidden'] });
}

function widgetBounds(): Rectangle {
  const wa = screen.getPrimaryDisplay().workArea;
  const b = prefs.widgetBounds;
  const visible = b && screen.getAllDisplays().some((d) => b.x >= d.workArea.x - 50 && b.y >= d.workArea.y - 50 && b.x < d.workArea.x + d.workArea.width && b.y < d.workArea.y + d.workArea.height);
  if (b && visible) return b;
  const width = 300;
  const height = 400;
  return { x: wa.x + wa.width - width - 24, y: wa.y + wa.height - height - 24, width, height };
}

function open(next: Mode) {
  if (win && !win.isDestroyed() && mode === next) {
    win.show();
    win.focus();
    return;
  }
  const old = win;
  mode = next;
  const common = {
    show: false,
    title: 'Mote',
    icon: icon('icon.png'),
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, spellcheck: true },
  };
  win =
    next === 'widget'
      ? new BrowserWindow({
          ...common,
          ...widgetBounds(),
          minWidth: 220,
          minHeight: 280,
          frame: false,
          transparent: true,
          backgroundColor: '#00000000',
          hasShadow: false,
          skipTaskbar: true,
          resizable: true,
          maximizable: false,
          fullscreenable: false,
          alwaysOnTop: prefs.onTop,
        })
      : new BrowserWindow({
          ...common,
          ...(prefs.appBounds ?? { width: 1100, height: 760 }),
          minWidth: 380,
          minHeight: 520,
          backgroundColor: '#16141d',
          autoHideMenuBar: true,
        });
  const w = win;
  if (next === 'widget' && prefs.onTop) w.setAlwaysOnTop(true, 'floating');
  w.removeMenu();
  w.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//.test(target) && !target.startsWith(url)) void shell.openExternal(target);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, target) => {
    if (!target.startsWith(url)) e.preventDefault();
  });
  // Page errors go to mote.log (helps when something looks wrong on a particular computer).
  w.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') log(`[page] ${e.level}: ${e.message}`);
  });
  w.webContents.on('render-process-gone', (_e, d) => log(`[page] renderer stopped: ${d.reason}`));
  let saveTimer: NodeJS.Timeout | undefined;
  const remember = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (w.isDestroyed()) return;
      if (mode === 'widget' && w === win) prefs.widgetBounds = w.getBounds();
      else if (w === win && !w.isMaximized()) prefs.appBounds = w.getBounds();
      savePrefs();
    }, 500);
  };
  w.on('move', remember);
  w.on('resize', remember);
  w.on('close', (e) => {
    if (quitting || w !== win) return;
    // Closing keeps Mote living in the tray.
    e.preventDefault();
    w.hide();
    if (!prefs.trayHintShown && tray && process.platform === 'win32') {
      tray.displayBalloon({ title: 'Mote is still here', content: 'It keeps living in the tray. Click the icon to bring it back.', iconType: 'info' });
      prefs.trayHintShown = true;
      savePrefs();
    }
  });
  w.once('ready-to-show', () => {
    w.show();
    old?.destroy();
  });
  void w.loadURL(`${url}/?mode=${next}`);
  updateTray();
}

function toggleVisible() {
  if (win && !win.isDestroyed() && win.isVisible()) win.hide();
  else open(win && !win.isDestroyed() ? mode : prefs.widgetFirst ? 'widget' : 'app');
}

function updateTray() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: 'Open Mote', click: () => open('app') },
    { label: 'Show as a desktop widget', click: () => open('widget') },
    { type: 'separator' },
    {
      label: 'Keep the widget on top',
      type: 'checkbox',
      checked: prefs.onTop,
      click: (item) => setPref('onTop', item.checked),
    },
    {
      label: 'Start Mote when I log in',
      type: 'checkbox',
      checked: prefs.autostart,
      click: (item) => setPref('autostart', item.checked),
    },
    { type: 'separator' },
    { label: 'Quit Mote', click: () => void quit() },
  ]);
  tray.setContextMenu(menu);
}

function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  prefs[key] = value;
  savePrefs();
  if (key === 'autostart') applyAutostart();
  if (key === 'onTop' && win && !win.isDestroyed() && mode === 'widget') win.setAlwaysOnTop(!!value, 'floating');
  updateTray();
  return publicPrefs();
}

const publicPrefs = () => ({ onTop: prefs.onTop, autostart: prefs.autostart, widgetFirst: prefs.widgetFirst });

async function quit() {
  quitting = true;
  try {
    await closeMote?.();
  } catch {
    /* closing anyway */
  }
  app.quit();
}

async function boot() {
  mkdirSync(dataDir, { recursive: true });
  loadPrefs();
  // Everything Mote keeps lives in this app's user-data folder.
  Object.assign(process.env, {
    MOTE_ROOT: root,
    MOTE_DATA_DIR: dataDir,
    MOTE_DB_PATH: path.join(dataDir, 'mote.sqlite'),
    MOTE_DESKTOP: '1',
    NODE_ENV: 'production',
    MOTE_HOST: '127.0.0.1',
    MOTE_PORT: process.env.MOTE_PORT || '47474',
    DECISION_MODEL: process.env.DECISION_MODEL || 'tev1:0.8b',
  });
  const { startMote } = await import('../server/main');
  const mote = await startMote({ log, portTries: 30 });
  url = mote.url;
  closeMote = mote.close;
  log(`[mote] desktop app ready at ${url} (data in ${dataDir})`);

  const trayIcon = process.platform === 'darwin' ? icon('trayTemplate.png') : icon('tray.png');
  tray = new Tray(trayIcon);
  tray.setToolTip('Mote');
  tray.on('click', toggleVisible);
  updateTray();
  applyAutostart();

  ipcMain.on('mote:open', (_e, m: Mode) => open(m === 'widget' ? 'widget' : 'app'));
  ipcMain.on('mote:hide', () => win?.hide());
  ipcMain.handle('mote:prefs', () => publicPrefs());
  ipcMain.handle('mote:set-pref', (_e, key: keyof ReturnType<typeof publicPrefs>, value: boolean) =>
    ['onTop', 'autostart', 'widgetFirst'].includes(key) ? setPref(key, !!value) : publicPrefs(),
  );

  if (!startHidden || prefs.widgetFirst) open(prefs.widgetFirst ? 'widget' : 'app');

  // Smoke test (CI): save a picture of the window, then quit.
  const snapshot = process.env.MOTE_DESKTOP_SNAPSHOT;
  if (snapshot) {
    setTimeout(async () => {
      try {
        const img = await win!.webContents.capturePage();
        writeFileSync(snapshot, img.toPNG());
        log(`[mote] snapshot saved to ${snapshot}`);
      } finally {
        void quit();
      }
    }, Number(process.env.MOTE_DESKTOP_SNAPSHOT_DELAY) || 8000);
  }
}

// Mote only ever shows its own local page, so letting Chromium fall back to software 3D is safe, and
// it keeps the 3D Mote working on computers without a usable graphics driver.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => open(win && !win.isDestroyed() ? mode : 'app'));
  app.on('window-all-closed', () => {
    /* Mote stays in the tray */
  });
  app.on('before-quit', () => (quitting = true));
  app.on('activate', () => open(mode));
  app.whenReady().then(boot, (err) => {
    log(`[mote] failed to start: ${(err as Error).stack ?? err}`);
    app.quit();
  });
}
