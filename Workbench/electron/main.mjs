import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalReportStore } from "./local-report-store.mjs";
import { normalizeDailyReportInput } from "../shared/daily-report-contracts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const teamApiBase = String(process.env.TEAM_REPORT_API_URL || "").replace(/\/$/, "");
if (teamApiBase && !/^https:\/\//i.test(teamApiBase) && !/^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(teamApiBase) && !/^https?:\/\/localhost(?::\d+)?$/i.test(teamApiBase)) throw new Error("TEAM_REPORT_API_URL 必须使用 HTTPS（本机开发可使用 localhost）。");
let mainWindow;
let tray;
let authToken = null;
let authUser = null;
let reportStore;

async function teamRequest(pathname, options = {}) {
  if (!teamApiBase) throw new Error("尚未配置 TEAM_REPORT_API_URL。");
  const response = await fetch(`${teamApiBase}${pathname}`, { ...options, headers: { Accept: "application/json", "Content-Type": "application/json", ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), ...options.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || "团队日报服务请求失败。");
  return body;
}

async function syncReport(report) {
  const payload = normalizeDailyReportInput(report);
  if (!authToken) throw new Error("请先使用钉钉登录团队日报。");
  const result = await teamRequest(`/api/team/daily-reports/me/${payload.reportDate}`, { method: "PUT", body: JSON.stringify(payload) });
  return reportStore.markSynced(payload.reportDate, result.id);
}

async function syncPending() {
  const results = [];
  for (const report of reportStore.listPending()) {
    try { results.push(await syncReport(report)); }
    catch (error) { results.push(reportStore.markError(report.reportDate, error.message)); }
  }
  return results;
}

function registerIpc() {
  ipcMain.handle("daily-report:get", (_event, date) => reportStore.get(String(date)));
  ipcMain.handle("daily-report:list", (_event, range = {}) => reportStore.list(range.from, range.to));
  ipcMain.handle("daily-report:save", (_event, report) => reportStore.save(report, "draft"));
  ipcMain.handle("daily-report:submit", async (_event, report) => {
    const saved = reportStore.save(report, "pending_sync");
    try { return await syncReport(saved); }
    catch (error) { return reportStore.markError(saved.reportDate, error.message); }
  });
  ipcMain.handle("daily-report:sync", () => syncPending());
  ipcMain.handle("daily-report:dingtalk-start", () => teamRequest("/api/team/auth/dingtalk/start", { method: "POST", body: JSON.stringify({}) }));
  ipcMain.handle("daily-report:dingtalk-exchange", async (_event, loginToken) => {
    const result = await teamRequest("/api/team/auth/exchange", { method: "POST", body: JSON.stringify({ token: loginToken }) });
    authToken = result.token;
    authUser = result.user;
    await syncPending();
    return authUser;
  });
  ipcMain.handle("daily-report:logout", async () => { authToken = null; authUser = null; return { ok: true }; });
  ipcMain.handle("daily-report:me", () => authUser);
  ipcMain.handle("daily-report:admin-reports", async (_event, filters = {}) => {
    if (!authUser) throw new Error("请先使用钉钉登录。");
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    return teamRequest(`/api/team/reports?${query}`);
  });
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
