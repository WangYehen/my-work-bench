import { useEffect, useMemo, useState } from "react";
import {
  IconBrandDaysCounter,
  IconCheck,
  IconChevronDown,
  IconClipboard,
  IconExternalLink,
  IconKey,
  IconLink,
  IconMail,
  IconRefresh,
  IconShieldLock,
  IconX,
} from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import { getRuntimeStatus, loadIntegrationsStatus, refreshVault, startDingTalkOAuth, testDeepSeekConnection } from "../lib/api";
import { checkDingTalkDailyReportConnection, exchangeDingTalkDailyReportLogin, getDailyReportUser, logoutDailyReport, startDingTalkDailyReportLogin, subscribeDailyReportAuth } from "../lib/daily-reports";

const serviceDefinitions = {
  outlook: {
    eyebrow: "OUTLOOK / MAIL",
    title: "工作邮箱",
    description: "读取需要处理的邮件，并在本地生成待办。",
    icon: IconMail,
    route: "/outlook",
    docs: "https://learn.microsoft.com/entra/identity-platform/quickstart-register-app",
    steps: ["在 Microsoft Entra 注册应用", "把配置片段加入 Workbench/.env", "重启 Workbench 后重新检测", "在工作邮箱页面完成 Microsoft 授权"],
    env: "OUTLOOK_ENTRA_CLIENT_ID=your-client-id\nOUTLOOK_OAUTH_REDIRECT_URI=http://127.0.0.1:5174/api/outlook/oauth/callback\nOUTLOOK_TOKEN_ENCRYPTION_KEY=your-32-byte-base64-key",
  },
  dingtalkCalendar: {
    eyebrow: "DINGTALK / CALENDAR",
    title: "钉钉日程与待办",
    description: "读取当前账号的会议、日程和待办，不修改钉钉数据。",
    icon: IconBrandDaysCounter,
    route: "/meetings",
    docs: "https://open.dingtalk.com/document/orgapp-server/obtain-user-token",
    steps: ["在钉钉开放平台创建应用", "把配置片段加入 Workbench/.env", "重启 Workbench 后重新检测", "在系统状态页完成钉钉日程授权"],
    env: "DINGTALK_CLIENT_ID=your-dingtalk-app-key\nDINGTALK_CLIENT_SECRET=your-dingtalk-app-secret\nDINGTALK_OAUTH_REDIRECT_URI=http://127.0.0.1:5174/api/dingtalk/oauth/callback\nDINGTALK_TOKEN_ENCRYPTION_KEY=your-32-byte-base64-key",
  },
  deepseek: {
    eyebrow: "AI / DEEPSEEK",
    title: "DeepSeek",
    description: "用于 Outlook 邮件分类和本地周报总结。邮件正文只在处理时发送，不在本地保存。",
    icon: IconKey,
    route: "/weekly-report",
    docs: "https://platform.deepseek.com/",
    steps: ["创建 DeepSeek API Key", "把 API Key 加入 Workbench/.env", "重启 Workbench 后重新检测", "点击测试连接确认服务可用"],
    env: "DEEPSEEK_API_KEY=your-api-key\nDEEPSEEK_BASE_URL=https://api.deepseek.com\nDEEPSEEK_MODEL=deepseek-chat",
  },
};

const statusLabels = {
  needs_configuration: ["需要配置", "warn"],
  needs_authorization: ["等待授权", "warn"],
  connected: ["已连接", "ok"],
  ready: ["已配置", "ok"],
  degraded: ["部分可用", "warn"],
  error: ["存在错误", "error"],
};

function StatusBadge({ status }) {
  const [label, tone] = statusLabels[status] || ["检测中", "muted"];
  return <span className={`integration-status integration-status--${tone}`}><span className="status-dot" />{label}</span>;
}

