import { useEffect, useMemo, useState } from "react";
import { IconFileText } from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import { loadTeamWeeklySummary } from "../lib/daily-reports";

function weekRange() { const now = new Date(); const day = now.getDay() || 7; const start = new Date(now); start.setDate(now.getDate() - day + 1); const end = new Date(start); end.setDate(start.getDate() + 6); const format = (value) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(value); return { from: format(start), to: format(end) }; }

export function TeamWeeklyReportPage() {
  const range = useMemo(weekRange, []);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { loadTeamWeeklySummary(range).then(setData).catch((failure) => setError(failure.message)); }, [range]);
  const blockers = data?.blockers || [];
  const nextActions = data?.nextActions || [];
  return <div className="page compact-team-page">
    <PageHeader eyebrow="TEAM / WEEKLY REPORT" title="团队周报" description="汇总团队日报中的进展、阻塞与下一步。" meta={<span>{range.from} 至 {range.to}</span>} />
    {error ? <div className="work-notice"><span className="status-dot status-dot--warn" /><div><strong>登录后生成团队周报</strong><span>{error}</span></div></div> : null}
    <section className="team-weekly-sheet"><div><IconFileText size={22} /><strong>{data?.reportCount || 0} 份日报已纳入</strong><span>仅使用成员最终提交的日报文本</span></div><h2>本周共同阻塞</h2><ul>{blockers.length ? blockers.map((item, index) => <li key={`${item.text}-${index}`}>{item.text}<small>{item.affectedMembers?.length || 1} 人受影响</small></li>) : <li>暂无可汇总数据</li>}</ul><h2>下周关键行动</h2><ul>{nextActions.length ? nextActions.map((item, index) => <li key={`${item.text}-${index}`}>{item.text}<small>{item.owner}</small></li>) : <li>暂无可汇总数据</li>}</ul></section>
  </div>;
}
