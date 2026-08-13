import { useCallback, useEffect, useMemo, useState } from "react";
import { IconChevronDown, IconChevronRight, IconExternalLink, IconLink, IconLoader2, IconMail, IconRefresh, IconShieldLock, IconTrash } from "@tabler/icons-react";
import {
  acceptOutlookConsent,
  convertOutlookMessageToTask,
  correctOutlookMessage,
  disconnectOutlook,
  loadOutlookStatus,
  loadOutlookTodos,
  setOutlookMessageStatus,
  startOutlookOAuth,
  syncOutlook,
} from "../lib/api";
import { formatFullDate } from "../lib/format";
import { groupActions } from "../lib/work-loop";
import { PageHeader } from "../components/PageHeader";

const queueCopy = {
  action: { label: "需要行动", empty: "没有需要你立即处理的邮件" },
  informational: { label: "仅供知晓", empty: "暂无通知、抄送或系统消息" },
  uncertain: { label: "无法判断", empty: "暂无需要你确认的邮件" },
};
const actionTypeLabel = { reply: "回复", approval: "审批", confirmation: "确认", submission: "提交材料", deadline: "处理截止事项", other: "处理" };
const dueSourceLabel = { explicit: "邮件原文", inferred: "AI 推断", none: "未识别" };
const confidenceLabel = (value) => value >= 85 ? "高" : value >= 65 ? "中" : "低";
const formatDue = (value) => value ? formatFullDate(value) : "未识别明确截止时间";

function SetupPanel({ status }) {
  return <section className="outlook-setup"><div className="outlook-setup__icon"><IconMail size={24} /></div><div><h2>完成 Outlook 本地配置</h2><p>配置 Microsoft Entra 应用、加密密钥和 DeepSeek 后即可启用行动收件箱。</p><div className="outlook-config-list">{(status?.missingConfiguration || []).map((item) => <code key={item}>{item}</code>)}</div></div></section>;
}

function ConsentPanel({ accepted, onAccepted, onConnect, pending }) {
  return <section className="outlook-consent"><div className="panel__head"><div><h2 className="panel__title">连接 Outlook 前的隐私确认</h2></div><IconShieldLock color="var(--accent)" size={21} /></div><p>授权后会读取近 7 天收件箱，并将清洗后的正文发送给 DeepSeek，用于生成行动、截止时间及判断置信度。</p><ul><li>邮件正文不落盘，分类结果和你的纠正保存在本地加密状态中。</li><li>仅申请 Mail.Read，不会修改 Outlook 邮箱。</li></ul><label className="outlook-consent__check"><input checked={accepted} onChange={(event) => onAccepted(event.target.checked)} type="checkbox" />我理解并同意上述处理方式。</label><button className="work-button work-button--primary" disabled={!accepted || pending} onClick={onConnect} type="button"><IconLink size={16} />同意并连接 Outlook</button></section>;
}

