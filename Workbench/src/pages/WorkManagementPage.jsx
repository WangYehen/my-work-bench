import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  IconCalendarEvent, IconCheck, IconChecklist, IconCircle, IconEdit,
  IconChevronDown, IconFileText, IconNotes, IconPlus, IconRefresh, IconSparkles, IconTrash, IconX,
} from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import { TaskForm } from "../components/TaskForm";
import { buildWeeklyReport, workSnapshot } from "../data/work-management";
import {
  clearCompletedTasks, createTask, deleteTask, loadOutlookTodos, loadTasks,
  updateTask, generateWeeklyAiSummary, loadWeeklyFocus, createWeeklyFocus,
  updateWeeklyFocus, deleteWeeklyFocus, attachTaskToWeeklyFocus, detachTaskFromWeeklyFocus,
} from "../lib/api";
import { getDailyReportUser, loadOwnDailyReports, subscribeDailyReportAuth } from "../lib/daily-reports";

const moduleCopy = {
  todos: { eyebrow: "TODAY / ACTIONS", title: "今日待办", description: "汇总今天需要推进的行动，完成后即可从工作节奏中移出。", icon: IconChecklist },
  focus: { eyebrow: "WEEK / FOCUS", title: "本周重要想法 / 关注点", description: "把本周值得持续投入注意力的目标、判断和复盘点留在同一个视图。", icon: IconNotes },
  meetings: { eyebrow: "DINGTALK / CALENDAR", title: "会议日程", description: "按今天的节奏查看会议与准备事项。", icon: IconCalendarEvent },
  reports: { eyebrow: "WEEKLY / REPORT", title: "周报与 AI 总结", description: "聚合本周任务、会议和关注点，生成可导出的 Markdown 周报。", icon: IconFileText },
};

function IntegrationNotice({ service, detail }) {
  return <div className="work-notice"><span className="status-dot status-dot--warn" /><div><strong>{service} 待授权</strong><span>{detail}</span></div><span className="badge">本地示例</span></div>;
}

const emptyForm = { title: "", detail: "", priority: "P1", dueAt: "" };

