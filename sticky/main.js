// Electron 便签主进程:无边框、置顶、全空间可见、半透明、记住位置。
// 关键可靠性:菜单栏常驻图标(永远能召回)、越界坐标自动夹回、✕=隐藏而非退出、全局快捷键召回。
import { app, BrowserWindow, ipcMain, screen, Tray, Menu, globalShortcut, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const log = (...a) => console.error(new Date().toISOString(), '[sticky]', ...a);
process.on('uncaughtException', (e) => log('uncaughtException:', e));
process.on('unhandledRejection', (e) => log('unhandledRejection:', e));
const STATE_PATH = path.join(os.homedir(), '.taskboard', 'sticky-window.json');
const PORT = process.env.TASKBOARD_PORT || 4747;
const DEFAULT = { width: 320, height: 440 };

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
}
function saveState(s) {
  try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(s)); } catch {}
}

// 把窗口矩形夹回“当前真实存在的某块屏”的可视区域;完全越界则归位到主屏右上角。
function clampToVisible(b) {
  const displays = screen.getAllDisplays();
  const enoughVisible = displays.some((d) => {
    const w = d.workArea;
    return b.x < w.x + w.width - 40 && b.x + b.width > w.x + 40 &&
           b.y < w.y + w.height - 20 && b.y + b.height > w.y + 4;
  });
  if (enoughVisible) return b;
  const p = screen.getPrimaryDisplay().workArea;
  return { x: p.x + p.width - b.width - 24, y: p.y + 24, width: b.width, height: b.height };
}

let win, tray;
function createWindow() {
  const st = loadState();
  const p = screen.getPrimaryDisplay().workArea;
  const start = clampToVisible({
    width: st.width || DEFAULT.width,
    height: st.height || DEFAULT.height,
    x: st.x ?? (p.x + p.width - 344),
    y: st.y ?? (p.y + 24),
  });
  win = new BrowserWindow({
    ...start,
    frame: false, transparent: true, resizable: true, alwaysOnTop: true,
    skipTaskbar: true, hasShadow: true, minWidth: 220, minHeight: 100,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');      // 更高层级,尽量压过普通全屏窗口
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'index.html')).catch((e) => log('loadFile FAIL:', e));
  win.webContents.on('did-fail-load', (_e, code, desc) => log('did-fail-load', code, desc));
  win.webContents.on('render-process-gone', (_e, d) => log('render-gone', JSON.stringify(d)));
  win.webContents.executeJavaScript(`window.__PORT__=${PORT}`).catch(() => {});
  // ✕ 只隐藏,不退出 —— 关闭动作不真的销毁窗口
  win.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); win.hide(); } });
  const persist = () => { if (win && !win.isDestroyed()) saveState({ ...loadState(), ...win.getBounds() }); };
  win.on('moved', persist);
  win.on('resized', persist);
}

function showWindow() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  const fixed = clampToVisible(win.getBounds());   // 召回时先把越界的拉回来
  win.setBounds(fixed);
  win.show();
  win.setAlwaysOnTop(true, 'screen-saver');
  win.focus();
}
function toggleWindow() { if (win && win.isVisible()) win.hide(); else showWindow(); }
function recenter() {
  if (!win) return;
  const p = screen.getPrimaryDisplay().workArea;
  const b = win.getBounds();
  win.setBounds({ x: p.x + p.width - b.width - 24, y: p.y + 24, width: b.width, height: b.height });
  showWindow();
}

// 迷你/完整形态切换时,渲染层报高度,主进程调整窗口
ipcMain.on('resize-to', (_e, { width, height }) => {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  win.setBounds({ x: b.x, y: b.y, width: width || b.width, height: Math.round(height) || b.height }, false);
  saveState({ ...loadState(), ...win.getBounds() });
});
// ✕ 按钮:隐藏到菜单栏(不退出)
ipcMain.on('hide-window', () => { if (win && !win.isDestroyed()) win.hide(); });

function buildTray() {
  // 用空图 + emoji 标题,免去打包图标文件(macOS 菜单栏显示文字/emoji)
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('📌');
  tray.setToolTip('ddlpin 任务便签');
  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏便签', click: toggleWindow },
    { label: '归位到主屏右上角', click: recenter },
    { type: 'separator' },
    { label: '召回快捷键:⌘⇧D', enabled: false },
    { type: 'separator' },
    { label: '退出 ddlpin 便签', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', toggleWindow);  // 单击图标即切换显示
}

app.whenReady().then(() => {
  createWindow();
  buildTray();
  globalShortcut.register('CommandOrControl+Shift+D', showWindow);
});
app.on('window-all-closed', () => { /* 常驻:菜单栏还在,不退出 */ });
app.on('activate', () => showWindow());
app.on('will-quit', () => globalShortcut.unregisterAll());
app.dock?.hide(); // macOS:不在 Dock 显示,像个小组件
