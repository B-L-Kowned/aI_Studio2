const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');
const { spawn } = require('node:child_process');
const { join, resolve, dirname, isAbsolute, sep } = require('node:path');
const { existsSync, realpathSync } = require('node:fs');

// The desktop shell.
//
// It owns three things the browser could not:
//   · a port nobody else chose        — the API listens on 0, we read it back
//   · a real file picker              — a web file input gives a name, never a path
//   · one process the user can quit   — instead of two terminals and pm2
//
// It deliberately owns nothing else. All product logic stays in the backend, so
// the same build runs headless in CI and under `npm run verify`.

// The native database module is built against N-API 10. N-API is forward- but not
// backward-compatible, and a runtime that offers less does NOT report a clean
// error: it segfaults inside node_module_register with an empty stderr, before
// any JavaScript runs. Electron 33 (Node 20 / N-API 9) was below this floor and
// the whole app died silently. Name the cause here rather than letting the
// backend die and reporting "did not report a port".
const REQUIRED_NAPI = 10;

function checkRuntime() {
  const napi = Number(process.versions.napi);
  if (Number.isFinite(napi) && napi >= REQUIRED_NAPI) return null;
  return [
    `This Electron embeds Node ${process.version} (N-API ${process.versions.napi}).`,
    `better-sqlite3 needs N-API ${REQUIRED_NAPI}, which means Node 22 or newer.`,
    '',
    'Below that floor the database module crashes the process on load with no',
    'error message. Rebuilding it does not help — the ABI is not the problem.',
    'Install an Electron whose embedded Node is 22 or newer.',
  ].join('\n');
}

// In development the window is owned by Electron's own bundle, so the Dock and
// Cmd-Tab show a generic "Electron" and the app looks like it never started.
// Name it before `whenReady`, and pin userData so renaming does not relocate it.
app.setPath('userData', join(app.getPath('appData'), 'ai-video-studio-desktop'));
app.setName('AI Video Studio');

const isDev = !app.isPackaged;
const root = isDev ? resolve(__dirname, '..') : resolve(process.resourcesPath, 'app');
const backendEntry = join(root, 'backend', 'server.js');
const webRoot = join(root, 'frontend', 'dist');

// Where the backend has always put the database when nothing overrode it
// (backend/db/index.js defaultDbPath). Passed explicitly so a dev server run
// with its own STUDIO_DB_PATH and this app never have to agree by accident —
// and kept at the old location so upgrading does not orphan anyone's data.
// Linux differs from appData on purpose: the backend uses XDG_DATA_HOME there.
function studioDbPath() {
  if (process.env.STUDIO_DB_PATH) return resolve(process.env.STUDIO_DB_PATH);
  const base = process.platform === 'linux'
    ? process.env.XDG_DATA_HOME || join(app.getPath('home'), '.local', 'share')
    : app.getPath('appData');
  return join(base, 'AIVideoStudio', 'studio.db');
}

let backend = null;
let win = null;
let ready = null; // { port, packaged, dbPath }

/** Start the API and wait for it to say which port it actually got. */
function startBackend() {
  return new Promise((ok, no) => {
    if (!existsSync(backendEntry)) {
      return no(new Error(`The backend is missing at ${backendEntry}.`));
    }

    backend = spawn(process.execPath, [backendEntry], {
      cwd: join(root, 'backend'),
      env: {
        // Inherited for PATH, FFMPEG_PATH and friends. This also carries any
        // provider-mode default from a dev shell, which is intended: the
        // stored workspace setting still wins over the env default.
        ...process.env,
        STUDIO_DB_PATH: studioDbPath(),
        // Port 0 asks the OS for a free one. A fixed port collides with whatever
        // else is on the machine, and with a second copy of this app.
        PORT: '0',
        WEB_ROOT: webRoot,
        // Electron's own node; the backend must not try to re-exec Electron.
        ELECTRON_RUN_AS_NODE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffered = '';
    const settleTimer = setTimeout(
      () => no(new Error(`The backend did not report a port within 20s.\n${buffered.slice(-800)}`)),
      20000
    );

    backend.stdout.on('data', (chunk) => {
      buffered += chunk;
      process.stdout.write(chunk);
      const line = /STUDIO_READY (\{.*\})/.exec(buffered);
      if (line) {
        clearTimeout(settleTimer);
        ok(JSON.parse(line[1]));
      }
    });
    backend.stderr.on('data', (chunk) => {
      buffered += chunk;
      process.stderr.write(chunk);
    });
    backend.on('error', (err) => { clearTimeout(settleTimer); no(err); });
    backend.on('exit', (code) => {
      clearTimeout(settleTimer);
      backend = null;
      // A backend that dies takes the app with it rather than leaving a window
      // whose every action fails with a network error.
      if (code !== 0 && !app.isQuitting) {
        dialog.showErrorBox('AI Video Studio stopped',
          `The backend exited with code ${code}.\n\n${buffered.slice(-1200)}`);
        app.quit();
      }
    });
  });
}

// Exact origin, not a prefix: `http://127.0.0.1:5000` is a prefix of
// `http://127.0.0.1:50001`, which is someone else's server.
function isInternal(url, port) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && u.hostname === '127.0.0.1' && u.port === String(port);
  } catch {
    return false;
  }
}

// Only web links leave the app. file:, custom schemes and the like would hand
// the OS a URL the page chose, so they are dropped rather than opened.
function openOutside(url) {
  try {
    const { protocol } = new URL(url);
    if (protocol === 'http:' || protocol === 'https:') shell.openExternal(url);
  } catch { /* not a URL — nothing to open */ }
}

function createWindow(port) {
  win = new BrowserWindow({
    width: 1400,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#f6f6f4',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      // The renderer is our own build, but it also renders provider data. No
      // reason to hand it Node.
      contextIsolation: true,
      nodeIntegration: false,
      // The preload only uses contextBridge and ipcRenderer, both available
      // to a sandboxed preload.
      sandbox: true,
      devTools: isDev,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(`http://127.0.0.1:${port}/`);

  // A link to somewhere else is somewhere else: open it in the real browser
  // rather than turning this window into one.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isInternal(url, port)) openOutside(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isInternal(url, port)) {
      e.preventDefault();
      openOutside(url);
    }
  });
}