function TaskRow({ task, onToggle, onEdit, onDelete, pending }) {
  const remote = task.source === "dingtalk";
  const due = task.dueAt ? new Date(task.dueAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  if (remote) return <article className={`work-task work-task--${task.priority.toLowerCase()}${task.status === "completed" ? " work-task--done" : ""}`}><span className="work-task__toggle" aria-hidden="true">{task.status === "completed" ? <IconCheck size={14} /> : <IconCircle size={13} />}</span><div className="work-task__copy"><strong>{task.title}</strong><small>{[task.detail, due ? `截止 ${due}` : null].filter(Boolean).join(" · ") || "来自钉钉待办"}</small></div><span className={`work-priority work-priority--${task.priority.toLowerCase()}`}>{task.priority}</span><span className="badge">钉钉</span></article>;
  return <article className={`work-task work-task--${task.priority.toLowerCase()}${task.status === "completed" ? " work-task--done" : ""}`}>
    <button className="work-task__toggle" disabled={pending} aria-label={task.status === "completed" ? "恢复任务" : "完成任务"} onClick={() => onToggle(task)} type="button">{task.status === "completed" ? <IconCheck size={14} /> : <IconCircle size={13} />}</button>
    <div className="work-task__copy"><strong>{task.title}</strong><small>{[task.detail, due ? `截止 ${due}` : null].filter(Boolean).join(" · ") || "暂无补充说明"}</small></div>
    <span className={`work-priority work-priority--${task.priority.toLowerCase()}`}>{task.priority}</span>
    <div className="work-task__actions"><button aria-label="编辑任务" disabled={pending} onClick={() => onEdit(task)} type="button"><IconEdit size={15} /></button><button aria-label="删除任务" disabled={pending} onClick={() => onDelete(task)} type="button"><IconTrash size={15} /></button></div>
  </article>;
}

function TodoModule() {
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const describeDingTalkTodoError = (failure) => {
    if (["DINGTALK_TOKEN_EXCHANGE_FAILED", "DINGTALK_TOKEN_EXPIRED", "DINGTALK_NOT_CONNECTED"].includes(failure?.code)) {
      return "钉钉应用权限已开通，但当前授权令牌未刷新。请前往钉钉日程与待办页面重新授权后再试。";
    }
    if (failure?.code === "DINGTALK_TODO_REQUEST_FAILED") {
      if (/ip.*白名单|白名单.*ip/i.test(failure?.message || "")) {
        const requestIp = String(failure.message).match(/request ip=([^\s,]+)/i)?.[1];
        return `钉钉待办权限已通过，但当前出口 IP${requestIp ? ` ${requestIp}` : ""} 不在应用白名单中。请在钉钉开放平台的应用安全设置中添加该 IP。`;
      }
      return "钉钉待办接口仍拒绝访问，请确认 Todo.Todo.Read 已开通，并重新授权当前账号。";
    }
    if (failure?.code === "DINGTALK_APP_TOKEN_REQUEST_FAILED") return "钉钉应用令牌获取失败，请检查 AppKey 与 AppSecret。";
    if (failure?.code === "DINGTALK_TODO_REQUEST_FAILED" && failure?.details?.status === 403) return "钉钉待办接口拒绝访问，请确认当前账号已授权 Todo.Todo.Read 权限。";
    return "钉钉待办暂时无法读取，请检查应用权限和授权状态。";
  };
  const refresh = () => loadTasks().then((data) => setTasks(data.items || [])).catch((err) => setError(err.message || "任务加载失败"));
  useEffect(() => { refresh(); }, []);
  const allTasks = tasks;
  const visible = useMemo(() => allTasks.filter((task) => filter === "all" || task.status === filter), [allTasks, filter]);
  const remaining = allTasks.filter((task) => task.status === "open").length;
  const run = async (action) => { setPending(true); setError(""); try { await action(); await refresh(); } catch (err) { setError(err.message || "操作失败"); } finally { setPending(false); } };
  const save = (payload) => run(async () => { if (editing) await updateTask(editing.id, payload); else await createTask(payload); setEditing(null); setAdding(false); });
  const remove = (task) => { if (window.confirm(`确认删除“${task.title}”吗？`)) run(() => deleteTask(task.id)); };
  return <>
    <div className="work-summary-strip"><div className="work-summary-strip__count"><strong>{remaining}</strong><span>项待完成</span></div><span className="work-summary-strip__hint">今天优先处理 P0 事项</span><button className="work-button work-button--primary" onClick={() => { setAdding(true); setEditing(null); }} type="button"><IconPlus size={15} />新增待办</button></div>
    {(adding || editing) && <TaskForm initial={editing || emptyForm} busy={pending} onSubmit={save} onCancel={() => { setAdding(false); setEditing(null); }} />}
    <div className="todo-toolbar"><div className="todo-filters">{[["all", "全部"], ["open", "未完成"], ["completed", "已完成"]].map(([key, label]) => <button className={filter === key ? "is-active" : ""} key={key} onClick={() => setFilter(key)} type="button">{label}</button>)}</div><button className="work-link" disabled={pending || !tasks.some((task) => task.status === "completed")} onClick={() => window.confirm("确认清除全部已完成任务吗？") && run(clearCompletedTasks)} type="button"><IconTrash size={14} />清除已完成</button></div>
    {error && <div className="work-error" role="alert">{error}<button onClick={refresh} type="button">重试</button></div>}
    <section className="work-card-list" aria-label="今日待办列表">{visible.length ? visible.map((task) => <TaskRow key={task.id} task={task} pending={pending} onToggle={(item) => run(() => updateTask(item.id, { status: item.status === "completed" ? "open" : "completed" }))} onEdit={(item) => { setEditing({ ...item, dueAt: item.dueAt ? item.dueAt.slice(0, 16) : "" }); setAdding(false); }} onDelete={remove} />) : <div className="report-empty"><IconChecklist size={24} /><strong>暂无待办</strong><span>点击“新增待办”创建今天的第一项行动。</span></div>}</section>
  </>;
}

const focusEmptyForm = { title: "", detail: "", progress: 0, nextStep: "", status: "active" };

function getWeekStart(date = new Date()) {
  const value = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = value.getDay() || 7;
  value.setDate(value.getDate() - day + 1);
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
}

function formatFocusDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function FocusForm({ initial = focusEmptyForm, onSubmit, onCancel, busy }) {
  const [form, setForm] = useState(initial);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return <form className="focus-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ ...form, progress: Number(form.progress) }); }}>
    <label><span>关注目标</span><input autoFocus={!initial.id} required maxLength={200} placeholder="例如：守住本周交付节奏" value={form.title} onChange={(event) => set("title", event.target.value)} /></label>
    <label><span>说明</span><textarea maxLength={2000} placeholder="为什么重要？本周要看住什么？" value={form.detail || ""} onChange={(event) => set("detail", event.target.value)} /></label>
    <label><span>下一步</span><input maxLength={1000} placeholder="例如：今天完成路线确认" value={form.nextStep || ""} onChange={(event) => set("nextStep", event.target.value)} /></label>
    <label className="focus-form__progress"><span>进度 <b>{form.progress}%</b></span><input type="range" min="0" max="100" step="5" value={form.progress} onChange={(event) => set("progress", event.target.value)} /></label>
    <label><span>状态</span><select value={form.status} onChange={(event) => set("status", event.target.value)}><option value="active">进行中</option><option value="completed">已完成</option></select></label>
    <div className="focus-form__actions"><button className="work-button work-button--primary" disabled={busy} type="submit"><IconCheck size={15} />{initial.id ? "保存目标" : "添加目标"}</button>{onCancel && <button className="work-button" type="button" onClick={onCancel}>取消</button>}</div>
  </form>;
}

function FocusDialog({ initial, onSubmit, onClose, busy }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  return <div className="focus-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section aria-labelledby="focus-dialog-title" aria-modal="true" className="focus-modal" role="dialog">
      <header className="focus-modal__header">
        <div><span className="eyebrow">WEEK / FOCUS</span><h2 id="focus-dialog-title">{initial?.id ? "编辑关注" : "新增关注"}</h2><p>记录本周最值得持续投入注意力的目标与下一步。</p></div>
        <button aria-label="关闭弹窗" className="focus-modal__close" disabled={busy} onClick={onClose} type="button"><IconX size={19} /></button>
      </header>
      <FocusForm initial={initial || focusEmptyForm} busy={busy} onSubmit={onSubmit} onCancel={onClose} />
    </section>
  </div>;
}

function FocusTaskPicker({ tasks, onAttach, onCreate, busy }) {
  const [taskId, setTaskId] = useState("");
  const [open, setOpen] = useState(false);
  const selected = tasks.find((task) => task.id === taskId);
  return <div className="focus-task-picker">
    <div className={`focus-task-picker__select${open ? " is-open" : ""}`}>
      <button aria-expanded={open} aria-haspopup="listbox" className="focus-task-picker__trigger" onClick={() => setOpen((value) => !value)} type="button"><span>{selected?.title || "关联已有任务…"}</span><IconChevronDown size={13} /></button>
      {open && <div className="focus-task-picker__menu" role="listbox"><button className={!selected ? "is-selected" : ""} onClick={() => { setTaskId(""); setOpen(false); }} role="option" type="button">关联已有任务…</button>{tasks.map((task) => <button aria-selected={task.id === taskId} className={task.id === taskId ? "is-selected" : ""} key={task.id} onClick={() => { setTaskId(task.id); setOpen(false); }} role="option" type="button">{task.title}</button>)}</div>}
    </div>
    <button className="work-button" disabled={busy || !taskId} onClick={() => { onAttach(taskId); setTaskId(""); }} type="button">关联</button>
    <button className="work-link" disabled={busy} onClick={onCreate} type="button"><IconPlus size={14} />新建行动</button>
  </div>;
}

function FocusCard({ item, availableTasks, onEdit, onDelete, onUpdate, onAttach, onDetach, onCreateTask, pending }) {
  const done = item.completedTaskCount || 0;
  const progress = item.effectiveProgress ?? item.progress;
  return <article className={`focus-card focus-card--${item.status}`}>
    <div className="focus-card__top"><span className="badge badge--accent">{item.status === "completed" ? "已完成" : "进行中"}</span><span className="focus-card__number">{String(progress).padStart(2, "0")}%</span></div>
    <h2>{item.title}</h2>
    <p>{item.detail || "还没有补充说明。"}</p>
    <div className="focus-progress" aria-label={`目标进度 ${progress}%`}><span style={{ width: `${progress}%` }} /></div>
    <div className="focus-card__meta"><span>行动 {done}/{item.tasks.length}</span><span>{item.nextStep ? `下一步：${item.nextStep}` : "尚未填写下一步"}</span></div>
    <div className="focus-actions"><button className="work-link" disabled={pending} onClick={() => onUpdate(item, { status: item.status === "completed" ? "active" : "completed" })} type="button"><IconCheck size={14} />{item.status === "completed" ? "恢复进行中" : "标记完成"}</button><span><button aria-label="编辑目标" disabled={pending} onClick={() => onEdit(item)} type="button"><IconEdit size={15} /></button><button aria-label="删除目标" disabled={pending} onClick={() => onDelete(item)} type="button"><IconTrash size={15} /></button></span></div>
    {item.tasks.length ? <div className="focus-task-list">{item.tasks.map((task) => <div className={`focus-task${task.status === "completed" ? " is-done" : ""}`} key={task.id}><button aria-label={task.status === "completed" ? "恢复行动" : "完成行动"} disabled={pending} onClick={() => onUpdate(task, { status: task.status === "completed" ? "open" : "completed" }, true)} type="button">{task.status === "completed" ? <IconCheck size={12} /> : <IconCircle size={12} />}</button><span>{task.title}</span><button aria-label="移除关联行动" disabled={pending} onClick={() => onDetach(item.id, task.id)} type="button"><IconTrash size={12} /></button></div>)}</div> : null}
    <FocusTaskPicker tasks={availableTasks} busy={pending} onAttach={(taskId) => onAttach(item.id, taskId)} onCreate={() => onCreateTask(item.id)} />
  </article>;
}

function FocusModule() {
  const weekStart = useMemo(() => getWeekStart(), []);
  const [items, setItems] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      const [focusResult, taskResult] = await Promise.all([loadWeeklyFocus(weekStart), loadTasks()]);
      setItems(focusResult.items || []);
      setTasks(taskResult.items || []);
      setError("");
    } catch (err) { setError(err.message || "本周关注加载失败"); } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);
  const run = async (action) => { setPending(true); setError(""); try { await action(); await refresh(); } catch (err) { setError(err.message || "操作失败"); } finally { setPending(false); } };
  const save = (payload) => run(async () => { if (editing) await updateWeeklyFocus(editing.id, payload); else await createWeeklyFocus({ ...payload, weekStart }); setEditing(null); setAdding(false); });
  const remove = (item) => { if (window.confirm(`确认删除“${item.title}”吗？`)) run(() => deleteWeeklyFocus(item.id)); };
  const linkedTaskIds = new Set(items.flatMap((item) => item.taskIds || []));
  const availableTasks = tasks.filter((task) => !linkedTaskIds.has(task.id));
  const completedGoals = items.filter((item) => item.status === "completed").length;
  const allTasks = items.flatMap((item) => item.tasks || []);
  const actionProgress = allTasks.length ? Math.round(allTasks.filter((task) => task.status === "completed").length / allTasks.length * 100) : 0;
  const createAction = (focusId) => {
    const title = window.prompt("行动名称");
    if (title?.trim()) run(async () => { const task = await createTask({ title: title.trim(), detail: "来自本周关注", priority: "P1" }); await attachTaskToWeeklyFocus(focusId, task.id); });
  };
  return <>
    <div className="focus-summary"><div><span className="eyebrow">CURRENT WEEK</span><strong>{formatFocusDate(weekStart)} – {formatFocusDate(new Date(new Date(`${weekStart}T00:00:00`).getTime() + 6 * 86400000).toISOString().slice(0, 10))}</strong></div><div className="focus-summary__stats"><span><b>{completedGoals}/{items.length}</b>目标完成</span><span><b>{actionProgress}%</b>行动完成</span></div><button className="work-button work-button--primary" onClick={() => { setAdding(true); setEditing(null); }} type="button"><IconPlus size={15} />新增关注</button></div>
    {(adding || editing) && <FocusDialog initial={editing || focusEmptyForm} busy={pending} onSubmit={save} onClose={() => { setAdding(false); setEditing(null); }} />}
    {error && <div className="work-error" role="alert">{error}<button onClick={refresh} type="button">重试</button></div>}
    {loading ? <div className="report-empty"><IconRefresh size={24} /><strong>正在加载本周关注</strong></div> : items.length ? <section className="focus-grid" aria-label="本周关注目标">{items.map((item) => <FocusCard key={item.id} item={item} availableTasks={availableTasks} pending={pending} onEdit={(value) => { setEditing(value); setAdding(false); }} onDelete={remove} onUpdate={(value, patch, isTask = false) => run(() => isTask ? updateTask(value.id, patch) : updateWeeklyFocus(value.id, patch))} onAttach={(focusId, taskId) => run(() => attachTaskToWeeklyFocus(focusId, taskId))} onDetach={(focusId, taskId) => run(() => detachTaskFromWeeklyFocus(focusId, taskId))} onCreateTask={createAction} />)}</section> : <div className="report-empty"><IconNotes size={24} /><strong>本周还没有关注目标</strong><span>把本周最值得持续投入注意力的 3–5 件事写下来。</span><button className="work-button work-button--primary" onClick={() => setAdding(true)} type="button"><IconPlus size={15} />创建第一条关注</button></div>}
  </>;
}

