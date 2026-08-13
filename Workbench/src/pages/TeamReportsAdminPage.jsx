import { useEffect, useMemo, useState } from "react";
import { IconShieldCheck } from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import { WorkbenchCalendar, formatCalendarDate } from "../components/WorkbenchCalendar";
import { getDailyReportUser, loadAdminDailyReports, subscribeDailyReportAuth } from "../lib/daily-reports";

const today = () => formatCalendarDate(new Date());

export function TeamReportsAdminPage() {
  const [user, setUser] = useState(null);
  const [allReports, setAllReports] = useState([]);
  const [selectedDate, setSelectedDate] = useState(today());
  const [error, setError] = useState("");
  const load = () => loadAdminDailyReports({}).then((result) => setAllReports(result.items || [])).catch((err) => setError(err.message));

  useEffect(() => {
    getDailyReportUser().then((current) => {
      const next = current?.user || current;
      setUser(next);
      if (next) void load();
    }).catch(() => {});
    return subscribeDailyReportAuth((next) => { setUser(next); if (next) void load(); else setAllReports([]); });
  }, []);

  const reportDates = useMemo(() => new Set(allReports.map((report) => String(report.reportDate).slice(0, 10))), [allReports]);
  const selectedReports = allReports.filter((report) => String(report.reportDate).slice(0, 10) === selectedDate);

  return <div className="page page--work-management">
    <PageHeader eyebrow="TEAM / REPORTS" title="团队日报" description="查看自己的日报，以及直属关系下所有下属的日报。管理员可以查看全组织日报。" aside={<span className="work-page-icon"><IconShieldCheck size={20} /></span>} />
    {!user ? <div className="work-notice"><span className="status-dot status-dot--warn" /><div><strong>尚未登录钉钉日报</strong><span>前往系统状态使用钉钉组织账号登录。</span></div></div> : <div className="report-login report-account"><div><strong>已登录：{user.displayName || user.username}</strong><span>{user.departmentName || "未同步部门"} · {user.role === "admin" ? "管理员" : "成员"}</span></div></div>}
    {user && <div className="team-reports-layout"><section className="team-reports-content"><div className="team-reports-content__head"><div><span className="eyebrow">DAILY REPORTS</span><h2>{selectedDate} <small>{selectedReports.length} 份日报</small></h2></div><span className="team-reports-content__hint">仅显示当前钉钉组织权限范围内的日报</span></div><section className="team-report-list">{selectedReports.length ? selectedReports.map((report) => <article className="team-report-card" key={report.id}><div className="team-report-card__head"><strong>{report.displayName || report.username}</strong><time>{report.reportDate}</time></div><p className="team-report-card__meta">{report.departmentName || "未同步部门"}</p><h3>{report.summary}</h3><dl><div><dt>已完成</dt><dd>{report.completedItems || "无"}</dd></div><div><dt>阻塞与风险</dt><dd>{report.blockers || "无"}</dd></div><div><dt>下一步</dt><dd>{report.nextActions || "无"}</dd></div></dl></article>) : <div className="report-empty"><strong>当天暂无可见日报</strong><span>当前日期没有自己或下属提交的日报。</span></div>}</section></section><WorkbenchCalendar selectedDate={selectedDate} reportDates={reportDates} onSelect={setSelectedDate} /></div>}
    {error && <div className="work-error" role="alert">{error}</div>}
  </div>;
}
