import { useEffect, useMemo, useRef, useState } from "react";
import { IconCalendarEvent, IconRefresh } from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import { WorkbenchCalendar, formatCalendarDate } from "../components/WorkbenchCalendar";
import { loadDingTalkEvents, loadDingTalkStatus, startDingTalkOAuth, syncDingTalk } from "../lib/api";

const monthRange = (dateText) => { const date = new Date(`${dateText}T12:00:00`); return { from: formatCalendarDate(new Date(date.getFullYear(), date.getMonth(), 1)), to: formatCalendarDate(new Date(date.getFullYear(), date.getMonth() + 1, 0)) }; };

export function MeetingsPage() {
  const [selectedDate, setSelectedDate] = useState(() => formatCalendarDate(new Date()));
  const [events, setEvents] = useState([]); const [status, setStatus] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const initialLoad = useRef(true);
  const range = useMemo(() => monthRange(selectedDate), [selectedDate]);
  const refresh = async () => { setError(""); try { const [statusResult, eventResult] = await Promise.all([loadDingTalkStatus(), loadDingTalkEvents(range)]); setStatus(statusResult.data || statusResult); setEvents(eventResult.data?.items || eventResult.items || []); } catch (err) { setError(err.message || "钉钉日程加载失败"); } };
  useEffect(() => { if (initialLoad.current) { initialLoad.current = false; void sync(); } else void refresh(); }, [range.from, range.to]);
  useEffect(() => { const timer = window.setInterval(() => { void refresh(); }, 60 * 1000); return () => window.clearInterval(timer); }, [range.from, range.to]);
  const authorize = async () => { setBusy(true); setError(""); try { const result = await startDingTalkOAuth(); if (result.authorizationUrl) window.location.assign(result.authorizationUrl); } catch (err) { setError(err.message || "无法启动钉钉授权"); } finally { setBusy(false); } };
  const sync = async () => { setBusy(true); setError(""); try { await syncDingTalk({ ...range, resources: ["events"] }); await refresh(); } catch (err) { setError(err.message || "钉钉日程同步失败"); } finally { setBusy(false); } };
  const markedDates = useMemo(() => new Set(events.map((event) => event.startAt?.slice(0, 10)).filter(Boolean)), [events]);
  const selectedEvents = useMemo(() => events.filter((event) => event.startAt?.slice(0, 10) === selectedDate).sort((a, b) => a.startAt.localeCompare(b.startAt)), [events, selectedDate]);
  const time = (value) => value ? new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "全天";
  return <div className="page page--work-management"><PageHeader eyebrow="DINGTALK / CALENDAR" title="会议日程" description="按日期查看钉钉会议与准备信息。" aside={<span className="work-page-icon"><IconCalendarEvent size={20} /></span>} />
    <div className="work-notice"><span className={`status-dot ${status?.connected ? "status-dot--ok" : "status-dot--warn"}`} /><div><strong>{status?.connected ? "钉钉日程已连接" : status?.configured ? "钉钉日程待授权" : "钉钉日程未配置"}</strong><span>{status?.sync?.events?.lastSuccessAt ? `最近同步：${new Date(status.sync.events.lastSuccessAt).toLocaleString("zh-CN")} · 每 1 小时自动同步当前月` : "进入页面时同步当前月份；切换月份仅读取本地缓存"}</span></div><div className="report-hero__actions">{status?.connected && <button className="work-button" disabled={busy} onClick={sync} type="button"><IconRefresh size={14} />立即同步</button>}<button className="work-button work-button--primary" disabled={busy || !status?.configured} onClick={authorize} type="button">{status?.connected ? "重新授权" : "连接钉钉"}</button></div></div>
    {error && <div className="work-error" role="alert">{error}</div>}
    <div className="team-reports-layout"><section className="team-reports-content"><div className="team-reports-content__head"><div><span className="eyebrow">DINGTALK SCHEDULE</span><h2>{selectedDate} <small>{selectedEvents.length} 场日程</small></h2></div><span className="team-reports-content__hint">点击右侧日期查看当天日程</span></div><section className="meeting-list" aria-label="当天会议日程">{selectedEvents.length ? selectedEvents.map((event) => <article className="meeting-row" key={event.id}><time>{event.isAllDay ? "全天" : time(event.startAt)}<small>{event.isAllDay ? "" : `${time(event.endAt)} 结束`}</small></time><div><span className="badge">钉钉日程</span><strong>{event.title}</strong><p>{[event.location, event.organizer, event.attendees?.length ? `${event.attendees.length} 位参与人` : ""].filter(Boolean).join(" · ") || "暂无地点或参与人信息"}</p>{event.meetingUrl && <a className="work-link" href={event.meetingUrl} rel="noreferrer" target="_blank">打开会议链接</a>}</div><IconCalendarEvent aria-hidden="true" size={20} /></article>) : <div className="report-empty"><IconCalendarEvent size={24} /><strong>当天暂无钉钉日程</strong><span>请在右侧日历选择其他日期，或点击“立即同步”。</span></div>}</section></section><WorkbenchCalendar ariaLabel="钉钉日程日历" selectedDate={selectedDate} markedDates={markedDates} onSelect={setSelectedDate} /></div>
  </div>;
}
