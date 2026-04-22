import { useState } from "react";
import { useLiveData } from "./hooks/useLiveData.js";
import { Header } from "./components/Header.jsx";
import { StatsPanel } from "./components/StatsPanel.jsx";
import { EquityCurve } from "./components/EquityCurve.jsx";
import { OpenPositions } from "./components/OpenPositions.jsx";
import { PnlBreakdownChart } from "./components/PnlBreakdownChart.jsx";
import { TradeHistory } from "./components/TradeHistory.jsx";
import { OnChainPanel } from "./components/OnChainPanel.jsx";
import { CoinMBalance } from "./components/CoinMBalance.jsx";
import { ErrorBanner } from "./components/ErrorBanner.jsx";
import { MonitorsPanel } from "./components/MonitorsPanel.jsx";
import { RulesPanel } from "./components/RulesPanel.jsx";
import { ApiHealthPanel } from "./components/ApiHealthPanel.jsx";
import { ScanResultsGrid } from "./components/ScanResultsGrid.jsx";
import { GoalProgress } from "./components/GoalProgress.jsx";
import { MonthlyPnlBars } from "./components/MonthlyPnlBars.jsx";
import { DrawdownChart } from "./components/DrawdownChart.jsx";
import { CloseReasonDonut } from "./components/CloseReasonDonut.jsx";
import { SetupPerformance } from "./components/SetupPerformance.jsx";
import { SymbolPerformance } from "./components/SymbolPerformance.jsx";
import { RiskDashboard } from "./components/RiskDashboard.jsx";

