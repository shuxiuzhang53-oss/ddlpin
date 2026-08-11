// Electron 便签主进程:无边框、置顶、全空间可见、半透明、记住位置。
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const log = (...a) => console.error(new Date().toISOString(), '[sticky]', ...a);
process.on('uncaughtException', (e) => log('uncaughtException:', e));
process.on('unhandledRejection', (e) => log('unhandledRejection:', e));
process.on('exit', (c) => log('process exit', c));
const STATE_PATH = path.join(os.homedir(), '.taskboard', 'sticky-window.json');
const PORT = process.env.TASKBOARD_PORT || 4747;

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
}
function saveState(s) {
  try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(s)); } catch {}
}

let win;
function createWindow() {
  const st = loadState();
  const disp = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: st.width || 320,
    height: st.height || 440,
    x: st.x ?? disp.width - 344,
    y: st.y ?? 24,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    minWidth: 220,
    minHeight: 120,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'index.html')).catch((e) => console.error('[sticky] loadFile FAIL:', e));
  win.webContents.on('did-fail-load', (_e, code, desc) => console.error('[sticky] did-fail-load', code, desc));
  win.webContents.on('render-process-gone', (_e, d) => console.error('[sticky] render-gone', d));
  win.webContents.executeJavaScript(`window.__PORT__=${PORT}`).catch(() => {});

  const persist = () => { const b = win.getBounds(); saveState({ ...loadState(), ...b }); };
  win.on('moved', persist);
  win.on('resized', persist);
}

// 迷你/完整形态切换时,主进程按渲染层给的高度调整窗口
ipcMain.on('resize-to', (_e, { width, height }) => {
  if (!win) return;
  const b = win.getBounds();
  win.setBounds({ x: b.x, y: b.y, width: width || b.width, height: Math.round(height) }, false);
  saveState({ ...loadState(), ...win.getBounds() });
});
ipcMain.on('quit', () => app.quit());

app.on('render-process-gone', (_e, _wc, d) => log('render-process-gone', JSON.stringify(d)));
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.dock?.hide(); // macOS:不在 Dock 显示,像个小组件