function ServiceCard({ service, item, expanded, onToggle, onCopy, onTest, onAuthorize, authorizeLabel, testing, authBusy }) {
  const Icon = service.icon;
  const missing = item?.missing || [];
  const calendarAuthorize = onAuthorize;
  const calendarAuthorizeLabel = authorizeLabel || (item?.status === "connected" ? "重新授权日程" : "连接钉钉日程");
  return <article className={`integration-card${expanded ? " is-expanded" : ""}`} data-service={calendarAuthorize ? "dingtalk-calendar" : undefined}>
    <button className="integration-card__head" onClick={onToggle} type="button" aria-expanded={expanded}>
      <span className="integration-card__icon"><Icon size={19} /></span>
      <span className="integration-card__identity"><span className="eyebrow">{service.eyebrow}</span><strong>{service.title}</strong><small>{service.description}</small></span>
      <StatusBadge status={item?.status} />
      <IconChevronDown className="integration-card__chevron" size={18} />
    </button>
    {expanded ? <div className="integration-card__body">
      {missing.length ? <div className="integration-missing" role="status"><IconX size={15} /><span>还缺少 {missing.length} 项配置</span><div>{missing.map((key) => <code key={key}>{key}</code>)}</div></div> : <div className="integration-ready" role="status"><IconCheck size={15} />配置检查已通过</div>}
      <ol className="integration-steps">{service.steps.map((step, index) => <li key={step} className={index === 0 && missing.length ? "is-current" : ""}><span>{index + 1}</span>{step}</li>)}</ol>
      <div className="integration-code"><div><strong>配置片段</strong><small>复制后粘贴到 Workbench/.env，不会在网页中保存密钥。</small></div><button className="work-link" onClick={onCopy} type="button"><IconClipboard size={14} />复制</button><pre><code>{service.env}</code></pre></div>
      <div className="integration-card__actions">
        {calendarAuthorize ? <button className="work-button work-button--primary" disabled={authBusy || !item?.configured} onClick={() => void calendarAuthorize()} type="button"><IconLink size={15} />{calendarAuthorizeLabel}</button> : null}
        {service.docs ? <a className="work-button" href={service.docs} rel="noreferrer" target="_blank"><IconExternalLink size={15} />官方说明</a> : null}
        {service.title === "DeepSeek" ? <button className="work-button" disabled={testing || !item?.configured} onClick={onTest} type="button"><IconRefresh size={15} />{testing ? "测试中…" : "测试连接"}</button> : calendarAuthorize ? null : <a className="work-button work-button--primary" href={service.route}><IconLink size={15} />前往授权</a>}
      </div>
    </div> : null}
  </article>;
}

function teamAuthCallbackMessage(code, message) {
  if (message) return message;
  if (code === "DINGTALK_IP_NOT_WHITELISTED") return "钉钉应用服务器出口 IP 未加入白名单。请前往“钉钉开放平台 → 应用 → 开发配置 → 服务器出口 IP”添加当前出口 IP，保存后重新登录。";
  return code ? "钉钉登录失败，请重新尝试。" : "";
}

