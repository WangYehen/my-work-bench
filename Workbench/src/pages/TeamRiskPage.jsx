import { useEffect, useState } from "react";
import { IconAlertTriangle, IconUsers } from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import { loadTeamDashboard } from "../lib/daily-reports";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());

export function TeamRiskPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { loadTeamDashboard({ date: today() }).then(setData).catch((failure) => setError(failure.message)); }, []);
  const blockers = data?.summary?.blockers || [];
  const missing = data?.members?.filter((item) => ["missing", "late"].includes(item.status)) || [];
  return <div className="page compact-team-page">
    <PageHeader eyebrow="TEAM / RISKS" title="风险与未提交" description="集中查看影响团队推进的阻塞，以及今天尚未提交日报的成员。" />
    {error ? <div className="work-notice"><span className="status-dot status-dot--warn" /><div><strong>登录后查看团队风险</strong><span>{error}</span></div></div> : null}
    <div className="compact-team-grid">
      <section className="team-dashboard-panel"><h2><IconAlertTriangle size={19} />团队阻塞</h2>{blockers.length ? blockers.map((item, index) => <article className="compact-risk-row" key={`${item.text}-${index}`}><div><strong>{item.text}</strong><small>{item.departments?.join("、")}</small></div><span>{item.affectedMembers?.length || 1} 人受影响</span></article>) : <div className="report-empty">暂无数据</div>}</section>
      <section className="team-dashboard-panel"><h2><IconUsers size={19} />未提交与迟交</h2>{missing.length ? missing.map((item) => <article className="compact-risk-row" key={item.id}><div><strong>{item.displayName}</strong><small>{item.departmentName}</small></div><span>{item.status === "late" ? "迟交" : "未提交"}</span></article>) : <div className="report-empty">暂无数据</div>}</section>
    </div>
  </div>;
}
