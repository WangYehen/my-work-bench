import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { IconCalendarEvent, IconCheck, IconCloud, IconClock, IconHistory, IconMail, IconSend, IconSparkles, IconSquareCheck } from "@tabler/icons-react";
import { CalendarPicker, WorkbenchCalendar } from "../components/WorkbenchCalendar";
import { PageHeader } from "../components/PageHeader";
import { generateDailyReportDraft, loadDingTalkEvents, loadOutlookAll, loadTasks } from "../lib/api";
import { getDailyReport, getDailyReportUser, loadOwnDailyReports, saveDailyReport, subscribeDailyReportAuth, submitDailyReport } from "../lib/daily-reports";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).format(new Date());
const emptyReport = (reportDate) => ({ reportDate, summary: "", completedItems: "", blockers: "", nextActions: "" });
const sourceIcon = { task: IconSquareCheck, meeting: IconCalendarEvent, email: IconMail };

function SourceRow({ item }) { const Icon = sourceIcon[item.type]; return <li><Icon size={16} /><span><strong>{item.title}</strong><small>{item.meta}</small></span></li>; }

export function DailyReportPage() {
  const [date, setDate] = useState(today());
  const [report, setReport] = useState(() => emptyReport(today()));
  const [user, setUser] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);
  const [editing, setEditing] = useState(true);
  const [sources, setSources] = useState([]);
  const [draftSource, setDraftSource] = useState("");
  const [touched, setTouched] = useState(false);
  const isElectron = Boolean(globalThis.window?.workbench?.dailyReports);

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

  const loadWorkData = useCallback(async (reportDate) => {
    const [taskResult, meetingResult, mailResult] = await Promise.allSettled([
      loadTasks("all"), loadDingTalkEvents({ from: reportDate, to: reportDate }), loadOutlookAll(),
    ]);
    const tasks = taskResult.status === "fulfilled" ? (taskResult.value.items || []).filter((item) => item.completedAt?.slice(0, 10) === reportDate) : [];
    const meetings = meetingResult.status === "fulfilled" ? (meetingResult.value.items || meetingResult.value.data?.items || []).filter((item) => item.endAt && item.endAt.slice(0, 10) === reportDate && Date.parse(item.endAt) <= Date.now()) : [];
    const emails = mailResult.status === "fulfilled" ? (mailResult.value.items || mailResult.value.data?.items || []).filter((item) => ["processed", "converted"].includes(item.status) && item.updatedAt?.slice(0, 10) === reportDate) : [];
    const nextSources = [
      ...tasks.map((item) => ({ type: "task", title: item.title, meta: `任务 · ${item.completedAt ? new Date(item.completedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "今日完成"}` })),
      ...meetings.map((item) => ({ type: "meeting", title: item.title, meta: `会议 · ${item.organizer || "钉钉日程"}` })),
      ...emails.map((item) => ({ type: "email", title: item.actionText || item.subject, meta: `邮件 · ${item.sender}` })),
    ];
    setSources(nextSources);
    return { tasks, meetings, emails, nextSources };
  }, []);

  const generate = useCallback(async (force = false) => {
    if (touched && !force && !globalThis.confirm("重新生成会覆盖当前编辑内容，是否继续？")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const workData = await loadWorkData(date);
      const draft = await generateDailyReportDraft({ reportDate: date, tasks: workData.tasks, meetings: workData.meetings, emails: workData.emails });
      setReport((current) => ({ ...current, ...draft, reportDate: date }));
      setDraftSource(draft.source || "ai"); setTouched(false);
      setMessage(draft.source === "rules" ? "AI 暂不可用，已生成规则版草稿。" : "AI 日报草稿已生成，请核对后提交。");
    } catch (failure) { setError(failure.message || "日报草稿生成失败"); }
    finally { setBusy(false); }
  }, [date, loadWorkData, touched]);

  useEffect(() => {
    setTouched(false); setDraftSource(""); setEditing(true); setMessage("");
    Promise.all([getDailyReport(date).catch(() => null), loadWorkData(date)]).then(([saved, workData]) => {
      if (saved) { setReport({ ...emptyReport(date), ...saved }); setEditing(false); }
      else {
        setReport(emptyReport(date));
        if (workData.nextSources.length) void generate(false);
      }
    }).catch((failure) => setError(failure.message || "日报加载失败"));
  }, [date]);

  const set = (key, value) => { setTouched(true); setReport((current) => ({ ...current, [key]: value })); };
  const save = async (submit = false) => {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = submit ? await submitDailyReport(report) : await saveDailyReport(report);
      const next = { ...report, ...result, reportDate: date, syncStatus: result.syncStatus || (submit ? "synced" : "draft") };
      setReport(next);
      if (submit) { setHistory((current) => [next, ...current.filter((item) => item.reportDate !== date)].sort((a, b) => b.reportDate.localeCompare(a.reportDate))); setEditing(false); }
      setMessage(submit ? `日报已提交给 ${result.recipient?.displayName || user?.reportRecipient?.displayName || "直属上级"}，${result.syncStatus === "pending_sync" ? "等待同步" : "已同步"}。` : "草稿已保存到本机。");
    } catch (failure) { setError(failure.message || "日报保存失败"); }
    finally { setBusy(false); }
  };

  const reportDates = useMemo(() => new Set(history.map((item) => item.reportDate)), [history]);
  const selectedHistory = history.find((item) => item.reportDate === date);
  const statusLabel = report.syncStatus === "synced" ? "已同步" : report.syncStatus === "error" ? "待重试" : "本机草稿";

  return <div className="page daily-report-v2">
    <PageHeader eyebrow="WORK / DAILY REPORT" title="日报" description="系统已整理今天的工作数据，预计两分钟完成总结与提交。" meta={<span><IconCloud size={14} />{isElectron ? statusLabel : "Web 端同步"}</span>} actions={<label className="page-header__date">日报日期<CalendarPicker value={date} onChange={setDate} /></label>} />
    {!user ? <div className="work-notice"><span className="status-dot status-dot--warn" /><div><strong>尚未登录团队日报</strong><span>前往<Link to="/system">系统状态</Link>登录后即可提交。</span></div></div> : <div className="daily-report-recipient"><div><strong>提交人：{user.displayName || user.username}</strong><span>接收人：{user.reportRecipient?.displayName || "直属上级 / 组织管理员"}</span></div><span>{report.submittedAt ? `提交于 ${new Date(report.submittedAt).toLocaleString("zh-CN")}` : "尚未提交"}</span></div>}
    <div className="daily-report-layout">
      <section className="daily-source-panel"><div className="daily-section-head"><div><h2>今日工作数据</h2><p>来自已完成任务、已结束会议和已处理邮件</p></div><span>{sources.length} 条来源</span></div>{sources.length ? <ul>{sources.map((item, index) => <SourceRow item={item} key={`${item.type}-${index}`} />)}</ul> : <div className="today-side-empty">今天暂无可自动带入的数据，你仍可手动填写日报。</div>}<div className="daily-completed-preview"><strong>自动生成的已完成事项</strong><pre>{report.completedItems || "暂无完成记录"}</pre></div></section>
      <section className="daily-draft-panel"><div className="daily-section-head"><div><h2>AI 日报草稿</h2><p>{draftSource === "rules" ? "规则版草稿" : "基于今日工作数据生成，可自由修改"}</p></div><button className="work-button" disabled={busy} onClick={() => generate(true)} type="button"><IconSparkles size={15} />{busy ? "生成中…" : "重新生成"}</button></div>{editing ? <div className="daily-report-form daily-report-form--v2"><label><span>今日总结</span><textarea required maxLength={10000} value={report.summary} onChange={(event) => set("summary", event.target.value)} /></label><label><span>阻塞与风险</span><textarea maxLength={10000} placeholder="没有阻塞可以填写“无”" value={report.blockers} onChange={(event) => set("blockers", event.target.value)} /></label><label><span>下一步行动</span><textarea maxLength={10000} value={report.nextActions} onChange={(event) => set("nextActions", event.target.value)} /></label></div> : <article className="daily-submitted-preview"><h3>{report.summary}</h3><dl><div><dt>阻塞与风险</dt><dd>{report.blockers || "无"}</dd></div><div><dt>下一步行动</dt><dd>{report.nextActions || "无"}</dd></div></dl><button className="work-button" onClick={() => setEditing(true)} type="button">编辑此日报</button></article>}</section>
    </div>
    {error ? <div className="work-error" role="alert">{error}</div> : null}{message ? <div className="report-success"><IconCheck size={15} />{message}</div> : null}
    {editing ? <div className="daily-report-actions"><button className="work-button" disabled={busy} onClick={() => save(false)} type="button">保存草稿</button><button className="work-button work-button--primary" disabled={busy || !user || !report.summary.trim()} onClick={() => save(true)} type="button"><IconSend size={15} />一键提交给直属上级</button></div> : null}
    <section className="daily-history"><div className="daily-history__head"><div><h2><IconHistory size={19} />历史日报</h2></div><span>{history.length} 条记录</span></div>{user ? <div className="team-reports-layout"><div>{selectedHistory ? <article className="team-report-card"><div className="team-report-card__head"><strong>{selectedHistory.reportDate}</strong><time>{selectedHistory.syncStatus === "synced" ? "已同步" : "已提交"}</time></div><h3>{selectedHistory.summary}</h3></article> : <div className="report-empty"><strong>选择有记录的日期查看日报</strong></div>}</div><WorkbenchCalendar ariaLabel="历史日报日历" selectedDate={date} reportDates={reportDates} onSelect={setDate} /></div> : <div className="report-empty"><strong>登录后查看历史日报</strong></div>}</section>
  </div>;
}
