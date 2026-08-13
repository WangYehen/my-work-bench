import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import gsap from "gsap";
import { IconArrowUpRight } from "@tabler/icons-react";
import { DecryptedText } from "../components/DecryptedText";
import { DotEyes } from "../components/DotEyes";
import { KnowledgeGraph } from "../components/KnowledgeGraph";
import { MetricStat } from "../components/MetricStat";
import { loadDingTalkEvents, loadDingTalkStatus, loadGraph, loadOutlookStatus, loadOverview, loadTasks } from "../lib/api";
import { workSnapshot } from "../data/work-management";
import { formatCompactDate } from "../lib/format";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const REFRESH_INTERVAL_MS = 60_000;

let overviewEntranceHasCompleted = false;

export function OverviewPage({ onOpenDocument }) {
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [graph, setGraph] = useState(null);
  const [outlook, setOutlook] = useState(null);
  const [dingtalkEvents, setDingTalkEvents] = useState([]);
  const [tasks, setTasks] = useState(() => workSnapshot.tasks.map((task) => ({
    ...task,
    status: task.completed ? "completed" : "open",
  })));
  const rootRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const refreshOverview = () => {
      loadOverview().then((res) => {
        if (!cancelled) setOverview(res);
      });
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshOverview();
    };
    refreshOverview();
    loadGraph().then((res) => {
      if (!cancelled) setGraph(res);
    });
    loadOutlookStatus().then((res) => {
      if (!cancelled) setOutlook(res.data);
    });
    const todayKey = new Date().toISOString().slice(0, 10);
    loadDingTalkStatus().then((res) => {
      if (res.data?.connected || res.connected) return loadDingTalkEvents({ from: todayKey, to: todayKey });
      return null;
    }).then((res) => {
      if (!cancelled && res) {
        const events = res.data?.items || res.items || [];
        setDingTalkEvents(events.filter((event) => event.startAt && new Date(event.startAt).getTime() > Date.now()).sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime()));
      }
    }).catch(() => {});
    loadTasks().then((res) => {
      if (!cancelled) setTasks(res.items || []);
    });
    const interval = window.setInterval(refreshOverview, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshOverview);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOverview);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  // 入场编排：hero → 指标条 → 面板，GSAP 一次性时间线
  useEffect(() => {
    if (!overview || overviewEntranceHasCompleted) return undefined;
    if (prefersReducedMotion()) {
      overviewEntranceHasCompleted = true;
      return undefined;
    }
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from("[data-hero] > div > *", { y: 18, opacity: 0, duration: 0.5, stagger: 0.07 })
        .from(".metric-strip", { y: 16, opacity: 0, duration: 0.45 }, "-=0.25")
        .from(
          "[data-panel]",
          { y: 20, opacity: 0, duration: 0.5, stagger: 0.08 },
          "-=0.2",
        );
      tl.eventCallback("onComplete", () => {
        overviewEntranceHasCompleted = true;
      });
    }, rootRef);
    return () => ctx.revert();
  }, [overview]);

  const demoMode = overview?.data?.demoMode === true;
  const recent = overview?.data?.recent ?? [];
  const provenance = overview?.data?.qualityNotices ?? [];
  const graphData = graph?.data;
  const openTasks = tasks.filter((task) => task.status === "open").length;
  const nextMeeting = dingtalkEvents[0] ? { ...dingtalkEvents[0], time: new Date(dingtalkEvents[0].startAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) } : { time: "—", title: "暂无已同步日程" };

  const upcomingMeetings = dingtalkEvents
    .filter((event) => event.startAt && new Date(event.startAt).getTime() > Date.now())
    .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime());
  const upcomingMeeting = upcomingMeetings[0] || null;
  const upcomingMeetingTime = upcomingMeeting?.startAt
    ? new Date(upcomingMeeting.startAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" })
    : "—";

  const today = useMemo(
    () =>
      new Intl.DateTimeFormat("zh-CN", {
        month: "long",
        day: "numeric",
        weekday: "long",
      }).format(new Date()),
    [],
  );

  const fromFallback = overview?.source === "fallback";
  const overviewLoading = !overview;
  const liveDataReady = Boolean(overview && !fromFallback);
  const overviewSettled = Boolean(overview);

  return (
    <div ref={rootRef}>
      <section className="hero" data-hero>
        <div>
          <span className="eyebrow">
            <DecryptedText
              active={liveDataReady}
              settleWithoutAnimation={overviewSettled && !liveDataReady}
              text="PERSONAL AI WORKBENCH"
            />
            <span aria-hidden="true">·</span>
            <span>{today}</span>
          </span>
          <h1 className="hero__title">工作台总览</h1>
          <div className="hero__meta">
            <span className="badge">
              <span className="status-dot status-dot--ok" /> {demoMode ? "示例 Vault" : "本地 Vault"}
            </span>
            {overviewLoading ? (
              <span className="badge">
                <span className="status-dot" /> 索引连接中
              </span>
            ) : fromFallback ? (
              <span className="badge">
                <span className="status-dot status-dot--warn" /> 数据服务离线
              </span>
            ) : (
              <span className="badge badge--accent">索引实时</span>
            )}
          </div>
        </div>
        <DotEyes awake={liveDataReady} />
      </section>

      <div className="metric-strip">
        <MetricStat label="今日待办" value={openTasks} hint="项待完成" accent onClick={() => navigate("/todos")} />
        <MetricStat
          label="本周关注"
          value={workSnapshot.focus.length}
          hint="重要想法 / 关注点"
          onClick={() => navigate("/weekly-focus")}
        />
        <MetricStat
          label="下一场会议"
          value={nextMeeting?.time ?? "—"}
          hint={nextMeeting?.title ?? "暂无日程"}
          accent
          onClick={() => navigate("/meetings")}
        />
        <MetricStat
          label="待办邮件"
          value={outlook?.todoCount ?? 0}
          hint={outlook?.connected ? "Outlook 已连接" : "Outlook 待连接"}
          onClick={() => navigate("/outlook")}
        />
        <MetricStat
          label="知识链接"
          value={graphData?.stats?.edgeCount ?? null}
          hint="Wiki 双向关系"
          onClick={() => navigate("/graph")}
        />
      </div>

      <div className="overview-grid">
        <div className="overview-stack">
          <section className="panel graph-preview panel--hover" data-panel>
            <div className="graph-preview__overlay">
              <span className="eyebrow">KNOWLEDGE GRAPH</span>
            </div>
            {graphData && graphData.nodes.length > 0 ? (
              <>
                <KnowledgeGraph
                  edges={graphData.edges}
                  nodes={graphData.nodes}
                  preview
                />
                <span className="graph-preview__stats">
                  {graphData.stats.nodeCount} nodes · {graphData.stats.edgeCount} links
                </span>
              </>
            ) : (
              <div className="collection-empty">图谱数据加载中…</div>
            )}
            <button
              className="graph-preview__cta graph-filter graph-filter--on"
              onClick={() => navigate("/graph")}
              type="button"
            >
              进入星图 <IconArrowUpRight size={14} />
            </button>
          </section>

          <section className="panel" data-panel>
            <div className="panel__head">
              <div>
                <span className="eyebrow">RECENT</span>
                <h2 className="panel__title" style={{ marginTop: 8 }}>
                  最近更新
                </h2>
              </div>
            </div>
            <div className="recent-list">
              {recent.length === 0 ? (
                <div className="collection-empty">暂无记录</div>
              ) : (
                recent.map((item) => (
                  <div
                    className="recent-item"
                    key={item.id}
                    onClick={() => onOpenDocument?.(item)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") onOpenDocument?.(item);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <span
                      className={`status-dot${item.type === "Wiki" ? " status-dot--accent" : ""}`}
                    />
                    <span className="recent-item__title">{item.title}</span>
                    <span className="recent-item__meta">{item.section}</span>
                    <span className="recent-item__meta">
                      {formatCompactDate(item.updatedAt, false)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="overview-stack">
          <section className="panel" data-panel>
            <div className="panel__head">
              <div>
                <span className="eyebrow">WORK RHYTHM</span>
                <h2 className="panel__title" style={{ marginTop: 8 }}>
                  今日工作节奏
                </h2>
              </div>
              <button
                className="graph-filter"
                onClick={() => navigate("/todos")}
                type="button"
              >
                查看待办
              </button>
            </div>
            <div className="pipeline">
              {tasks.filter((task) => task.status === "open").slice(0, 3).map((task) => (
                <div className="pipeline__row" key={task.id}>
                  <span className="status-dot status-dot--accent status-dot--pulse" />
                  <span className="pipeline__title">{task.title}</span>
                  <span className="pipeline__stage">{task.priority}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel" data-panel>
            <div className="panel__head">
              <div>
                <span className="eyebrow">WIKI STATUS</span>
                <h2 className="panel__title" style={{ marginTop: 8 }}>
                  知识层健康度
                </h2>
              </div>
            </div>
            <div className="pipeline">
              {[
                ["active", "活跃", overview?.data?.wikiStatus?.active],
                ["needsReview", "待复核", overview?.data?.wikiStatus?.needsReview],
                ["deprecated", "已弃用", overview?.data?.wikiStatus?.deprecated],
                ["unlabeled", "未标注", overview?.data?.wikiStatus?.unlabeled],
              ].map(([key, label, count]) => (
                <div className="pipeline__row" key={key}>
                  <span
                    className={`status-dot${
                      key === "active"
                        ? " status-dot--ok"
                        : key === "needsReview"
                          ? " status-dot--warn"
                          : ""
                    }`}
                  />
                  <span className="pipeline__title">{label}</span>
                  <span className="pipeline__stage mono">{count ?? "—"}</span>
                </div>
              ))}
            </div>
            {provenance.length > 0 ? (
              <div className="provenance">
                {provenance.slice(0, 2).map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