function CorrectionDialog({ message, onClose, onSave, pending }) {
  const [draft, setDraft] = useState(() => ({
    queue: message.queue || "action",
    actionType: message.actionType || "other",
    actionText: message.actionText || message.summary || "",
    dueAt: message.dueAt ? String(message.dueAt).slice(0, 16) : "",
    dueSource: message.dueSource || "none",
    priority: message.priority || "P1",
    priorityReason: message.priorityReason || "",
    confidence: 100,
  }));
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  return <div className="daily-report-modal-backdrop"><form className="mail-correction-modal" onSubmit={(event) => { event.preventDefault(); onSave({ ...draft, dueAt: draft.dueAt || null }); }}><header><div><h2>纠正 AI 判断</h2><p>你的判断会被保留，后续同步不会覆盖。</p></div><button aria-label="关闭" onClick={onClose} type="button">×</button></header><div className="mail-correction-grid"><label>队列<select value={draft.queue} onChange={(event) => set("queue", event.target.value)}><option value="action">需要行动</option><option value="informational">仅供知晓</option><option value="uncertain">无法判断</option></select></label><label>行动类型<select value={draft.actionType} onChange={(event) => set("actionType", event.target.value)}>{Object.entries(actionTypeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="is-wide">要做什么<input value={draft.actionText} onChange={(event) => set("actionText", event.target.value)} /></label><label>最晚时间<input type="datetime-local" value={draft.dueAt} onChange={(event) => set("dueAt", event.target.value)} /></label><label>截止来源<select value={draft.dueSource} onChange={(event) => set("dueSource", event.target.value)}><option value="explicit">邮件原文</option><option value="inferred">AI 推断</option><option value="none">无截止</option></select></label><label>优先级<select value={draft.priority} onChange={(event) => set("priority", event.target.value)}><option>P0</option><option>P1</option><option>P2</option></select></label><label>优先级原因<input value={draft.priorityReason} onChange={(event) => set("priorityReason", event.target.value)} /></label></div><footer><button className="work-button" onClick={onClose} type="button">取消</button><button className="work-button work-button--primary" disabled={pending} type="submit">保存纠正</button></footer></form></div>;
}

function MailRow({ message, expanded, onExpand, onConvert, onIgnore, onCorrect, pending }) {
  const confidence = Number(message.confidence || 0);
  return <article className={`action-mail-row${expanded ? " is-expanded" : ""}`}>
    <button aria-label={expanded ? "收起邮件" : "展开邮件"} className="action-mail-expand" onClick={onExpand} type="button">{expanded ? <IconChevronDown size={15} /> : <IconChevronRight size={15} />}</button>
    <div className="action-mail-subject"><strong>{message.sender}</strong><span>{message.subject}</span></div>
    <div><strong>{message.actionText || message.summary}</strong><small>{actionTypeLabel[message.actionType] || "处理"}</small></div>
    <div className="action-mail-due"><strong>{formatDue(message.dueAt)}</strong><span className={`priority-tag priority-tag--${String(message.priority || "P1").toLowerCase()}`}>{message.priority || "P1"}</span>{message.dueAt ? <small>{message.dueAt < new Date().toISOString() ? "已逾期" : "待处理"}</small> : null}</div>
    <div className="action-mail-actions"><button className="action-mail-primary" disabled={pending} onClick={onConvert} type="button">转为待办</button><button disabled={pending} onClick={onCorrect} type="button">纠正判断</button><button className="action-mail-tertiary" disabled={pending} onClick={onIgnore} type="button">无需处理</button>{message.webLink ? <a href={message.webLink} rel="noreferrer" target="_blank">打开原邮件<IconExternalLink size={12} /></a> : null}</div>
    {expanded ? <div className="action-mail-detail"><div><h4>邮件原文摘要</h4><pre>{message.bodyText || message.summary || "未保留可展示的正文摘要。"}</pre></div><div><h4>AI 判断详情</h4><dl><div><dt>置信度</dt><dd>{confidence}% · {confidenceLabel(confidence)}</dd></div><div><dt>截止来源</dt><dd>{dueSourceLabel[message.dueSource] || "AI 判断"}</dd></div><div><dt>判断依据</dt><dd>识别为“{queueCopy[message.queue]?.label || "待确认"}”，行动类型为“{actionTypeLabel[message.actionType] || "处理"}”。{message.priorityReason || "未提供额外依据"}</dd></div></dl></div></div> : null}
  </article>;
}

export function OutlookPage() {
  const [status, setStatus] = useState(null);
  const [queues, setQueues] = useState({ action: [], informational: [], uncertain: [] });
  const [view, setView] = useState("action");
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [correcting, setCorrecting] = useState(null);
  const refresh = useCallback(async () => {
    const [nextStatus, action, informational, uncertain] = await Promise.all([loadOutlookStatus(), loadOutlookTodos(), loadOutlookTodos("informational"), loadOutlookTodos("uncertain")]);
    setStatus(nextStatus.data || nextStatus);
    setQueues({ action: action.items || action.data?.items || [], informational: informational.items || informational.data?.items || [], uncertain: uncertain.items || uncertain.data?.items || [] });
  }, []);
  useEffect(() => { refresh().catch((failure) => setError(failure.message)); }, [refresh]);
  const run = async (operation) => { setPending(true); setError(""); try { await operation(); await refresh(); } catch (failure) { setError(failure.message || "操作失败"); } finally { setPending(false); } };
  const sync = async () => {
    setSyncing(true);
    try { await run(syncOutlook); }
    finally { setSyncing(false); }
  };
  const connect = () => run(async () => { await acceptOutlookConsent(); const result = await startOutlookOAuth(); globalThis.location.assign(result.authorizationUrl); });
  const groups = useMemo(() => groupActions((queues[view] || []).map((message) => ({ ...message, title: message.actionText || message.subject }))), [queues, view]);
  const messages = queues[view] || [];

  return <div className="page action-inbox-page">
    <PageHeader
      description="把邮件分为需要行动、仅供知晓和无法判断，所有 AI 判断都可以随时纠正。"
      eyebrow="OUTLOOK / ACTION INBOX"
      title="行动收件箱"
    />
    {!status ? <div className="report-empty"><IconLoader2 className="outlook-spin" size={24} /><span>正在读取 Outlook 连接状态…</span></div> : !status.configured ? <SetupPanel status={status} /> : !status.consented || !status.connected ? <ConsentPanel accepted={accepted} onAccepted={setAccepted} onConnect={connect} pending={pending} /> : <>
      <section className="action-inbox-sync"><div className="action-sync-item"><IconMail size={18} /><span><small>连接状态</small><strong>已连接 Outlook</strong></span></div><div className="action-sync-item"><IconRefresh size={18} /><span><small>最后同步</small><strong>{formatFullDate(status.lastSyncAt)}</strong></span></div><div className={`action-sync-item ${syncing ? "is-processing" : "is-complete"}`}><i /><span><small>识别状态</small><strong>{syncing ? "正在识别邮件…" : `已完成 ${queues.action.length + queues.informational.length + queues.uncertain.length} 封`}</strong></span></div><div className="action-sync-actions"><button disabled={pending} onClick={sync} type="button">{syncing ? "同步中…" : "立即同步"}</button><button className="action-disconnect" disabled={pending} onClick={() => { if (globalThis.confirm("断开 Outlook 后将停止同步，但会保留本地邮件归档。确认断开吗？")) void run(disconnectOutlook); }} type="button"><IconTrash size={15} />断开连接</button></div></section>
      <nav className="action-inbox-tabs" aria-label="邮件队列">{Object.entries(queueCopy).map(([key, copy]) => <button className={view === key ? "is-active" : ""} key={key} onClick={() => setView(key)} type="button">{copy.label}<span>{queues[key].length}</span></button>)}</nav>
      <p className="action-inbox-order">已按：已逾期 → 今天截止 → 高优先级 → 收件时间 排序</p>
      <section className="action-mail-table"><div className="action-mail-table__head"><span>发件人与主题</span><span>要做什么</span><span>最晚什么时候做</span><span>优先级与原因</span><span>截止来源</span><span>AI 置信度</span><span>操作</span></div>{messages.length ? groups.map((group) => <div className="action-mail-group" key={group.id}><div className={`action-mail-group__title is-${group.tone}`}><i />{group.label}<span>（{group.items.length}）</span></div>{group.items.map((message) => <MailRow expanded={expanded === message.id} key={message.id} message={message} onCorrect={() => setCorrecting(message)} onConvert={() => run(() => convertOutlookMessageToTask(message.id))} onExpand={() => setExpanded((current) => current === message.id ? null : message.id)} onIgnore={() => run(() => setOutlookMessageStatus(message.id, "ignored"))} pending={pending} />)}</div>) : <div className="today-work-empty"><IconMail size={24} /><strong>{queueCopy[view].empty}</strong><span>{view === "uncertain" ? "你的确认会帮助系统后续更准确地识别。" : "新邮件同步后会自动进入合适的队列。"}</span></div>}</section>
    </>}
    {error ? <div className="work-error" role="alert">{error}</div> : null}
    {correcting ? <CorrectionDialog message={correcting} onClose={() => setCorrecting(null)} onSave={(patch) => run(async () => { await correctOutlookMessage(correcting.id, patch); setCorrecting(null); })} pending={pending} /> : null}
  </div>;
}
