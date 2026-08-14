import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { IconCalendarEvent, IconCheck, IconChevronRight, IconMail, IconPlus, IconRefresh, IconTargetArrow } from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import { TaskDialog } from "../components/TaskForm";
import { createTask, loadDingTalkEvents, loadDingTalkStatus, loadOutlookTodos, loadTasks, loadWeeklyFocus, updateTask } from "../lib/api";
import { DingTalkSyncStatus } from "../components/DingTalkSyncStatus";
import { getDailyReport, getDailyReportUser, subscribeDailyReportAuth, syncDingTalkReports } from "../lib/daily-reports";
import { groupActions, mailAsAction, taskAsAction, localDateKey } from "../lib/work-loop";

// 将钉钉"明日工作计划"多行文本拆分为独立任务标题（去除序号前缀、空行与“无”）
function splitPlanLines(value) {
  return String(value || "").split(/\r?\n|[；;]/).map((item) => item.replace(/^[-*•\d.、\s]+/, "").trim()).filter((item) => item && item !== "无");
}

const formatTime = (value) => value ? new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "待定";
const formatDue = (value) => {
  if (!value) return "未设截止";
  const date = new Date(value);
  const today = localDateKey();
  const dateKey = String(value).slice(0, 10);
  const time = Number.isNaN(date.getTime()) ? String(value).slice(11, 16) : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return dateKey === today ? `今天 ${time}` : `${dateKey.slice(5).replace("-", "月")}日 ${time}`;
};

const flow = [
  { label: "日程/邮件", hint: "自动识别", to: "/outlook" },
  { label: "今日待办", hint: "正在处理", to: "/" },
  { label: "本周目标", hint: "保持聚焦", to: "/weekly-focus" },
  { label: "日报", hint: "钉钉同步", to: "/daily-report" },
  { label: "周报", hint: "沉淀进展", to: "/weekly-report" },
];

