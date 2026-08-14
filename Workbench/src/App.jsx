import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { DocumentDrawer } from "./components/DocumentDrawer";
import { SearchPalette } from "./components/SearchPalette";
import { CollectionPage } from "./pages/CollectionPage";
import { DailyHotPage } from "./pages/DailyHotPage";
import { GraphPage } from "./pages/GraphPage";
import { MaterialsPage } from "./pages/MaterialsPage";
import { BooksPage } from "./pages/BooksPage";
import { OverviewPage } from "./pages/OverviewPage";
import { TodayWorkPage } from "./pages/TodayWorkPage";
import { SystemPage } from "./pages/SystemPage";
import { TopicsPage } from "./pages/TopicsPage";
import { WorkManagementPage } from "./pages/WorkManagementPage";
import { MeetingsPage } from "./pages/MeetingsPage";
import { DailyReportPage } from "./pages/DailyReportPage";
import { TeamReportsAdminPage } from "./pages/TeamReportsAdminPage";
import { TeamRiskPage } from "./pages/TeamRiskPage";
import { TeamWeeklyReportPage } from "./pages/TeamWeeklyReportPage";
import { OutlookPage } from "./pages/OutlookPage";
import { SocialInsightsPage, SocialTrendDetailPage } from "./pages/SocialInsightsPage";
import { useVaultSync } from "./hooks/useVaultSync";
import { getDailyReportUser, subscribeDailyReportAuth } from "./lib/daily-reports";

const localWorkbench = import.meta.env.VITE_WORKBENCH_HOSTED !== "true";

function PrivacyLockedPage() {
  return <main className="privacy-locked-page"><section><span>PRIVACY LOCKED</span><h1>个人数据已隐藏</h1><p>请先在“系统状态”登录钉钉账号。登录后才会加载邮箱、日程、任务、日报及其他个人内容。</p></section></main>;
}

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState(null);
  const [readerContext, setReaderContext] = useState(null);
  const [teamUser, setTeamUser] = useState(null);
  const vaultSync = useVaultSync(location.pathname);
  const routeRevision =
    location.pathname.startsWith("/social-insights")
    ? location.pathname
    : `${location.pathname}:${vaultSync.revision}`;

  useEffect(() => {
    let mounted = true;
    getDailyReportUser()
      .then((result) => { if (mounted) setTeamUser(result?.user || result || null); })
      .catch(() => { if (mounted) setTeamUser(null); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => subscribeDailyReportAuth(setTeamUser), []);

  useEffect(() => {
    if (teamUser) return;
    setSearchOpen(false);
    setSelectedDocumentId(null);
    setReaderContext(null);
  }, [teamUser]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    setSearchOpen(false);
    setSelectedDocumentId(null);
    setReaderContext(null);
  }, [location.pathname]);

  const openDocument = useCallback((documentOrId) => {
    const id =
      typeof documentOrId === "string"
        ? documentOrId
        : documentOrId?.id ?? documentOrId?.relativePath;
    if (id) {
      setSelectedDocumentId(id);
      setReaderContext(
        typeof documentOrId === "object" ? documentOrId.readerContext || null : null,
      );
    }
  }, []);

  const appContext = useMemo(
    () => ({
      navigate,
      openDocument,
      openSearch: () => setSearchOpen(true),
    }),
    [navigate, openDocument],
  );

  return (
    <>
      <AppShell onOpenSearch={appContext.openSearch} sync={vaultSync} teamUser={teamUser}>
        {!teamUser && location.pathname !== "/system" ? <PrivacyLockedPage /> : <Routes key={`${routeRevision}:${teamUser?.id || "locked"}`}>
          <Route path="/" element={<TodayWorkPage />} />
          <Route path="/overview" element={<OverviewPage onOpenDocument={openDocument} />} />
          <Route path="/graph" element={<GraphPage onOpenDocument={openDocument} />} />
          <Route
            path="/wiki"
            element={
              <CollectionPage
                kind="wiki"
                eyebrow="KNOWLEDGE LAYER"
                title="Wiki 层"
                description="结构化知识：来源拆解、概念、框架、诊断与待验证问题。星图的线性视图。"
                onOpenDocument={openDocument}
              />
            }
          />
          <Route
            path="/materials"
            element={<MaterialsPage onOpenDocument={openDocument} />}
          />
          <Route path="/books" element={<BooksPage onOpenDocument={openDocument} />} />
          <Route path="/books/:bookId" element={<BooksPage onOpenDocument={openDocument} />} />
          <Route path="/daily-hot" element={<DailyHotPage />} />
          <Route path="/todos" element={<WorkManagementPage module="todos" />} />
          <Route path="/weekly-focus" element={<WorkManagementPage module="focus" />} />
          <Route path="/meetings" element={<MeetingsPage />} />
          {localWorkbench ? <Route path="/outlook" element={<OutlookPage />} /> : null}
          <Route path="/weekly-report" element={<WorkManagementPage module="reports" />} />
          <Route path="/daily-report" element={<DailyReportPage />} />
          <Route path="/team-reports" element={teamUser && !teamUser.canViewTeamReports && teamUser.role === "member" ? <Navigate replace to="/daily-report" /> : <TeamReportsAdminPage />} />
          <Route path="/team-risks" element={teamUser && !teamUser.canViewTeamReports && teamUser.role === "member" ? <Navigate replace to="/daily-report" /> : <TeamRiskPage />} />
          <Route path="/team-weekly-report" element={teamUser && !teamUser.canViewTeamReports && teamUser.role === "member" ? <Navigate replace to="/weekly-report" /> : <TeamWeeklyReportPage />} />
          {localWorkbench ? (
            <Route
              path="/social-insights"
              element={
                <SocialInsightsPage
                  onOpenDocument={openDocument}
                  syncRevision={vaultSync.revision}
                />
              }
            />
          ) : null}
          {localWorkbench ? (
            <Route
              path="/social-insights/trends/:trendId"
              element={
                <SocialTrendDetailPage
                  onOpenDocument={openDocument}
                  syncRevision={vaultSync.revision}
                />
              }
            />
          ) : null}
          {localWorkbench ? (
            <Route
              path="/social-insights/:reportId"
              element={
                <SocialInsightsPage
                  onOpenDocument={openDocument}
                  syncRevision={vaultSync.revision}
                />
              }
            />
          ) : null}
          <Route
            path="/topics"
            element={<TopicsPage onOpenDocument={openDocument} />}
          />
          <Route path="/system" element={<SystemPage />} />
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>}
      </AppShell>

      {teamUser ? <SearchPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenDocument={(document) => {
          openDocument(document);
          setSearchOpen(false);
        }}
      /> : null}

      {teamUser ? <DocumentDrawer
        documentId={selectedDocumentId}
        onNavigateDocument={openDocument}
        onClose={() => {
          setSelectedDocumentId(null);
          setReaderContext(null);
        }}
        readingContext={readerContext}
      /> : null}
    </>
  );
}
