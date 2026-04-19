import { useState } from "react";
import { useLiveData } from "./hooks/useLiveData.js";
import { Header } from "./components/Header.jsx";
import { StatsPanel } from "./components/StatsPanel.jsx";
import { EquityCurve } from "./components/EquityCurve.jsx";
import { OpenPositions } from "./components/OpenPositions.jsx";
import { TradeHistory } from "./components/TradeHistory.jsx";
import { OnChainPanel } from "./components/OnChainPanel.jsx";
import { GoalTracker } from "./components/GoalTracker.jsx";
import { CoinMBalance } from "./components/CoinMBalance.jsx";
import { ErrorBanner } from "./components/ErrorBanner.jsx";
import { MonitorsPanel } from "./components/MonitorsPanel.jsx";
import { RulesPanel } from "./components/RulesPanel.jsx";

const TABS = ["Overview", "Trades", "On-Chain", "Monitoring", "Regras"];

export default function App() {
  const [activeTab, setActiveTab] = useState("Overview");
  const {
    overview,
    trades,
    stats,
    mode,
    loading,
    error,
    lastUpdate,
    errorsData,
    dailyRisk,
    monitors,
    marketMetrics,
    strategy,
    knowledgeBase,
    refresh,
    closeTrade,
    dismissErrors,
    clearHistory,
    repairSlTp,
  } = useLiveData(15000);

  const [repairingSlTp, setRepairingSlTp] = useState(false);
  const [repairReport, setRepairReport]   = useState(null);

  const handleRepairSlTp = async () => {
    setRepairingSlTp(true);
    setRepairReport(null);
    try {
      const result = await repairSlTp();
      setRepairReport(result);
    } catch (err) {
      setRepairReport({ errors: [err.message], checked: 0, fixed: 0, report: [] });
    } finally {
      setRepairingSlTp(false);
    }
  };

  const [clearingHistory, setClearingHistory] = useState(false);

  const handleClearHistory = async () => {
    if (!window.confirm("Apagar todo o histórico de trades fechados? Esta ação não pode ser desfeita.")) return;
    setClearingHistory(true);
    try {
      await clearHistory();
    } catch (err) {
      alert(`Erro ao apagar histórico: ${err.message}\n\nVerifique se o servidor está rodando.`);
    } finally {
      setClearingHistory(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-accent text-sm animate-pulse">
          Connecting to server...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-bg flex flex-col items-center justify-center gap-4">
        <div className="text-negative text-sm">Error: {error}</div>
        <div className="text-muted text-xs">
          Make sure <code className="text-accent">node src/api/server.js</code>{" "}
          is running on port 3001
        </div>
        <button
          onClick={refresh}
          className="px-4 py-2 border border-accent text-accent rounded text-xs hover:bg-accent/10"
        >
          Retry
        </button>
      </div>
    );
  }

  const openTrades   = trades.filter((t) => ["OPEN", "PARTIAL"].includes(t.status));
  const closedTrades = trades.filter((t) => t.status === "CLOSED" || t.status === "STOPPED");

  return (
    <div className="min-h-screen bg-bg text-text">
      <Header overview={overview} lastUpdate={lastUpdate} onRefresh={refresh} mode={mode} />

      {/* Error Banner */}
      <ErrorBanner errorsData={errorsData} onDismiss={dismissErrors} />

      {/* Daily risk limit notice */}
      {dailyRisk?.limited && (
        <div className="mx-6 mt-3 px-4 py-2.5 rounded-lg border border-yellow-500/30 bg-yellow-500/10 text-xs text-yellow-400 flex items-center gap-2">
          <span className="font-bold">DAILY LOSS LIMIT</span>
          <span className="text-yellow-400/70">·</span>
          <span>
            Loss today:{" "}
            <span className="font-mono font-bold">${dailyRisk.dailyPnl.toFixed(2)}</span>
            {" "}(limit: <span className="font-mono">-${dailyRisk.limitAmount.toFixed(2)}</span>)
          </span>
          <span className="text-yellow-400/70">·</span>
          <span>No new trades until tomorrow.</span>
        </div>
      )}
      {/* Daily profit reference — shown when goal is reached, bot keeps running */}
      {!dailyRisk?.limited && (dailyRisk?.profitReference > 0) && (dailyRisk?.dailyProfit >= dailyRisk?.profitReference) && (
        <div className="mx-6 mt-3 px-4 py-2.5 rounded-lg border border-positive/30 bg-positive/10 text-xs text-positive flex items-center gap-2">
          <span className="font-bold">META DIARIA ATINGIDA</span>
          <span className="text-positive/70">·</span>
          <span>
            Lucro hoje:{" "}
            <span className="font-mono font-bold">+${dailyRisk.dailyProfit?.toFixed(2)}</span>
            {" "}/ meta{" "}
            <span className="font-mono">${dailyRisk.profitReference?.toFixed(2)}</span>
          </span>
          <span className="text-positive/70">·</span>
          <span>Bot continua operando para maximizar lucro.</span>
        </div>
      )}

      {/* Tab Navigation */}
      <nav className="flex gap-1 px-6 pt-4 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-text"
            }`}
          >
            {tab}
            {tab === "Overview" && openTrades.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-positive/20 text-positive rounded-full text-xs">
                {openTrades.length}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="px-6 py-4 max-w-screen-2xl mx-auto">

        {/* ── Overview ── */}
        {activeTab === "Overview" && (
          <div className="space-y-4">
            {/* Stats row */}
            <StatsPanel stats={stats} overview={overview} />

            {/* Goal + CoinM balance side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <GoalTracker currentCapital={overview?.balance?.total} />
              <CoinMBalance coinMBalance={overview?.coinMBalance} />
            </div>

            {/* Equity Curve — full width */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h2 className="text-xs text-muted mb-3 tracking-wider">EQUITY CURVE</h2>
              <EquityCurve snapshots={overview?.equityCurve ?? []} />
            </div>

            {/* Open Positions — full width, scrollable */}
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs text-muted tracking-wider">OPEN POSITIONS</h2>
                {openTrades.length > 0 && (
                  <span className="text-xs text-positive font-medium">
                    {openTrades.length} active
                  </span>
                )}
              </div>
              {/* Scroll when more than 3 rows of cards */}
              <div className="overflow-y-auto max-h-96">
                <OpenPositions trades={openTrades} onClose={closeTrade} horizontal />
              </div>
            </div>
          </div>
        )}

        {/* ── Trades ── */}
        {activeTab === "Trades" && (
          <div className="space-y-4">
            {openTrades.length > 0 && (
              <div className="bg-card border border-border rounded-lg p-4">
                <h2 className="text-xs text-muted mb-3 tracking-wider">
                  OPEN POSITIONS ({openTrades.length})
                </h2>
                <OpenPositions trades={openTrades} onClose={closeTrade} horizontal />
              </div>
            )}
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs text-muted tracking-wider">
                  TRADE HISTORY ({closedTrades.length})
                </h2>
                {closedTrades.length > 0 && (
                  <button
                    onClick={handleClearHistory}
                    disabled={clearingHistory}
                    className="px-3 py-1 text-xs border border-negative/40 text-negative/70 rounded hover:border-negative hover:text-negative transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {clearingHistory ? "Apagando..." : "Clear history"}
                  </button>
                )}
              </div>
              <TradeHistory trades={trades} />
            </div>
          </div>
        )}

        {/* ── Monitoring ── */}
        {activeTab === "Monitoring" && (
          <div className="space-y-4">
            {/* SL/TP Repair */}
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-xs text-muted tracking-wider">AUDITORIA SL/TP</h2>
                  <p className="text-xs text-muted/70 mt-0.5">
                    Verifica posições abertas na BingX e aplica SL/TP ausentes.
                  </p>
                </div>
                <button
                  onClick={handleRepairSlTp}
                  disabled={repairingSlTp}
                  className="px-4 py-2 text-xs border border-accent text-accent rounded hover:bg-accent/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {repairingSlTp ? "Verificando..." : "Verificar & Reparar"}
                </button>
              </div>

              {repairReport && (
                <div className="mt-2 space-y-2">
                  <div className="flex gap-4 text-xs">
                    <span className="text-muted">Verificadas: <span className="text-text font-mono">{repairReport.checked}</span></span>
                    <span className="text-muted">Reparadas: <span className="text-positive font-mono">{repairReport.fixed}</span></span>
                    {repairReport.errors?.length > 0 && (
                      <span className="text-muted">Erros: <span className="text-negative font-mono">{repairReport.errors.length}</span></span>
                    )}
                  </div>
                  {repairReport.report?.map((r, i) => (
                    <div key={i} className={`text-xs px-3 py-2 rounded border ${
                      r.status === "ok"    ? "border-border text-muted" :
                      r.status === "fixed" ? "border-positive/30 bg-positive/5 text-positive" :
                      r.status === "error" ? "border-negative/30 bg-negative/5 text-negative" :
                      "border-border text-muted"
                    }`}>
                      <span className="font-mono font-semibold">{r.direction} {r.symbol}</span>
                      <span className="ml-2 text-muted">{r.note}</span>
                    </div>
                  ))}
                  {repairReport.errors?.map((e, i) => (
                    <div key={i} className="text-xs px-3 py-2 rounded border border-negative/30 bg-negative/5 text-negative">{e}</div>
                  ))}
                </div>
              )}
            </div>

            {/* Price Monitors */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h2 className="text-xs text-muted mb-3 tracking-wider">PRICE MONITORS</h2>
              {monitors.length > 0 ? (
                <MonitorsPanel monitors={monitors} />
              ) : (
                <p className="text-xs text-muted">
                  Nenhum monitor configurado em{" "}
                  <code className="text-accent">monitors.json</code>.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── On-Chain ── */}
        {activeTab === "On-Chain" && (
          <OnChainPanel overview={overview} marketMetrics={marketMetrics} />
        )}

        {/* ── Regras ── */}
        {activeTab === "Regras" && (
          <RulesPanel strategy={strategy} knowledgeBase={knowledgeBase} />
        )}
      </main>
    </div>
  );
}
