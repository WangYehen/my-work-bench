import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalReportStore } from "./local-report-store.mjs";
import { normalizeDailyReportInput } from "../shared/daily-report-contracts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
let mainWindow;
let tray;
let authToken = null;
let authUser = null;
let reportStore;

async function localWorkbenchRequest(pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:5174${pathname}`, {
    ...options,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failure = new Error(body?.error?.message || "本地钉钉服务请求失败。");
    failure.code = body?.error?.code;
    throw failure;
  }
  return body;
}

async function syncReport(report) {
  const payload = normalizeDailyReportInput(report);
  return reportStore.markSynced(payload.reportDate, null);
}

async function syncPending() {
  if (!await currentDingTalkUser()) return [];
  const results = [];
  for (const report of reportStore.listPending()) {
    try { results.push(await syncReport(report)); }
    catch (error) { results.push(reportStore.markError(report.reportDate, error.message)); }
  }
  return results;
}

async function currentDingTalkUser() {
  const status = await localWorkbenchRequest("/api/dingtalk/status").catch(() => null);
  if (!status?.connected || !status.profile?.id) return null;
  reportStore.setIdentity(status.profile);
  return { id: status.profile.id, displayName: status.profile.displayName || "钉钉已连接", avatarUrl: status.profile.avatarUrl || null, departmentName: status.profile.departmentName || "本地工作台", role: "member" };
}

function registerIpc() {
  ipcMain.handle("daily-report:get", async (_event, date) => { await currentDingTalkUser(); return reportStore.get(String(date)); });
  ipcMain.handle("daily-report:list", async (_event, range = {}) => { await currentDingTalkUser(); return reportStore.list(range.from, range.to); });
  ipcMain.handle("daily-report:save", async (_event, report) => { await currentDingTalkUser(); return reportStore.save(report, "draft"); });
  ipcMain.handle("daily-report:submit", async (_event, report) => {
    await currentDingTalkUser(); const saved = reportStore.save(report, "pending_sync");
    try { return await syncReport(saved); }
    catch (error) { return reportStore.markError(saved.reportDate, error.message); }
  });
  ipcMain.handle("daily-report:sync", () => syncPending());
  ipcMain.handle("daily-report:sync-dingtalk-reports", async (_event, input = {}) => {
    return localWorkbenchRequest("/api/local-daily-reports/sync", { method: "POST", body: JSON.stringify(input) });
  });
  ipcMain.handle("daily-report:dingtalk-start", () => localWorkbenchRequest("/api/dingtalk/oauth/start", { method: "POST", body: "{}" }));
  // The local-first OAuth callback completes in the Vite service. Keep this
  // channel for older renderer builds that still invoke it after a callback.
  ipcMain.handle("daily-report:dingtalk-exchange", async () => {
    authUser = await localWorkbenchRequest("/api/dingtalk/status").then((status) => status.connected
      ? { displayName: status.profile?.displayName || "钉钉已连接", avatarUrl: status.profile?.avatarUrl || null, departmentName: status.profile?.departmentName || "本地工作台", role: "member" }
      : null);
    if (!authUser) throw new Error("钉钉授权尚未完成。");
    return authUser;
  });
  ipcMain.handle("daily-report:logout", async () => { authToken = null; authUser = null; reportStore.setIdentity(null); return localWorkbenchRequest("/api/dingtalk/logout", { method: "POST", body: "{}" }); });
  ipcMain.handle("daily-report:accounts", () => localWorkbenchRequest("/api/dingtalk/accounts"));
  ipcMain.handle("daily-report:switch-account", async (_event, accountId) => { const result = await localWorkbenchRequest("/api/dingtalk/accounts/switch", { method: "POST", body: JSON.stringify({ accountId }) }); authUser = null; reportStore.setIdentity(result.profile || null); return result; });
  ipcMain.handle("daily-report:me", async () => {
    if (authUser) return authUser;
    authUser = await currentDingTalkUser();
    if (!authUser) return null;
    return authUser;
  });
  ipcMain.handle("daily-report:admin-reports", async () => ({ items: [] }));
}

function createWindow() {
  mainWindow = new BrowserWindow({ width: 1440, height: 960, minWidth: 1024, minHeight: 700, webPreferences: { preload: path.join(__dirname, "preload.mjs"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  if (isDev) mainWindow.loadURL("http://127.0.0.1:5174");
  else mainWindow.loadFile(path.join(__dirname, "../dist/client/index.html"));
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("Personal AI Workbench");
  tray.setContextMenu(Menu.buildFromTemplate([{ label: "打开工作台", click: () => mainWindow?.show() }, { type: "separator" }, { role: "quit" }]));
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  reportStore = createLocalReportStore(app.getPath("userData"));
  registerIpc();
  createWindow();
  createTray();
  setInterval(() => { void syncPending(); }, 60_000);
});

app.on("window-all-closed", (event) => { event.preventDefault(); });
app.on("before-quit", () => reportStore?.close());
