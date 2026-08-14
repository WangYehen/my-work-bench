import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { listDailyReportAccounts, switchDailyReportAccount, logoutDailyReport } from "../lib/daily-reports";
import {
  IconAlertTriangle,
  IconCalendarClock,
  IconCalendarEvent,
  IconClipboardCheck,
  IconChevronDown,
  IconCommand,
  IconFlame,
  IconHome,
  IconMail,
  IconMenu2,
  IconReportAnalytics,
  IconSearch,
  IconShieldCheck,
  IconTargetArrow,
  IconUserFilled,
  IconUsersGroup,
  IconX,
} from "@tabler/icons-react";

const localWorkbench = import.meta.env.VITE_WORKBENCH_HOSTED !== "true";

const primaryNavigation = [
  { to: "/", label: "今日工作", icon: IconHome, end: true, group: "work" },
  { to: "/weekly-focus", label: "本周目标", icon: IconTargetArrow, group: "work" },
  { to: "/daily-report", label: "日报", icon: IconCalendarEvent, group: "work" },
  { to: "/weekly-report", label: "周报", icon: IconClipboardCheck, group: "work" },
  { to: "/meetings", label: "会议日程", icon: IconCalendarClock, group: "more" },
  ...(localWorkbench ? [{ to: "/outlook", label: "工作邮箱", icon: IconMail, group: "more" }] : []),
  { to: "/daily-hot", label: "每日热点", icon: IconFlame, group: "more" },
  { to: "/system", label: "系统状态", icon: IconShieldCheck, group: "more" },
];

const leaderNavigation = [
  { to: "/team-reports", label: "团队日报", icon: IconUsersGroup, group: "leader" },
  { to: "/team-risks", label: "风险与未提交", icon: IconAlertTriangle, group: "leader" },
  { to: "/team-weekly-report", label: "团队周报", icon: IconReportAnalytics, group: "leader" },
];

const groupLabel = { leader: "团队", more: "更多" };

export function AppShell({ children, onOpenSearch, teamUser }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const canLead = teamUser?.role === "admin" || teamUser?.canViewTeamReports;
  const navigation = canLead
    ? [...primaryNavigation.filter((item) => item.group === "work"), ...leaderNavigation, ...primaryNavigation.filter((item) => item.group !== "work")]
    : primaryNavigation;

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  const openAccountMenu = async () => {
    setAccountMenuOpen((value) => !value);
    if (!accountMenuOpen) {
      const result = await listDailyReportAccounts().catch(() => null);
      setAccounts(result?.accounts || []);
    }
  };
  const switchAccount = async (accountId) => { await switchDailyReportAccount(accountId); setAccountMenuOpen(false); };
  const logout = async () => { await logoutDailyReport(); setAccountMenuOpen(false); };

  return (
    <div className={`app-shell${sidebarCollapsed ? " app-shell--sidebar-collapsed" : ""}`}>
      <header className="mobile-header">
        <button
          aria-label="打开导航"
          className="icon-button"
          onClick={() => {
            setSidebarCollapsed(false);
            setMobileOpen(true);
          }}
          type="button"
        >
          <IconMenu2 aria-hidden="true" />
        </button>
        <span className="mobile-header__brand">
          <img alt="" aria-hidden="true" src="/workbench-mark.svg" />
          <span>个人AI工作台</span>
        </span>
        {teamUser ? <button
          aria-label="搜索"
          className="icon-button"
          onClick={onOpenSearch}
          type="button"
        >
          <IconSearch aria-hidden="true" />
        </button> : null}
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
            <div className="sidebar__brand-lockup">
              <NavLink className="sidebar__brand" onClick={() => setMobileOpen(false)} to="/">
                <img alt="" aria-hidden="true" src="/workbench-mark.svg" />
                <strong>个人AI工作台</strong>
              </NavLink>
              <span className="sidebar__brand-tagline">PERSONAL AI WORKBENCH</span>
            </div>
            <button
              aria-label="关闭导航"
              className="icon-button sidebar__close"
              onClick={() => {
                setMobileOpen(false);
                setSidebarCollapsed(true);
              }}
              type="button"
            >
              <IconX aria-hidden="true" />
            </button>
          </div>
          <nav aria-label="主要导航" className="sidebar__nav">
            {navigation.map((item, index) => {
              const Icon = item.icon;
              return (
                <div className="sidebar__nav-entry" key={item.to}>
                {item.group !== "work" && navigation[index - 1]?.group !== item.group ? <span className="sidebar__nav-section">{groupLabel[item.group]}</span> : null}
                <NavLink
                  className={({ isActive }) =>
                    `sidebar__nav-item${isActive ? " sidebar__nav-item--active" : ""}`
                  }
                  end={item.end}
                  onClick={() => setMobileOpen(false)}
                  to={item.to}
                >
                  <Icon aria-hidden="true" className="sidebar__nav-icon" stroke={1.65} />
                  <span>{item.label}</span>
                </NavLink>
                </div>
              );
            })}
          </nav>
        </div>

        <div className="sidebar__bottom">
          <button className="sidebar__profile" onClick={openAccountMenu} type="button">
            <span className="sidebar__avatar" aria-hidden="true">{teamUser?.avatarUrl ? <img alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} src={teamUser.avatarUrl} /> : <IconUserFilled />}</span>
            <span className="sidebar__profile-copy">
              <strong>{teamUser?.displayName || teamUser?.username || "个人账户"}</strong>
              <small>{teamUser ? `${teamUser.departmentName || "未同步部门"} · ${teamUser.role === "admin" ? "管理员" : teamUser.role === "manager" || teamUser.canViewTeamReports ? "主管" : "成员"}` : "本地工作台"}</small>
            </span>
            <IconChevronDown aria-hidden="true" className="sidebar__profile-chevron" stroke={1.6} />
          </button>
          {accountMenuOpen ? <div className="sidebar__account-menu" role="menu">
            {accounts.map((account) => <button disabled={account.id === teamUser?.id} key={account.id} onClick={() => switchAccount(account.id)} role="menuitem" type="button">{account.avatarUrl ? <img alt="" src={account.avatarUrl} /> : null}<span>{account.displayName}</span>{account.id === teamUser?.id ? <small>当前</small> : null}</button>)}
            <NavLink onClick={() => { setAccountMenuOpen(false); setMobileOpen(false); }} to="/system">添加账号</NavLink>
            {teamUser ? <button onClick={logout} role="menuitem" type="button">退出当前账号</button> : null}
          </div> : null}
        </div>
      </aside>

      {sidebarCollapsed ? (
        <button
          aria-label="展开导航"
          className="icon-button sidebar-reopen"
          onClick={() => setSidebarCollapsed(false)}
          type="button"
        >
          <IconMenu2 aria-hidden="true" />
        </button>
      ) : null}

      <main className="app-main">{children}</main>

      {teamUser ? <button
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
      </button> : null}
    </div>
  );
}
