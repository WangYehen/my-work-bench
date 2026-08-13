import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  IconBulb,
  IconCalendarEvent,
  IconCalendarStats,
  IconChecklist,
  IconClipboardCheck,
  IconCommand,
  IconHome,
  IconLibrary,
  IconMail,
  IconMenu2,
  IconRadar2,
  IconReportAnalytics,
  IconSearch,
  IconSettings,
  IconSocial,
  IconStack2,
  IconTopologyStar3,
  IconUsersGroup,
  IconX,
} from "@tabler/icons-react";

const localWorkbench = import.meta.env.VITE_WORKBENCH_HOSTED !== "true";

const primaryNavigation = [
  { to: "/", label: "总览", icon: IconHome, end: true },
  { to: "/todos", label: "今日待办", icon: IconChecklist },
  { to: "/weekly-focus", label: "本周关注", icon: IconBulb },
  { to: "/meetings", label: "会议日程", icon: IconCalendarStats },
  ...(localWorkbench ? [{ to: "/outlook", label: "工作邮箱", icon: IconMail }] : []),
  { to: "/weekly-report", label: "周报总结", icon: IconReportAnalytics },
  { to: "/daily-report", label: "日报提交", icon: IconClipboardCheck },
  { to: "/team-reports", label: "团队日报", icon: IconUsersGroup },
  { to: "/graph", label: "知识星图", icon: IconTopologyStar3 },
  { to: "/wiki", label: "Wiki 层", icon: IconLibrary },
  { to: "/materials", label: "素材层", icon: IconStack2 },
  { to: "/daily-hot", label: "每日热点", icon: IconRadar2 },
  ...(localWorkbench
    ? [{ to: "/social-insights", label: "社媒洞察", icon: IconSocial }]
    : []),
];

export function AppShell({ children, onOpenSearch, sync, teamUser }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigation = teamUser?.role === "member"
    ? primaryNavigation.filter((item) => item.to !== "/team-reports")
    : primaryNavigation;

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  return (
    <div className="app-shell">
      <header className="mobile-header">
        <button
          aria-label="打开导航"
          className="icon-button"
          onClick={() => setMobileOpen(true)}
          type="button"
        >
          <IconMenu2 aria-hidden="true" />
        </button>
        <span className="mobile-header__brand">
          <img alt="" aria-hidden="true" src="/workbench-mark.svg" />
          <span>个人 AI</span>
        </span>
        <button
          aria-label="搜索"
          className="icon-button"
          onClick={onOpenSearch}
          type="button"
        >
          <IconSearch aria-hidden="true" />
        </button>
      </header>

      {mobileOpen ? (
        <button
          aria-label="关闭导航"
          className="sidebar-backdrop"
          onClick={() => setMobileOpen(false)}
          type="button"
        />
      ) : null}

      <aside className={`sidebar${mobileOpen ? " sidebar--open" : ""}`}>
        <div className="sidebar__top">
          <div className="sidebar__brand-row">
            <NavLink className="sidebar__brand" onClick={() => setMobileOpen(false)} to="/">
              <img alt="" aria-hidden="true" src="/workbench-mark.svg" />
              <span>个人 AI</span>
            </NavLink>
            <button
              aria-label="关闭导航"
              className="icon-button sidebar__close"
              onClick={() => setMobileOpen(false)}
              type="button"
            >
              <IconX aria-hidden="true" />
            </button>
          </div>
          <div className="sidebar__tag">PERSONAL AI WORKBENCH</div>

          <nav aria-label="主要导航" className="sidebar__nav">
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  className={({ isActive }) =>
                    `sidebar__nav-item${isActive ? " sidebar__nav-item--active" : ""}`
                  }
                  end={item.end}
                  key={item.to}
                  onClick={() => setMobileOpen(false)}
                  to={item.to}
                >
                  <Icon aria-hidden="true" className="sidebar__nav-icon" stroke={1.7} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        <div className="sidebar__bottom">
          <div className={`sidebar__sync sidebar__sync--${sync?.status || "connecting"}`}>
            <span aria-hidden="true" />
            <span>{sync?.status === "watching" ? "文件已实时同步" : sync?.status === "rebuilding" || sync?.status === "pending" ? "正在同步文件" : "正在连接文件同步"}</span>
          </div>
          <NavLink
            className="sidebar__settings"
            onClick={() => setMobileOpen(false)}
            to="/system"
          >
            <IconSettings aria-hidden="true" stroke={1.6} />
            <span>系统状态</span>
          </NavLink>
        </div>
      </aside>

      <main className="app-main">{children}</main>

      <button
        aria-label="打开全局搜索"
        className="floating-search"
        onClick={onOpenSearch}
        type="button"
      >
        <IconSearch aria-hidden="true" />
        <span>搜索知识库</span>
        <span className="floating-search__shortcut">
          <IconCommand aria-hidden="true" />K
        </span>
      </button>
    </div>
  );
}
