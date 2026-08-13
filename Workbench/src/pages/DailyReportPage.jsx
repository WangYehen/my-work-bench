import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { IconCheck, IconCloud, IconHistory, IconLock, IconSend } from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import { CalendarPicker, WorkbenchCalendar } from "../components/WorkbenchCalendar";
import {
  getDailyReport,
  getDailyReportUser,
  loadOwnDailyReports,
  saveDailyReport,
  subscribeDailyReportAuth,
  submitDailyReport,
} from "../lib/daily-reports";

const today = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
}).format(new Date());
const emptyReport = (reportDate) => ({ reportDate, summary: "", completedItems: "", blockers: "", nextActions: "" });
const historyStart = "2000-01-01";
const historyEnd = () => today();

export function DailyReportPage() {
  const [date, setDate] = useState(today());
  const [report, setReport] = useState(() => emptyReport(today()));
  const [user, setUser] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);
  const [editing, setEditing] = useState(true);
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  const isElectron = Boolean(globalThis.window?.workbench?.dailyReports);

  const refreshHistory = async (currentUser = user) => {
    if (!currentUser) { setHistory([]); return; }
    try {
      const result = await loadOwnDailyReports({ from: historyStart, to: historyEnd() });
      const items = (result.items || [])
        .map((item) => ({ ...item, reportDate: String(item.reportDate).slice(0, 10) }))
        .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.reportDate))
        .sort((a, b) => b.reportDate.localeCompare(a.reportDate));
      setHistory(items);
    } catch (err) {
      // Older team-report servers may not expose the range endpoint yet.
      if (err?.status === 404 || err?.code === "NOT_FOUND" || /接口不存在|鎺ュ彛涓嶅瓨鍦/.test(err?.message || "")) {
        setHistory([]);
        return;
      }
      setError(err.message || "历史日报加载失败");
    }
  };

  useEffect(() => {
    getDailyReportUser().then((result) => {
      const current = result?.user || result;
      setUser(current);
      return refreshHistory(current);
    }).catch(() => {});
    return subscribeDailyReportAuth(setUser);
  }, []);
  useEffect(() => {
    if (user) void refreshHistory(user);
    else setHistory([]);
  }, [user]);
  useEffect(() => {
    setConfirmingSubmit(false);
    getDailyReport(date)
      .then((saved) => setReport(saved ? { ...emptyReport(date), ...saved } : emptyReport(date)))
      .catch((err) => {
        // A missing report for a valid date is an empty editor state, not a page error.
        if (err?.status === 404 || err?.code === "NOT_FOUND" || /接口不存在|鎺ュ彛涓嶅瓨鍦/.test(err?.message || "")) setReport(emptyReport(date));
        else setError(err.message);
      });
  }, [date]);

  const set = (key, value) => setReport((current) => ({ ...current, [key]: value }));
  const save = async (submit = false) => {
    if (submit && selectedHistory && editing && !confirmingSubmit) {
      setConfirmingSubmit(true);
      return;
    }
    setBusy(true); setError(""); setMessage("");
    try {
      const result = submit ? await submitDailyReport(report) : await saveDailyReport(report);
      setReport((current) => ({ ...current, ...result }));
      if (submit) {
        const submittedReport = { ...report, ...result, reportDate: report.reportDate, syncStatus: "synced", submittedAt: result.submittedAt || new Date().toISOString() };
        setHistory((current) => [submittedReport, ...current.filter((item) => item.reportDate !== report.reportDate)].sort((a, b) => b.reportDate.localeCompare(a.reportDate)));
      }
      await refreshHistory();
      if (submit) {
        setHistory((current) => current.some((item) => item.reportDate === report.reportDate)
          ? current
          : [{ ...report, ...result, reportDate: report.reportDate, syncStatus: "synced", submittedAt: result.submittedAt || new Date().toISOString() }, ...current].sort((a, b) => b.reportDate.localeCompare(a.reportDate)));
      }
      setMessage(submit ? "日报已提交，管理员可以查看。" : "草稿已保存到本机。");
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const statusLabel = useMemo(() => report.syncStatus === "synced" ? "已同步" : report.syncStatus === "error" ? "待重试" : "仅保存在本机", [report.syncStatus]);

  const reportDates = useMemo(() => new Set(history.map((item) => String(item.reportDate).slice(0, 10))), [history]);
  const selectedHistory = history.find((item) => String(item.reportDate).slice(0, 10) === date);
  const selectHistoryDate = (nextDate) => {
    setConfirmingSubmit(false);
    setDate(nextDate);
    const item = history.find((entry) => String(entry.reportDate).slice(0, 10) === nextDate);
    if (item) {
      setReport({ ...emptyReport(nextDate), ...item });
      setEditing(false);
    } else {
      setEditing(true);
    }
  };
  const cancelEdit = () => {
    setConfirmingSubmit(false);
    if (selectedHistory) setReport({ ...emptyReport(date), ...selectedHistory });
    setEditing(false);
  };
  const syncLabel = (item) => item.syncStatus === "synced" ? "已同步" : item.syncStatus === "pending_sync" ? "待同步" : item.syncStatus === "error" ? "同步失败" : "本机草稿";

  return <div className="page page--work-management">
    <PageHeader eyebrow="TEAM / DAILY REPORT" title="日报提交" description="日报只会上传给管理员，其他工作台数据始终保存在本机。" aside={<span className="work-page-icon"><IconLock size={20} /></span>} />
    {!user ? <div className="work-notice"><span className="status-dot status-dot--warn" /><div><strong>尚未登录团队日报</strong><span>前往<Link to="/system">系统状态</Link>登录后即可提交日报。</span></div></div> : <div className="report-login report-account"><div><strong>已登录：{user.displayName || user.username}</strong><span>{user.role === "admin" ? "管理员账号" : "成员账号"} · 账号管理请前往系统状态</span></div></div>}
    <div className="report-meta"><label>日报日期<CalendarPicker value={date} onChange={setDate} /></label><span><IconCloud size={14} />{isElectron ? statusLabel : "Web 端同步"}</span></div>
    {confirmingSubmit && <div className="daily-report-modal-backdrop" role="presentation"><section className="daily-report-modal" role="dialog" aria-modal="true" aria-labelledby="daily-report-confirm-title"><div className="daily-report-modal__content"><strong id="daily-report-confirm-title">确认提交 {date} 的历史日报</strong><span>这将覆盖该日期当前已提交的日报内容。</span></div><div className="daily-report-modal__actions"><button className="work-button work-button--primary" disabled={busy || !user} onClick={() => save(true)} type="button"><IconSend size={15} />确认提交</button><button className="work-button" disabled={busy} onClick={() => setConfirmingSubmit(false)} type="button">返回修改</button></div></section></div>}
    {editing && <section className="daily-report-form"><label><span>今日总结</span><textarea required maxLength={10000} placeholder="今天完成了什么？有什么重要进展？" value={report.summary} onChange={(event) => set("summary", event.target.value)} /></label><label><span>已完成事项</span><textarea maxLength={10000} placeholder="逐项记录已完成的工作" value={report.completedItems} onChange={(event) => set("completedItems", event.target.value)} /></label><label><span>阻塞与风险</span><textarea maxLength={10000} placeholder="没有可以填写“无”" value={report.blockers} onChange={(event) => set("blockers", event.target.value)} /></label><label><span>下一步行动</span><textarea maxLength={10000} placeholder="明天或下一阶段准备推进什么？" value={report.nextActions} onChange={(event) => set("nextActions", event.target.value)} /></label></section>}
    {error && <div className="work-error" role="alert">{error}</div>}{message && <div className="report-success"><IconCheck size={15} />{message}</div>}
    {editing && <div className="daily-report-actions"><button className="work-button" disabled={busy} onClick={() => save(false)} type="button">保存本机草稿</button><button className="work-button work-button--primary" disabled={busy || !user} onClick={() => save(true)} type="button"><IconSend size={15} />提交给管理员</button>{selectedHistory && <button className="work-button" disabled={busy} onClick={cancelEdit} type="button">取消编辑</button>}</div>}
    <section className="daily-history">
      <div className="daily-history__head"><div><span className="eyebrow">REPORT HISTORY</span><h2><IconHistory size={19} />历史日报</h2></div><span>{history.length} 条记录</span></div>
      {user ? <div className="team-reports-layout"><section className="team-reports-content"><div className="team-reports-content__head"><div><span className="eyebrow">SELECTED REPORT</span><h2>{date} <small>{selectedHistory ? syncLabel(selectedHistory) : "暂无记录"}</small></h2></div><span className="team-reports-content__hint">点击日期查看历史记录</span></div>{selectedHistory ? <article className="team-report-card daily-history__selected"><div className="team-report-card__head"><strong>{selectedHistory.reportDate}</strong><time>{syncLabel(selectedHistory)}</time></div><h3>{selectedHistory.summary || "暂无总结"}</h3><dl><div><dt>已完成</dt><dd>{selectedHistory.completedItems || "无"}</dd></div><div><dt>阻塞与风险</dt><dd>{selectedHistory.blockers || "无"}</dd></div><div><dt>下一步</dt><dd>{selectedHistory.nextActions || "无"}</dd></div></dl><button className="work-button" type="button" onClick={() => setEditing(true)}>编辑此日报</button></article> : <div className="report-empty"><IconHistory size={24} /><strong>当前日期暂无日报</strong><span>选择日历中有标记的日期查看历史记录。</span></div>}</section><WorkbenchCalendar ariaLabel="历史日报日历" selectedDate={date} reportDates={reportDates} onSelect={selectHistoryDate} /></div> : <div className="report-empty"><IconHistory size={24} /><strong>登录后查看历史日报</strong><span>历史记录仅展示当前账号自己的日报。</span></div>}
    </section>
  </div>;
}
