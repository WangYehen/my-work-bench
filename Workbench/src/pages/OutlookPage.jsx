import { useCallback, useEffect, useState } from "react";
import {
  IconArchive,
  IconCheck,
  IconExternalLink,
  IconEyeOff,
  IconLink,
  IconLoader2,
  IconMail,
  IconRefresh,
  IconShieldLock,
  IconTrash,
} from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import {
  acceptOutlookConsent,
  disconnectOutlook,
  loadOutlookStatus,
  loadOutlookTodos,
  setOutlookMessageStatus,
  startOutlookOAuth,
  syncOutlook,
} from "../lib/api";
import { formatFullDate } from "../lib/format";

const urgencyLabel = { high: "高", medium: "中", low: "低" };
const intentLabel = { reply: "需要回复", approval: "需要审批", confirmation: "需要确认", deadline: "有截止时间", other: "需要处理" };

function MailRow({ message, onStatus, pending, archived }) {
  return (
    <article className="outlook-mail-row">
      <span className={`outlook-mail-row__urgency outlook-mail-row__urgency--${message.urgency || "low"}`} />
      <div className="outlook-mail-row__copy">
        <div><strong>{message.subject}</strong><span className="badge">{intentLabel[message.intent] || "需要复查"}</span></div>
        <small>{message.sender} · {formatFullDate(message.receivedAt)}</small>
        <p>{message.summary || "此邮件等待下次同步重新分类。"}</p>
      </div>
      <div className="outlook-mail-row__meta">
        <span className={`outlook-urgency outlook-urgency--${message.urgency || "low"}`}>{urgencyLabel[message.urgency] || "待重试"}</span>
        {message.dueAt ? <time>{message.dueAt}</time> : null}
      </div>
      <div className="outlook-mail-row__actions">
        {message.webLink ? <a aria-label="在 Outlook 中打开原邮件" className="work-link" href={message.webLink} rel="noreferrer" target="_blank"><IconExternalLink size={14} /></a> : null}
        {archived ? <button className="work-link" disabled={pending} onClick={() => onStatus(message.id, "open")} type="button"><IconRefresh size={14} />恢复</button> : <><button className="work-link" disabled={pending} onClick={() => onStatus(message.id, "processed")} type="button"><IconCheck size={14} />已处理</button><button className="work-link" disabled={pending} onClick={() => onStatus(message.id, "ignored")} type="button"><IconEyeOff size={14} />忽略</button></>}
      </div>
    </article>
  );
}

function SetupPanel({ status }) {
  return (
    <section className="outlook-setup panel">
      <span className="outlook-setup__icon"><IconShieldLock size={22} /></span>
      <div>
        <span className="eyebrow">LOCAL CONFIGURATION</span>
        <h2>先完成本地连接配置</h2>
        <p>在 <code>Workbench/.env</code> 配置 Microsoft Entra、加密密钥和 DeepSeek API Key 后重启服务。此页面不会保存或显示密钥。</p>
        {status.missingConfiguration?.length ? <div className="outlook-config-list">{status.missingConfiguration.map((key) => <code key={key}>{key}</code>)}</div> : null}
      </div>
    </section>
  );
}

function ConsentPanel({ onConnect, pending, accepted, onAccepted }) {
  return (
    <section className="outlook-consent panel">
      <div className="panel__head"><div><span className="eyebrow">PRIVACY NOTICE</span><h2 className="panel__title">连接 Outlook 前的隐私确认</h2></div><IconShieldLock aria-hidden="true" color="var(--accent)" size={21} /></div>
      <p>授权后，工作台会通过 Microsoft Graph 读取近 7 天收件箱邮件，并每 15 分钟增量同步。邮件正文会在内存中清洗后发送给 DeepSeek API，用于生成摘要和判断是否需要你处理。</p>
      <ul><li>本地仅保存发件人、主题、摘要、分类、原文链接和处理状态；不保存邮件正文或附件。</li><li>仅申请 Microsoft Graph 的 <code>Mail.Read</code> 与 <code>offline_access</code>，不会修改 Outlook 邮箱。</li><li>“已处理”和“忽略”仅更新本地工作台归档。</li></ul>
      <label className="outlook-consent__check"><input checked={accepted} onChange={(event) => onAccepted(event.target.checked)} type="checkbox" />我理解邮件正文将发送至 DeepSeek API，并同意按上述方式处理。</label>
      <button className="work-button work-button--primary" disabled={!accepted || pending} onClick={onConnect} type="button"><IconLink size={16} />同意并连接 Outlook</button>
    </section>
  );
}