function MeetingsModule() { return <><IntegrationNotice service="钉钉日程" detail="授权后将按设置自动拉取日程；当前展示本地示例日程。" /><section className="meeting-list" aria-label="今日会议日程">{workSnapshot.meetings.map((meeting) => <article className="meeting-row" key={`${meeting.time}-${meeting.title}`}><time>{meeting.time}<small>{meeting.duration}</small></time><div><span className="badge">{meeting.type}</span><strong>{meeting.title}</strong><p>{meeting.people}</p></div><IconCalendarEvent aria-hidden="true" size={20} /></article>)}</section></>; }

function LegacyReportsModule() {
  const [generated, setGenerated] = useState(false); const [outlookItems, setOutlookItems] = useState([]); const [tasks, setTasks] = useState(() => workSnapshot.tasks.map((task) => ({ ...task, status: task.completed ? "completed" : "open" })));
  const report = useMemo(() => buildWeeklyReport(outlookItems, tasks), [outlookItems, tasks]);
  useEffect(() => { Promise.all([loadOutlookTodos(), loadTasks()]).then(([mail, taskData]) => { setOutlookItems(mail.data?.items || []); setTasks(taskData.items || []); }); }, []);
  const exportReport = () => { const href = URL.createObjectURL(new Blob([report], { type: "text/markdown;charset=utf-8" })); const link = document.createElement("a"); link.href = href; link.download = "weekly-report.md"; link.click(); URL.revokeObjectURL(href); };
  return <><section className="report-hero"><div><span className="eyebrow">REPORT READY</span><h2>{workSnapshot.report.period}</h2><p>来源：今日待办、本周关注点、会议日程与 {outlookItems.length} 封待办邮件摘要。</p></div><div className="report-hero__actions"><button className="work-button work-button--primary" onClick={() => setGenerated(true)} type="button"><IconSparkles size={16} />生成 AI 总结</button><button className="work-button" disabled={!generated} onClick={exportReport} type="button"><IconFileText size={16} />导出 Markdown</button></div></section>{generated ? <article className="report-preview"><div><IconSparkles size={17} /><strong>AI 摘要（本地示例）</strong><span>已使用最新待办数据。</span></div><p>本周围绕产品路线确认与关键协作推进。已完成 {tasks.filter((task) => task.status === "completed" || task.completed).length} 项既定行动。</p><button className="work-link" onClick={() => setGenerated(false)} type="button"><IconRefresh size={14} />重新生成</button></article> : <div className="report-empty"><IconSparkles size={24} /><strong>准备生成本周总结</strong><span>确认后可预览摘要并导出 Markdown。</span></div>}</>;
}