// ------------------------------------------------------------------- IPC ---
// The renderer asks; the main process decides. Every handler below returns a
// path the USER chose in a native dialog — the renderer can never name a file
// on its own.

ipcMain.handle('studio:pick-video', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose a video to analyse',
    properties: ['openFile'],
    filters: [
      { name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('studio:pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Where should exports go?',
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

// Reveal is the one call that takes a path FROM the page, so it is confined to
// what the app itself writes: its data directories and the export storage root.
// The storage root lives in the database, so the backend is asked for it.
async function revealRoots() {
  const roots = [app.getPath('userData')];
  if (ready?.dbPath) roots.push(dirname(ready.dbPath));
  try {
    const r = await fetch(`http://127.0.0.1:${ready.port}/api/storage`,
      { signal: AbortSignal.timeout(2000) });
    const current = (await r.json())?.data?.current?.path;
    if (typeof current === 'string' && isAbsolute(current)) roots.push(current);
  } catch { /* backend unreachable — the local roots still apply */ }
  return roots.flatMap((p) => { try { return [realpathSync(p)]; } catch { return []; } });
}

ipcMain.handle('studio:reveal', async (_e, path) => {
  if (typeof path !== 'string' || !isAbsolute(path) || !ready) return false;
  let target;
  try { target = realpathSync(resolve(path)); } catch { return false; } // must exist
  const roots = await revealRoots();
  if (!roots.some((root) => target === root || target.startsWith(root + sep))) return false;
  shell.showItemInFolder(target);
  return true;
});

ipcMain.handle('studio:info', async () => ({
  version: app.getVersion(),
  platform: process.platform,
  dbPath: ready?.dbPath ?? null,
}));

// ----------------------------------------------------------------- lifecycle

app.whenReady().then(async () => {
  const unsupported = checkRuntime();
  if (unsupported) {
    dialog.showErrorBox('AI Video Studio cannot run on this Electron', unsupported);
    app.quit();
    return;
  }

  try {
    ready = await startBackend();
  } catch (err) {
    dialog.showErrorBox('AI Video Studio could not start', err.message);
    app.quit();
    return;
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        // Electron binds no back/forward of its own, so the app had history
        // but no way to reach it from the keyboard. These are the macOS
        // standards, and they drive the same history the UI pushes to.
        {
          label: 'Back',
          accelerator: 'CmdOrCtrl+[',
          click: (_i, w) => w?.webContents.navigationHistory.canGoBack()
            && w.webContents.navigationHistory.goBack(),
        },
        {
          label: 'Forward',
          accelerator: 'CmdOrCtrl+]',
          click: (_i, w) => w?.webContents.navigationHistory.canGoForward()
            && w.webContents.navigationHistory.goForward(),
        },
        { type: 'separator' },
        { role: 'reload' },
        ...(isDev ? [{ role: 'toggleDevTools' }] : []),
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]));

  createWindow(ready.port);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(ready.port);
  });
});

app.on('before-quit', () => { app.isQuitting = true; });

// The backend is a child of this app, not a service left running on the
// machine. Quitting the window quits the server with it.
app.on('window-all-closed', () => app.quit());
app.on('quit', () => backend?.kill('SIGTERM'));
process.on('exit', () => backend?.kill('SIGTERM'));
