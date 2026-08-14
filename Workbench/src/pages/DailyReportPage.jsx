import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { IconCloud, IconFileText, IconHistory, IconPhoto, IconRefresh } from "@tabler/icons-react";
import { CalendarPicker, WorkbenchCalendar } from "../components/WorkbenchCalendar";
import { PageHeader } from "../components/PageHeader";
import { loadDingTalkStatus, loadTaskCompletions } from "../lib/api";
import { DingTalkSyncStatus } from "../components/DingTalkSyncStatus";
import { getDailyReport, getDailyReportUser, loadOwnDailyReports, subscribeDailyReportAuth, syncDingTalkReports } from "../lib/daily-reports";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).format(new Date());

// 将日报多行文本拆分为独立条目（去除序号前缀、空行与“无”）
function splitLines(value) {
  return String(value || "").split(/\r?\n|[；;]/).map((item) => item.replace(/^[-*•\d.、\s]+/, "").trim()).filter((item) => item && item !== "无");
}

// 解析日报中的图片/附件 JSON 字段
function parseJsonList(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// 附件大小格式化
function formatSize(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function DailyReportPage() {
  const [date, setDate] = useState(today());
  const [user, setUser] = useState(null);
  const [report, setReport] = useState(null);
  const [history, setHistory] = useState([]);
  const [completedTasks, setCompletedTasks] = useState([]);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [dingtalkStatus, setDingtalkStatus] = useState(null);

  const refreshHistory = useCallback(async (currentUser) => {
    if (!currentUser) { setHistory([]); return; }
    try {
      const result = await loadOwnDailyReports({ from: "2000-01-01", to: today() });
      setHistory((result.items || []).map((item) => ({ ...item, reportDate: String(item.reportDate).slice(0, 10) })).sort((a, b) => b.reportDate.localeCompare(a.reportDate)));
    } catch (failure) { if (failure?.status !== 404) setError(failure.message || "历史日报加载失败"); }
  }, []);

  useEffect(() => {
    getDailyReportUser().then((result) => { const current = result?.user || result; setUser(current); return refreshHistory(current); }).catch(() => {});
    return subscribeDailyReportAuth((next) => { setUser(next); void refreshHistory(next); });
  }, [refreshHistory]);
  useEffect(() => { loadDingTalkStatus().then((result) => setDingtalkStatus(result.data || result)).catch(() => {}); }, []);

  const loadReport = useCallback(async (reportDate) => {
    setError("");
    const [saved, completions] = await Promise.allSettled([getDailyReport(reportDate), loadTaskCompletions(reportDate)]);
    setReport(saved.status === "fulfilled" ? saved.value || null : null);
    setCompletedTasks(completions.status === "fulfilled" ? (completions.value.items || []) : []);
  }, []);

  useEffect(() => { void loadReport(date); }, [date, loadReport]);

  const syncLogs = async () => {
    if (!user) return;
    setSyncing(true); setError("");
    try {
      await syncDingTalkReports({ scope: "daily-report", date });
      await Promise.all([loadReport(date), refreshHistory(user), loadDingTalkStatus().then((result) => setDingtalkStatus(result.data || result))]);
    } catch (failure) { setError(failure.message || "钉钉日志同步失败"); }
    finally { setSyncing(false); }
  };

  const doneEntries = useMemo(() => [
    ...(report ? splitLines(report.completedItems).map((text) => ({ text, badge: "钉钉日志", tone: "dingtalk" })) : []),
    ...completedTasks.map((task) => ({
      text: task.title,
      badge: task.sourceType === "outlook" ? "Outlook 任务" : task.sourceType === "dingtalk_plan" ? "钉钉计划" : "手动任务",
      tone: task.sourceType === "outlook" ? "outlook" : "task",
    })),
  ], [report, completedTasks]);
  const attachments = useMemo(() => (report ? parseJsonList(report.attachments) : []), [report]);
  const images = useMemo(() => (report ? parseJsonList(report.images) : []), [report]);
  const reportDates = useMemo(() => new Set(history.map((item) => item.reportDate)), [history]);
  const selectedHistory = history.find((item) => item.reportDate === date);

  return <div className="page daily-report-v2">
    <PageHeader description="数据来自钉钉日志，今日工作完成的任务会自动并入汇总。" eyebrow="WORK / DAILY REPORT" meta={<span><IconCloud size={14} />每天 08:00 自动同步</span>} title="日报" actions={<><label className="page-header__date">日报日期<CalendarPicker value={date} onChange={setDate} /></label><button className="work-button" disabled={!user || syncing} onClick={syncLogs} type="button"><IconRefresh size={15} />{syncing ? "同步中…" : "同步日志"}</button></>} />
    {!user ? <div className="work-notice"><span className="status-dot status-dot--warn" /><div><strong>尚未登录团队日报</strong><span>前往<Link to="/system">系统状态</Link>登录后即可查看钉钉日报。</span></div></div> : null}
    <DingTalkSyncStatus label="钉钉日志" status={dingtalkStatus} />
    {error ? <div className="work-error" role="alert">{error}</div> : null}
    <div className="daily-report-layout">
      <section className="daily-source-panel">
        <div className="daily-section-head"><div><h2>今日完成工作</h2><p>钉钉日志中的完成项 + 今日完成的工作台任务</p></div><span>{doneEntries.length} 项</span></div>
        {doneEntries.length ? <ul className="daily-done-list">{doneEntries.map((entry, index) => <li className="daily-done-entry" key={`${entry.badge}-${index}`}><span className={`daily-done-badge is-${entry.tone}`}>{entry.badge}</span><span>{entry.text}</span></li>)}</ul> : <div className="today-side-empty">今天还没有完成的工作记录。{user ? "在钉钉填写日报或在工作台完成任务后会自动同步到这里。" : "登录后即可查看钉钉日报。"}</div>}
      </section>
      <section className="daily-draft-panel">
        {report ? <>
          <div className="daily-section-head"><div><h2>钉钉日报详情</h2><p>{report.templateName || "日报"} · {report.submittedAt ? `创建于 ${new Date(report.submittedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "已同步"}{report.remark ? ` · 备注：${report.remark}` : ""}</p></div><span>已同步</span></div>
          <dl className="daily-report-fields">
            <div><dt>今日遗留工作</dt><dd>{report.blockers || "无"}</dd></div>
            <div><dt>明日工作计划</dt><dd>{report.nextActions || "无"}</dd></div>
            <div><dt>需要协作工作</dt><dd>{report.cooperationNeeds || "无"}</dd></div>
          </dl>
          {(images.length || attachments.length) ? <div className="daily-report-attachments">
            {images.length ? <span><IconPhoto size={14} />图片 {images.length} 张</span> : null}
            {attachments.length ? <ul>{attachments.map((item, index) => <li key={String(item.fileId || index)}><IconFileText size={14} />{item.fileName || "附件"}{item.fileSize ? ` · ${formatSize(item.fileSize)}` : ""}</li>)}</ul> : null}
          </div> : null}
        </> : user ? <div className="report-empty"><strong>今天还没有钉钉日志</strong><span>在钉钉应用中填写「日报」后，这里会自动展示，无需在工作台手动填写。</span></div> : <div className="report-empty"><strong>登录后查看钉钉日报</strong></div>}
      </section>
    </div>
    <section className="daily-history"><div className="daily-history__head"><div><h2><IconHistory size={19} />历史日报</h2></div><span>{history.length} 条记录</span></div>{user ? <div className="team-reports-layout"><div>{selectedHistory ? <article className="team-report-card"><div className="team-report-card__head"><strong>{selectedHistory.reportDate}</strong><time>{selectedHistory.submittedAt ? new Date(selectedHistory.submittedAt).toLocaleString("zh-CN") : "已同步"}</time></div><h3>{selectedHistory.summary}</h3><dl><div><dt>阻塞</dt><dd>{selectedHistory.blockers || "无"}</dd></div><div><dt>下一步</dt><dd>{selectedHistory.nextActions || "无"}</dd></div><div><dt>协作</dt><dd>{selectedHistory.cooperationNeeds || "无"}</dd></div></dl></article> : <div className="report-empty"><strong>选择有记录的日期查看日报</strong></div>}</div><WorkbenchCalendar ariaLabel="历史日报日历" selectedDate={date} reportDates={reportDates} onSelect={setDate} /></div> : <div className="report-empty"><strong>登录后查看历史日报</strong></div>}</section>
  </div>;
}