export function SystemPage() {
  const [runtime, setRuntime] = useState({ data: null, source: "loading", error: null });
  const [integrations, setIntegrations] = useState({ data: null, source: "loading", error: null });
  const [expanded, setExpanded] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState("");
  const [teamUser, setTeamUser] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");

  const loadAll = async () => {
    const [nextRuntime, nextIntegrations] = await Promise.all([getRuntimeStatus(), loadIntegrationsStatus()]);
    setRuntime(nextRuntime); setIntegrations(nextIntegrations);
  };
  useEffect(() => { void loadAll(); }, []);
  useEffect(() => { let mounted = true; getDailyReportUser().then((result) => { if (mounted) setTeamUser(result?.user || result || null); }).catch(() => { if (mounted) setTeamUser(null); }); return () => { mounted = false; }; }, []);
  useEffect(() => subscribeDailyReportAuth(setTeamUser), []);
  useEffect(() => {
    const params = new URLSearchParams(globalThis.location?.search || "");
    const token = params.get("dingtalk_login");
    const callbackErrorCode = params.get("dingtalk_error");
    const callbackError = params.get("dingtalk_error_message");
    const callbackMessage = teamAuthCallbackMessage(callbackErrorCode, callbackError);
    if (callbackMessage) setAuthError(callbackMessage);
    if (!token) { if (callbackError || callbackErrorCode) globalThis.history?.replaceState({}, "", globalThis.location.pathname); return undefined; }
    setAuthBusy(true); setAuthError("");
    exchangeDingTalkDailyReportLogin(token).then(setTeamUser).catch((error) => setAuthError(error.message || "钉钉登录失败")).finally(() => setAuthBusy(false));
    globalThis.history?.replaceState({}, "", globalThis.location.pathname);
    return undefined;
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(globalThis.location?.search || "");
    if (params.get("dingtalk_connected") !== "1") return;
    setAuthBusy(true);
    getDailyReportUser()
      .then((user) => { setTeamUser(user?.user || user || null); setAuthError(""); })
      .catch((error) => setAuthError(error.message || "钉钉授权状态读取失败"))
      .finally(() => setAuthBusy(false));
    globalThis.history?.replaceState({}, "", globalThis.location.pathname);
  }, []);

  const services = integrations.data?.services || {};
  const serviceList = useMemo(() => Object.entries(serviceDefinitions), []);
  const configuredCount = serviceList.filter(([key]) => services[key]?.configured).length;
  const codex = runtime.data?.codex;
  const handleCalendarAuthorize = async () => { setAuthBusy(true); setAuthError(""); try { const result = await startDingTalkOAuth(); if (!result?.authorizationUrl) throw new Error("钉钉日程授权地址生成失败"); globalThis.location.assign(result.authorizationUrl); } catch (error) { setAuthError(error.message || "钉钉日程授权失败"); setAuthBusy(false); } };

  const handleRefresh = async () => { setRefreshing(true); setNotice(""); try { await refreshVault(); await loadAll(); setNotice("配置和 Vault 状态已更新。"); } catch (error) { setNotice(error.message || "刷新失败，请稍后重试。"); } finally { setRefreshing(false); } };
  const copy = async (text) => { await navigator.clipboard?.writeText(text); setNotice("配置片段已复制，请粘贴到 Workbench/.env。"); };
  const testDeepSeek = async () => { setTesting(true); setNotice(""); try { await testDeepSeekConnection(); setNotice("DeepSeek 连接测试成功。"); await loadAll(); } catch (error) { setNotice(error.message || "DeepSeek 连接测试失败。"); } finally { setTesting(false); } };
  const handleTeamLogin = async () => { setAuthBusy(true); setAuthError(""); try { const result = await startDingTalkDailyReportLogin(); const authorizationUrl = result?.authorizationUrl || result?.data?.authorizationUrl; if (!authorizationUrl) throw new Error("钉钉登录地址生成失败"); globalThis.location.assign(authorizationUrl); } catch (error) { setAuthError(error.message || "钉钉登录失败"); setAuthBusy(false); } };
  const handleTeamCheck = async () => { setAuthBusy(true); setAuthError(""); try { const result = await checkDingTalkDailyReportConnection(); setAuthError(result.reachable ? "钉钉基础接口连接正常；组织接口权限与服务器出口 IP 白名单将在登录时继续校验。" : `${result.error?.message || "钉钉接口暂时无法连接"}${result.proxyConfigured ? "" : "；当前未配置代理"}`); } catch (error) { setAuthError(error.message || "钉钉连接检查失败"); } finally { setAuthBusy(false); } };
  const handleTeamLogout = async () => { setAuthBusy(true); setAuthError(""); try { await logoutDailyReport(); setTeamUser(null); } catch (error) { setAuthError(error.message || "退出登录失败"); } finally { setAuthBusy(false); } };

  return <div className="page page--system">
    <PageHeader eyebrow="SYSTEM / SERVICES" title="服务配置" description="集中检查第三方服务、复制本地配置并完成授权。密钥只保留在你的本机配置中。" />
    {notice ? <div className="work-notice" role="status"><IconShieldLock size={17} /><span>{notice}</span></div> : null}
    <section className="integration-summary panel"><div><span className="eyebrow">INTEGRATION HEALTH</span><h2 className="panel__title">第三方服务</h2><p>已配置 {configuredCount}/{serviceList.length} 项。先完成配置，再前往对应功能页授权。</p></div><button className="work-button" disabled={refreshing} onClick={handleRefresh} type="button"><IconRefresh size={15} />{refreshing ? "检测中…" : "重新检测"}</button></section>
    <section className="integration-list" aria-label="第三方服务配置列表">{serviceList.map(([key, service]) => <ServiceCard key={key} service={service} item={services[key]} expanded={expanded === key} onToggle={() => setExpanded(expanded === key ? "" : key)} onCopy={() => copy(service.env)} onAuthorize={key === "dingtalkCalendar" ? handleCalendarAuthorize : undefined} authorizeLabel={services[key]?.status === "connected" ? "重新授权日程" : "连接钉钉日程"} onTest={key === "deepseek" ? testDeepSeek : undefined} testing={key === "deepseek" && testing} authBusy={authBusy} />)}</section>
    <section className="panel system-team-auth"><div className="panel__head"><div><span className="eyebrow">TEAM / DINGTALK</span><h2 className="panel__title">团队日报身份</h2></div></div>{teamUser ? <div className="system-team-auth__signed-in"><div><strong>{teamUser.displayName || teamUser.username}</strong><span>{teamUser.departmentName || "未同步部门"} · {teamUser.role === "admin" ? "管理员" : "成员"}</span></div><button className="work-button" disabled={authBusy} onClick={handleTeamLogout} type="button">退出钉钉登录</button></div> : <div className="system-team-auth__form"><p>使用钉钉组织账号登录后，才能提交或查看团队日报。</p><div className="report-hero__actions"><button className="work-button" disabled={authBusy} onClick={handleTeamCheck} type="button">检查连接</button><button className="work-button work-button--primary" disabled={authBusy} onClick={handleTeamLogin} type="button">{authBusy ? "处理中…" : "使用钉钉登录"}</button></div></div>}{authError ? <div className="work-error" role="alert">{authError}</div> : null}</section>
    <div className="system-grid"><div className="panel"><div className="panel__head"><h2 className="panel__title">Codex 运行时</h2></div><div><div className="system-kv"><dt>可用性</dt><dd>{codex?.available ? "可用" : "不可用"}</dd></div><div className="system-kv"><dt>来源</dt><dd>{codex?.source === "path" ? "本机安装" : codex?.source || "尚未检测"}</dd></div></div></div></div>
  </div>;
}