export function TodayWorkPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [mails, setMails] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [focus, setFocus] = useState([]);
  const [user, setUser] = useState(null);
  const [dingtalkStatus, setDingtalkStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const today = localDateKey();

  useEffect(() => {
    getDailyReportUser().then((result) => setUser(result?.user || result)).catch(() => {});
    return subscribeDailyReportAuth((next) => setUser(next));
  }, []);
  useEffect(() => { loadDingTalkStatus().then((result) => setDingtalkStatus(result.data || result)).catch(() => {}); }, []);

  // 将昨日钉钉日报中的“明日工作计划”分条自动创建为任务（去重幂等），返回是否有新建
  const importDingtalkPlans = useCallback(async (existingTasks) => {
    if (!user) return false;
    const existingKeys = new Set(existingTasks.map((task) => `${task.sourceType}:${task.sourceId}`));
    const day = new Date();
    day.setDate(day.getDate() - 1);
    const dateKey = localDateKey(day);
    const report = await getDailyReport(dateKey).catch(() => null);
    const lines = splitPlanLines(report?.nextActions);
    if (!lines.length) return false;
    let created = false;
    for (const [index, title] of lines.entries()) {
      const sourceKey = report.dingtalkReportId ? `${report.dingtalkReportId}:${index}` : `${dateKey}:${index}`;
      if (existingKeys.has(`dingtalk_plan:${sourceKey}`)) continue;
      await createTask({ title, priority: "P1", detail: `来自钉钉日报（${dateKey}）的明日工作计划`, sourceType: "dingtalk_plan", sourceId: sourceKey });
      created = true;
    }
    return created;
  }, [user]);

  const refresh = useCallback(async () => {
    const [taskResult, mailResult, meetingResult, focusResult] = await Promise.allSettled([
      loadTasks("open"),
      loadOutlookTodos(),
      loadDingTalkEvents({ from: today, to: today }),
      loadWeeklyFocus(today),
    ]);
    if (taskResult.status === "fulfilled") setTasks(taskResult.value.items || []);
    if (mailResult.status === "fulfilled") setMails(mailResult.value.items || mailResult.value.data?.items || []);
    if (meetingResult.status === "fulfilled") setMeetings(meetingResult.value.items || meetingResult.value.data?.items || []);
    if (focusResult.status === "fulfilled") setFocus(focusResult.value.items || []);
    if (user) {
      const currentTasks = taskResult.status === "fulfilled" ? (taskResult.value.items || []) : [];
      const imported = await importDingtalkPlans(currentTasks);
      if (imported) {
        const again = await loadTasks("open").catch(() => ({ items: null }));
        if (Array.isArray(again.items)) setTasks(again.items);
      }
    }
    const failure = [taskResult, mailResult, meetingResult, focusResult].find((result) => result.status === "rejected");
    setError(failure?.reason?.message || "");
  }, [today, user, importDingtalkPlans]);

  useEffect(() => { void refresh(); }, [refresh]);
  const actions = useMemo(() => [...tasks.map(taskAsAction), ...mails.map(mailAsAction)], [tasks, mails]);
  const groups = useMemo(() => groupActions(actions), [actions]);
  const nextMeeting = useMemo(() => meetings.filter((item) => Date.parse(item.endAt || item.startAt) > Date.now()).sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)))[0], [meetings]);
  const topMails = mails.slice(0, 2);
  const complete = async (item) => {
    if (item.actionKind === "outlook-message") { navigate("/outlook"); return; }
    setBusy(true); setError("");
    try { await updateTask(item.id, { status: "completed" }); await refresh(); }
    catch (failure) { setError(failure.message || "任务更新失败"); }
    finally { setBusy(false); }
  };
  const create = async (payload) => {
    setBusy(true); setError("");
    try { await createTask(payload); setAdding(false); await refresh(); }
    catch (failure) { setError(failure.message || "任务创建失败"); }
    finally { setBusy(false); }
  };
  const syncLogs = async () => {
    if (!user) { navigate("/system"); return; }
    setBusy(true); setError("");
    try { await syncDingTalkReports({ scope: "today-work", date: today }); await Promise.all([refresh(), loadDingTalkStatus().then((result) => setDingtalkStatus(result.data || result))]); }
    catch (failure) { setError(failure.message || "钉钉日志同步失败"); }
    finally { setBusy(false); }
  };

  return <div className="page today-work-page">
    <PageHeader actions={<><button className="work-button" disabled={busy} onClick={syncLogs} type="button"><IconRefresh size={16} />{busy ? "同步中…" : "同步日志"}</button><button className="work-button work-button--primary" disabled={busy} onClick={() => setAdding(true)} type="button"><IconPlus size={16} />新建任务</button></>} description={`你有 ${actions.length} 项待处理工作，${focus.length} 个本周目标正在推进。`} eyebrow="WORK / TODAY" meta={<span>{new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "long" })}</span>} title="今日工作" />
    {adding && <TaskDialog busy={busy} onSubmit={create} onClose={() => { if (!busy) setAdding(false); }} />}
    {error ? <div className="work-error" role="alert">{error}</div> : null}
    <DingTalkSyncStatus label="钉钉日志" status={dingtalkStatus} />
    <div className="today-work-grid">
      <section className="today-action-table" aria-label="今日行动">
        <div className="today-action-head"><span>任务事项</span><span>来源</span><span>截止时间</span><span>优先级原因</span></div>
        {groups.length ? groups.map((group) => <div className="today-action-group" key={group.id}>
          <div className={`today-action-group__label is-${group.tone}`}><i />{group.label}<small>{group.items.length}</small></div>
          {group.items.map((item) => <div className="today-action-row" key={item.id}>
            <button aria-label={`完成 ${item.title}`} className="today-action-check" disabled={busy} onClick={() => complete(item)} type="button"><IconCheck size={13} /></button>
            <button className="today-action-title" onClick={() => item.actionKind === "outlook-message" ? navigate("/outlook") : navigate("/todos")} type="button"><strong>{item.title}</strong><small>{item.detail}</small></button>
            <span>{item.source}</span><time>{formatDue(item.dueAt)}</time><span className="today-action-reason"><b>{item.priority}</b>{item.priorityReason}</span>
          </div>)}
        </div>) : <div className="today-work-empty"><IconCheck size={24} /><strong>今天的行动已清空</strong><span>新任务和邮件行动会自动出现在这里。</span></div>}
      </section>
      <aside className="today-work-side">
        <section className="today-side-panel"><div className="today-side-panel__head"><h2><IconCalendarEvent size={19} />下一场会议</h2></div>{nextMeeting ? <><div className="today-meeting-time"><strong>{formatTime(nextMeeting.startAt)} – {formatTime(nextMeeting.endAt)}</strong><span>今天 {formatTime(nextMeeting.startAt)}</span></div><h3>{nextMeeting.title}</h3><p>{[nextMeeting.location, nextMeeting.organizer, nextMeeting.attendees?.length ? `${nextMeeting.attendees.length} 位参与人` : ""].filter(Boolean).join(" · ")}</p></> : <div className="today-side-empty">今天暂无后续会议</div>}<Link className="work-link" to="/meetings">查看日程<IconChevronRight size={14} /></Link></section>
        <section className="today-side-panel"><div className="today-side-panel__head"><h2><IconMail size={19} />待回复邮件</h2><span>{mails.length} 封需要行动</span></div>{topMails.length ? topMails.map((mail) => <button className="today-mail-preview" key={mail.id} onClick={() => navigate("/outlook")} type="button"><i /><span><strong>{mail.subject}</strong><small>{mail.sender} · {mail.actionText}</small></span><time>{formatTime(mail.receivedAt)}</time></button>) : <div className="today-side-empty">暂无待回复邮件</div>}<Link className="work-link" to="/outlook">进入行动收件箱<IconChevronRight size={14} /></Link></section>
      </aside>
    </div>
    <section className="work-loop-rail"><h2>工作推进路径</h2><div>{flow.map((item, index) => <button className={index === 1 ? "is-current" : ""} key={item.label} onClick={() => navigate(item.to)} type="button"><span>{index === 2 ? <IconTargetArrow size={19} /> : index + 1}</span><strong>{item.label}</strong><small>{item.hint}</small></button>)}</div></section>
  </div>;
}