export function OutlookPage() {
  const [status, setStatus] = useState(null);
  const [items, setItems] = useState([]);
  const [archive, setArchive] = useState([]);
  const [view, setView] = useState("todos");
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    const [nextStatus, nextTodos, nextArchive] = await Promise.all([loadOutlookStatus(), loadOutlookTodos(), loadOutlookTodos("archive")]);
    setStatus(nextStatus.data);
    setItems(nextTodos.data.items || []);
    setArchive(nextArchive.data.items || []);
    if (nextStatus.error) setError(nextStatus.error.message);
    else if (nextStatus.data.lastError) setError(nextStatus.data.lastError);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (operation) => {
    setPending(true);
    setError(null);
    try {
      await operation();
      await refresh();
    } catch (operationError) {
      await refresh().catch(() => {});
      setError(operationError.message || "操作未完成，请稍后重试。");
    } finally {
      setPending(false);
    }
  };

  const connect = () => run(async () => {
    await acceptOutlookConsent();
    const { authorizationUrl } = await startOutlookOAuth();
    window.location.assign(authorizationUrl);
  });

  const list = view === "archive" ? archive : items;

  return (
    <div className="page page--work-management page--outlook">
      <PageHeader eyebrow="OUTLOOK / ACTION INBOX" title="工作邮箱" description="从邮件里识别需要你回复、审批或确认的事项，不替代完整邮件客户端。" aside={<span className="work-page-icon"><IconMail size={20} /></span>} />
      {error ? <div className="outlook-error" role="alert">{error}</div> : null}
      {!status ? <div className="report-empty"><IconLoader2 className="outlook-spin" size={24} /><span>正在读取 Outlook 连接状态…</span></div> : !status.configured ? <SetupPanel status={status} /> : !status.consented || !status.connected ? <ConsentPanel accepted={accepted} onAccepted={setAccepted} onConnect={connect} pending={pending} /> : <>
        <section className="outlook-connected panel">
          <div><span className="badge badge--accent"><span className="status-dot status-dot--ok" />Microsoft Graph 已连接</span><strong>{status.todoCount} 封待处理邮件</strong><small>最近同步：{formatFullDate(status.lastSyncAt)}</small></div>
          <div><button className="work-button" disabled={pending} onClick={() => run(syncOutlook)} type="button"><IconRefresh size={15} />立即同步</button><button className="work-button" disabled={pending} onClick={() => run(disconnectOutlook)} type="button"><IconTrash size={15} />断开连接</button></div>
        </section>
        <section className="outlook-list panel">
          <div className="panel__head"><div><span className="eyebrow">MAIL ACTIONS</span><h2 className="panel__title">{view === "archive" ? "已归档邮件" : "待处理邮件"}</h2></div><div className="outlook-tabs"><button className={view === "todos" ? "is-active" : ""} onClick={() => setView("todos")} type="button">待处理 {items.length}</button><button className={view === "archive" ? "is-active" : ""} onClick={() => setView("archive")} type="button"><IconArchive size={14} />归档 {archive.length}</button></div></div>
          {list.length ? <div className="outlook-mail-list">{list.map((message) => <MailRow archived={view === "archive"} key={message.id} message={message} onStatus={(id, value) => run(() => setOutlookMessageStatus(id, value))} pending={pending} />)}</div> : <div className="report-empty"><IconMail size={24} /><strong>{view === "archive" ? "暂无归档邮件" : "暂无待处理邮件"}</strong><span>{view === "archive" ? "处理或忽略的邮件会保留在本地归档中。" : "同步后，识别为待办的邮件会显示在这里。"}</span></div>}
        </section>
      </>}
    </div>
  );
}
