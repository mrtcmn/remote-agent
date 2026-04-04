import { app, BrowserWindow, ipcMain, Menu, net, nativeImage, shell, Tray } from 'electron';
import path from 'path';
import { getStore } from './store';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

async function createWindow() {
  const store = await getStore();
  const bounds = store.get('windowBounds');

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hiddenInset',
    transparent: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundMaterial: 'acrylic',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Save window bounds on resize/move
  const saveBounds = () => {
    if (mainWindow && !mainWindow.isMinimized()) {
      store.set('windowBounds', mainWindow.getBounds());
    }
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  // Load the UI
  const isDev = process.argv.includes('--dev');
  const isRemote = process.argv.includes('--remote');
  const devUrl = isRemote ? 'https://ra.grasco.dev' : 'http://localhost:5173';
  const allowedOrigin = isDev ? new URL(devUrl).origin : 'file://';

  if (isDev) {
    mainWindow.loadURL(devUrl);
    if (!isRemote) mainWindow.webContents.openDevTools();
  } else {
    const uiPath = path.join(process.resourcesPath, 'ui', 'index.html');
    mainWindow.loadFile(uiPath);
  }

  // Open external URLs in default browser, only allow the app origin
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).origin !== allowedOrigin) {
        shell.openExternal(url);
      }
    } catch {}
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).origin !== allowedOrigin) {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch {}
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

ipcMain.handle('get-api-url', async () => {
  const store = await getStore();
  return store.get('apiUrl');
});

ipcMain.handle('set-api-url', async (_event, url: string) => {
  const store = await getStore();
  store.set('apiUrl', url);
});

ipcMain.handle('check-connection', async (_event, url: string) => {
  try {
    const response = await net.fetch(`${url.replace(/\/$/, '')}/health`, {
      method: 'GET',
    });
    if (response.ok) {
      const data = await response.json() as Record<string, unknown>;
      if (data.status === 'ok') {
        return { ok: true };
      }
    }
    return { ok: false, error: `Server responded with status ${response.status}` };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Connection failed' };
  }
});

// ─── Tray ───────────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'trayTemplate.png');
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip('Remote Agent');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    } else {
      createWindow();
    }
  });
}

// ─── App Lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createTray();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