const TABS = [
  { id: "Painel",        label: "Painel" },
  { id: "Trades",        label: "Trades" },
  { id: "Analytics",     label: "Analytics" },
  { id: "On-Chain",      label: "On-Chain" },
  { id: "Monitoramento", label: "Monitoramento" },
  { id: "Regras",        label: "Regras" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("Painel");
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
    goalProgress,
    dailySeries,
    bySetup,
    bySymbol,
    drawdownSeries,
    closeReasons,
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
    if (!window.confirm("Apagar todo o historico de trades fechados? Esta acao nao pode ser desfeita.")) return;
    setClearingHistory(true);
    try {
      await clearHistory();
    } catch (err) {
      alert(`Erro ao apagar historico: ${err.message}`);
    } finally {
      setClearingHistory(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-accent animate-pulse shadow-glow" />
          <div className="text-accent text-xs tracking-[0.2em]">CONECTANDO AO SERVIDOR</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-bg flex flex-col items-center justify-center gap-4">
        <div className="text-negative text-sm">Erro: {error}</div>
        <div className="text-muted text-xs">
          Verifique se <code className="text-accent">node src/api/server.js</code> esta rodando na porta 3001
        </div>
        <button
          onClick={refresh}
          className="px-4 py-2 border border-accent text-accent rounded text-xs hover:bg-accent/10 transition-colors"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  const openTrades   = trades.filter((t) => ["OPEN", "PARTIAL"].includes(t.status));
  const closedTrades = trades.filter((t) => t.status === "CLOSED" || t.status === "STOPPED");

  return (
    <div className="min-h-screen bg-bg text-text">
      <Header
        overview={overview}
        lastUpdate={lastUpdate}
        onRefresh={refresh}
        mode={mode}
        goalProgress={goalProgress}
        dailyRisk={dailyRisk}
        openTradesCount={openTrades.length}
      />

      <ErrorBanner errorsData={errorsData} onDismiss={dismissErrors} />

      {dailyRisk?.limited && (
        <div className="mx-6 mt-3 px-4 py-2.5 rounded-lg border border-negative/40 bg-negative/10 text-xs text-negative flex items-center gap-2">
          <span className="font-bold tracking-wider">CIRCUIT BREAKER ATIVO</span>
          <span className="text-negative/70">.</span>
          <span>
            Perda hoje:{" "}
            <span className="font-mono font-bold">${dailyRisk.dailyPnl.toFixed(2)}</span>
            {" "}(limite: <span className="font-mono">-${dailyRisk.limitAmount.toFixed(2)}</span>)
          </span>
          <span className="text-negative/70">.</span>
          <span>Novos trades bloqueados ate amanha.</span>
        </div>
      )}

      {!dailyRisk?.limited && (dailyRisk?.profitReference > 0) && (dailyRisk?.dailyProfit >= dailyRisk?.profitReference) && (
        <div className="mx-6 mt-3 px-4 py-2.5 rounded-lg border border-positive/30 bg-positive/10 text-xs text-positive flex items-center gap-2">
          <span className="font-bold tracking-wider">PACE DIARIO ATINGIDO</span>
          <span className="text-positive/70">.</span>
          <span>
            Lucro hoje:{" "}
            <span className="font-mono font-bold">+${dailyRisk.dailyProfit?.toFixed(2)}</span>
            {" "}/ pace{" "}
            <span className="font-mono">${dailyRisk.profitReference?.toFixed(2)}</span>
          </span>
          <span className="text-positive/70">.</span>
          <span>Bot continua operando para maximizar lucro.</span>
        </div>
      )}

      <nav className="flex gap-1 px-6 pt-4 border-b border-border overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-xs font-medium tracking-wider transition-colors border-b-2 -mb-px whitespace-nowrap ${
              activeTab === tab.id
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-text"
            }`}
          >
            {tab.label.toUpperCase()}
            {tab.id === "Painel" && openTrades.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 bg-accent/20 text-accent rounded-full text-[10px] font-mono">
                {openTrades.length}
              </span>
            )}
          </button>
        ))}
      </nav>

      <main className="px-6 py-5 max-w-screen-2xl mx-auto animate-fade-in">

        {activeTab === "Painel" && (
          <div className="space-y-5">
            <RiskDashboard
              dailyRisk={dailyRisk}
              goalProgress={goalProgress}
              overview={overview}
              openTrades={openTrades}
            />

            <StatsPanel stats={stats} overview={overview} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <GoalProgress goalProgress={goalProgress} dailyRisk={dailyRisk} />
              <MonthlyPnlBars dailySeries={dailySeries} goalProgress={goalProgress} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5 shadow-card">
                <h2 className="text-xs text-muted tracking-[0.15em] font-medium mb-4">EQUITY CURVE</h2>
                <EquityCurve snapshots={overview?.equityCurve ?? []} />
              </div>
              <div className="bg-card border border-border rounded-xl p-5 shadow-card">
                <h2 className="text-xs text-muted tracking-[0.15em] font-medium mb-4">
                  POSICOES ABERTAS {openTrades.length > 0 && <span className="text-accent font-mono">({openTrades.length})</span>}
                </h2>
                {openTrades.length === 0 ? (
                  <p className="text-xs text-muted-dim">Nenhuma posicao aberta no momento.</p>
                ) : (
                  <OpenPositions trades={openTrades} onClose={closeTrade} />
                )}
              </div>
            </div>

            <CoinMBalance coinMBalance={overview?.coinMBalance} />
          </div>
        )}

        {activeTab === "Trades" && (
          <div className="space-y-5">
            {openTrades.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-5 shadow-card">
                <h2 className="text-xs text-muted tracking-[0.15em] font-medium mb-4">
                  POSICOES ABERTAS <span className="text-accent font-mono">({openTrades.length})</span>
                </h2>
                <OpenPositions trades={openTrades} onClose={closeTrade} horizontal />
              </div>
            )}
            <div className="bg-card border border-border rounded-xl p-5 shadow-card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs text-muted tracking-[0.15em] font-medium">
                  HISTORICO DE TRADES <span className="text-muted-dim font-mono">({closedTrades.length})</span>
                </h2>
                {closedTrades.length > 0 && (
                  <button
                    onClick={handleClearHistory}
                    disabled={clearingHistory}
                    className="px-3 py-1 text-xs border border-negative/40 text-negative/70 rounded hover:border-negative hover:text-negative transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {clearingHistory ? "Apagando..." : "Limpar historico"}
                  </button>
                )}
              </div>
              <TradeHistory trades={trades} />
            </div>
            <PnlBreakdownChart trades={trades} />
          </div>
        )}

        {activeTab === "Analytics" && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <DrawdownChart series={drawdownSeries} />
              <CloseReasonDonut closeReasons={closeReasons} />
            </div>
            <SetupPerformance bySetup={bySetup} />
            <SymbolPerformance bySymbol={bySymbol} />
            <PnlBreakdownChart trades={trades} />
          </div>
        )}

        {activeTab === "On-Chain" && (
          <OnChainPanel overview={overview} marketMetrics={marketMetrics} />
        )}

        {activeTab === "Monitoramento" && (
          <div className="space-y-5">
            <ApiHealthPanel />
            <ScanResultsGrid />

            <div className="bg-card border border-border rounded-xl p-5 shadow-card">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-xs text-muted tracking-[0.15em] font-medium">AUDITORIA SL/TP</h2>
                  <p className="text-[10px] text-muted-dim mt-0.5">
                    Verifica posicoes abertas na BingX e aplica SL/TP ausentes.
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

            <div className="bg-card border border-border rounded-xl p-5 shadow-card">
              <h2 className="text-xs text-muted tracking-[0.15em] font-medium mb-3">MONITORES DE PRECO</h2>
              {monitors.length > 0 ? (
                <MonitorsPanel monitors={monitors} />
              ) : (
                <p className="text-xs text-muted-dim">
                  Nenhum monitor configurado em <code className="text-accent">monitors.json</code>.
                </p>
              )}
            </div>
          </div>
        )}

        {activeTab === "Regras" && (
          <RulesPanel strategy={strategy} knowledgeBase={knowledgeBase} />
        )}
      </main>
    </div>
  );
}
