export function DingTalkSyncStatus({ status, label = "钉钉数据", interval = "每 1 小时" }) {
  const connected = status?.connected === true;
  const lastSuccessAt = status?.sync?.events?.lastSuccessAt || status?.lastSyncAt;
  const lastError = status?.sync?.events?.lastError || status?.lastError;
  const stateLabel = connected ? "已连接" : status?.configured ? "等待授权" : "未配置";
  return <div className="work-notice">
    <span className={`status-dot ${connected ? "status-dot--ok" : "status-dot--warn"}`} />
    <div>
      <strong>{label}{stateLabel}</strong>
      <span>最近同步时间：{lastSuccessAt ? new Date(lastSuccessAt).toLocaleString("zh-CN") : "尚未完成同步"}{lastError ? ` · 失败原因：${lastError}` : ""} · 自动同步频率：{interval}</span>
    </div>
  </div>;
}
