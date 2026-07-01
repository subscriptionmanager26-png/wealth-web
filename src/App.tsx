import { useEffect, useRef, useState } from "react";

import { AccountDetailsTab } from "./components/AccountDetailsTab";
import { AccountTab } from "./components/AccountTab";
import { AnalysisTab } from "./components/AnalysisTab";
import { CasUploadModal } from "./components/CasUploadModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { EmptyState, Layout, type AccountSubTabId } from "./components/Layout";
import { FundsTab } from "./components/FundsTab";
import { InsightsTab } from "./components/InsightsTab";
import { OverviewTab } from "./components/OverviewTab";
import { PortfolioChatTab } from "./components/PortfolioChatTab";
import { ScreenerTab } from "./components/ScreenerTab";
import { PortfolioPicker } from "./components/PortfolioPicker";
import { SourceMappingModal } from "./components/SourceMappingModal";
import { usePortfolioApp } from "./hooks/usePortfolioApp";
import { useMunshiChat } from "./hooks/useMunshiChat";

export default function App() {
  const app = usePortfolioApp();
  const munshi = useMunshiChat();
  const { startNewChat, busy: aiChatBusy } = munshi;
  const [uploadOpen, setUploadOpen] = useState(false);
  const [accountSubTab, setAccountSubTab] = useState<AccountSubTabId>("uploaded");
  const [profilePickerOpen, setProfilePickerOpen] = useState(false);
  const [sourceMapOpen, setSourceMapOpen] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiHistoryOpen, setAiHistoryOpen] = useState(false);
  const [aiNewChatSeq, setAiNewChatSeq] = useState(0);

  useEffect(() => {
    if (!app.toast) return;
    const t = setTimeout(() => app.setToast(null), 5000);
    return () => clearTimeout(t);
  }, [app.toast, app.setToast]);

  const newChatSeqRef = useRef(aiNewChatSeq);
  useEffect(() => {
    if (newChatSeqRef.current === aiNewChatSeq) return;
    newChatSeqRef.current = aiNewChatSeq;
    startNewChat();
  }, [aiNewChatSeq, startNewChat]);

  const hasData = app.savedCasFiles.length > 0;
  const showPortfolioPicker = app.bottomTab === "home" && hasData && !app.hydrating;

  let content;
  if (app.bottomTab === "account") {
    content =
      accountSubTab === "details" ? (
        <AccountDetailsTab
          profileStats={app.profileStats}
          savedInvestors={app.savedInvestors}
          activePortfolioName={app.activePortfolioProfile?.name ?? "Family Portfolio"}
          onAddMember={app.addMember}
        />
      ) : (
        <AccountTab
          savedCasFiles={app.savedCasFiles}
          savedParsedDocs={app.savedParsedDocs}
          milestones={app.pipelineMilestones}
          uploadBusy={app.uploadBusy}
          amfiMappingBusy={app.amfiMappingBusy}
          analyticsLoading={app.analyticsLoading}
          hydrating={app.hydrating}
          holdingsCount={app.allHoldings.length}
          navStatus={app.portfolioNavStatus.kind}
          navDetail={app.portfolioNavStatus.detail}
          amfiMappingLog={app.amfiMappingLog}
          onRefreshNav={() => void app.refreshNav()}
          onRetryMapping={() => void app.retryAmfiMapping()}
          onRemoveCas={(id) => void app.removeCas(id)}
          onUploadClick={() => setUploadOpen(true)}
          onOpenSourceMapping={() => setSourceMapOpen(true)}
        />
      );
  } else if (app.bottomTab === "screener") {
    content = <ScreenerTab />;
  } else if (app.bottomTab === "ai") {
    content = app.hydrating ? (
      <div className="loading-row center">
        <span className="spinner" /> Loading saved statements…
      </div>
    ) : (
      <PortfolioChatTab
        chat={munshi}
        portfolioView={app.activeProfileId === "family" ? "family" : "member"}
        hero={app.hero}
        holdings={app.holdings}
        perf={app.perf}
        portfolioFundamentals={app.portfolioFundamentals}
        sectorRows={app.sectorRows}
        stockRows={app.stockRows}
        assetSlices={app.assetSlices}
        upvalySchemes={app.upvalySchemes}
        benchmarkMonthEnds={app.benchmarkMonthEnds}
        insightsLoading={app.upvalyInsightsLoading}
        settingsOpen={aiSettingsOpen}
        onSettingsClose={() => setAiSettingsOpen(false)}
        onSettingsOpen={() => setAiSettingsOpen(true)}
        historyOpen={aiHistoryOpen}
        onHistoryClose={() => setAiHistoryOpen(false)}
        hasPortfolioData={hasData}
        onUploadClick={() => setUploadOpen(true)}
      />
    );
  } else if (app.hydrating) {
    content = (
      <div className="loading-row center">
        <span className="spinner" /> Loading saved statements…
      </div>
    );
  } else if (!hasData) {
    content = (
      <EmptyState
        title="Upload your first CAS"
        body="Drop a CAMS or KFintech consolidated account statement PDF. We store statements on this device and build your portfolio from them."
        onUploadClick={() => setUploadOpen(true)}
        uploadBusy={app.uploadBusy}
        onScreenerClick={() => app.setBottomTab("screener")}
      />
    );
  } else if (app.homeTab === "overview") {
    content = (
      <OverviewTab
        hero={app.hero}
        profileName={app.activePortfolioProfile?.name ?? "Family Portfolio"}
        casCount={app.savedCasFiles.length}
      />
    );
  } else if (app.homeTab === "analysis") {
    content = (
      <AnalysisTab
        hero={app.hero}
        perf={app.perf}
        portfolioFundamentals={app.portfolioFundamentals}
        assetSlices={app.assetSlices}
        sectorRows={app.sectorRows}
        stockRows={app.stockRows}
        upvalySchemes={app.upvalySchemes}
        holdings={app.analysisHoldings}
        savedParsedDocs={app.savedParsedDocs}
        showOwnerTags={app.activeProfileId === "family"}
        overviewSharpe={app.overviewSharpe}
        onOpenInsights={() => app.setHomeTab("insights")}
        benchmarkMonthEnds={app.benchmarkMonthEnds}
        benchmarkDailyNav={app.benchmarkDailyNav}
        sellFundsCount={app.sellFundsCount}
      />
    );
  } else if (app.homeTab === "insights") {
    content = (
      <InsightsTab
        holdings={app.insightsEligibleHoldings.map((h) => ({
          id: h.id,
          name: h.name,
          category: h.category,
          subCategory: h.category,
          returnPct: h.returnPct,
          amount: h.amount,
          amfiCode: h.amfiCode,
        }))}
        equityPct={app.equityWeightPct}
        familyXirr={app.familyXirr}
        upvalySchemes={app.upvalySchemes}
        nifty500MonthEnds={app.benchmarkMonthEnds.nifty500 ?? []}
        insightsLoading={app.upvalyInsightsLoading}
      />
    );
  } else if (app.homeTab === "funds") {
    content = (
      <FundsTab
        holdings={app.holdings}
        portfolioTotal={app.hero.total}
        upvalySchemes={app.upvalySchemes}
        insightsLoading={app.upvalyInsightsLoading}
      />
    );
  } else {
    content = (
      <div className="loading-row center">
        <span className="spinner" /> Loading…
      </div>
    );
  }

  return (
    <>
      <Layout
        bottomTab={app.bottomTab}
        onBottomTabChange={app.setBottomTab}
        homeTab={app.homeTab}
        onHomeTabChange={app.setHomeTab}
        accountSubTab={accountSubTab}
        onAccountSubTabChange={setAccountSubTab}
        onUploadClick={() => setUploadOpen(true)}
        uploadBusy={app.uploadBusy}
        amfiMappingBusy={app.amfiMappingBusy}
        onAiSettingsClick={() => setAiSettingsOpen(true)}
        onAiMenuClick={() => setAiHistoryOpen(true)}
        onAiNewChatClick={() => setAiNewChatSeq((n) => n + 1)}
        aiNewChatDisabled={aiChatBusy}
      >
        <ErrorBoundary>{content}</ErrorBoundary>
      </Layout>

      {showPortfolioPicker ? (
        <PortfolioPicker
          visible
          open={profilePickerOpen}
          profiles={app.profileStats}
          activeProfileId={app.activeProfileId}
          onToggle={() => setProfilePickerOpen((v) => !v)}
          onSelect={app.setActiveProfileId}
          onClose={() => setProfilePickerOpen(false)}
        />
      ) : null}

      <CasUploadModal
        open={uploadOpen}
        busy={app.uploadBusy}
        status={app.pipelineStatus}
        onClose={() => setUploadOpen(false)}
        onUpload={app.processCasFile}
      />

      <SourceMappingModal
        open={sourceMapOpen}
        onClose={() => setSourceMapOpen(false)}
        holdings={app.allHoldings}
      />

      {app.toast ? <div className={`toast toast-${app.toast.kind}`}>{app.toast.text}</div> : null}
    </>
  );
}
