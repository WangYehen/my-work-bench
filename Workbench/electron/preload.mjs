import { contextBridge, ipcRenderer } from "electron";

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld("workbench", {
  dailyReports: {
    get: (date) => invoke("daily-report:get", date),
    list: (range) => invoke("daily-report:list", range),
    save: (report) => invoke("daily-report:save", report),
    submit: (report) => invoke("daily-report:submit", report),
    sync: () => invoke("daily-report:sync"),
    dingtalkStart: () => invoke("daily-report:dingtalk-start"),
    dingtalkExchange: (token) => invoke("daily-report:dingtalk-exchange", token),
    logout: () => invoke("daily-report:logout"),
    me: () => invoke("daily-report:me"),
    adminReports: (filters) => invoke("daily-report:admin-reports", filters),
  },
});