function ReportsModule() {
  const [generated, setGenerated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outlookItems, setOutlookItems] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [weeklyFocus, setWeeklyFocus] = useState([]);
  const [dailyReports, setDailyReports] = useState([]);
  const [aiSummary, setAiSummary] = useState(null);
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const report = useMemo(() => buildWeeklyReport(outlookItems, tasks, dailyReports, aiSummary, weeklyFocus), [outlookItems, tasks, dailyReports, aiSummary, weeklyFocus]);
  const range = useMemo(() => {
    const dates = workSnapshot.report.period.match(/\d{4}-\d{2}-\d{2}/g) || [];
    return { from: dates[0] || "1000-01-01", to: dates[1] || "9999-12-31" };
  }, []);

  const refreshDailyReports = async (currentUser = user) => {
    if (!currentUser) { setDailyReports([]); return; }
    try {
      const result = await loadOwnDailyReports(range);
      setDailyReports(result.items || []);
    } catch (err) { setError(err.message || "成员日报加载失败"); }
  };

  useEffect(() => {
    Promise.allSettled([loadOutlookTodos(), loadTasks(), loadWeeklyFocus(range.from)]).then(([mailResult, taskResult, focusResult]) => {
      if (mailResult.status === "fulfilled") setOutlookItems(mailResult.value.data?.items || []);
      if (taskResult.status === "fulfilled") setTasks(taskResult.value.items || []);
      if (focusResult.status === "fulfilled") setWeeklyFocus(focusResult.value.items || []);
      const failure = [mailResult, taskResult, focusResult].find((result) => result.status === "rejected");
      if (failure && failure.reason?.status !== 404 && failure.reason?.code !== "NOT_FOUND" && !/接口不存在|鎺ュ彛涓嶅瓨鍦/.test(failure.reason?.message || "")) {
        setError(failure.reason?.message || "周报数据加载失败");
      }
    });
    getDailyReportUser().then((current) => {
      const next = current?.user || current;
      setUser(next);
      return refreshDailyReports(next);
    }).catch(() => {});
    return subscribeDailyReportAuth((next) => { setUser(next); void refreshDailyReports(next); });
  }, [range]);

  const generate = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await generateWeeklyAiSummary({ period: workSnapshot.report.period, tasks, outlookItems, dailyReports, weeklyFocus });
      setAiSummary(result); setNotice("已使用 DeepSeek 生成结构化周报总结。");
    } catch (err) {
      setAiSummary(null); setNotice(`DeepSeek 生成失败，已使用规则版周报：${err.message || "未知错误"}`);
    } finally { setGenerated(true); setBusy(false); }
  };

  const exportReport = () => { const href = URL.createObjectURL(new Blob([report], { type: "text/markdown;charset=utf-8" })); const link = document.createElement("a"); link.href = href; link.download = "weekly-report.md"; link.click(); URL.revokeObjectURL(href); };
  return <>
    {!user && <div className="work-notice"><span className="status-dot status-dot--warn" /><div><strong>尚未登录团队日报</strong><span>前往<Link to="/system">系统状态</Link>登录后，周报会自动读取你的成员日报。</span></div></div>}
    <section className="report-hero"><div><span className="eyebrow">REPORT READY</span><h2>{workSnapshot.report.period}</h2><p>来源：任务、{outlookItems.length} 封 Outlook 待办邮件与 {dailyReports.length} 条成员日报{user ? `（${user.displayName || user.username}）` : "（未登录）"}。</p></div><div className="report-hero__actions"><button className="work-button work-button--primary" disabled={busy} onClick={generate} type="button"><IconSparkles size={16} />{busy ? "生成中…" : "生成 AI 总结"}</button><button className="work-button" disabled={!generated} onClick={exportReport} type="button"><IconFileText size={16} />导出 Markdown</button></div></section>
    {error && <div className="work-error" role="alert">{error}</div>}{notice && <div className="report-success">{notice}</div>}
    {generated ? <article className="report-preview"><div><IconSparkles size={17} /><strong>{aiSummary ? "AI 摘要（DeepSeek）" : "AI 摘要（规则版）"}</strong><span>{dailyReports.length ? `已纳入 ${dailyReports.length} 条成员日报。` : "本周期暂无成员日报。"}</span></div><p>{aiSummary?.summary || "已生成规则版周报，可继续补充日报后重新生成。"}</p>{aiSummary?.highlights?.length ? <p>关键进展：{aiSummary.highlights.join("；")}</p> : null}<button className="work-link" disabled={busy} onClick={generate} type="button"><IconRefresh size={14} />重新生成</button></article> : <div className="report-empty"><IconSparkles size={24} /><strong>准备生成本周总结</strong><span>将结合任务、Outlook 待办和当前成员日报生成周报。</span></div>}
  </>;
}

export function WorkManagementPage({ module }) {
  const config = moduleCopy[module];
  const content = module === "todos" ? <TodoModule /> : module === "focus" ? <FocusModule /> : module === "meetings" ? <MeetingsModule /> : <ReportsModule />;
  return <div className="page page--work-management"><PageHeader eyebrow={config.eyebrow} title={config.title} description={config.description} />{content}</div>;
}
