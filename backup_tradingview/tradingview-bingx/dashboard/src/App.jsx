import React, { useState } from "react";
import { useLiveData } from "./hooks/useLiveData.js";
import { Header } from "./components/Header.jsx";
import { StatsPanel } from "./components/StatsPanel.jsx";
import { EquityCurve } from "./components/EquityCurve.jsx";
import { SignalAlert } from "./components/SignalAlert.jsx";
import { OpenPositions } from "./components/OpenPositions.jsx";
import { TradeHistory } from "./components/TradeHistory.jsx";
import { OnChainPanel } from "./components/OnChainPanel.jsx";
import { GoalTracker } from "./components/GoalTracker.jsx";
import { ScanStatus } from "./components/ScanStatus.jsx";
import { CoinMBalance } from "./components/CoinMBalance.jsx";

const TABS = ["Overview", "Signals", "Trades", "Analytics", "On-Chain"];

export default function App() {
  const [activeTab, setActiveTab] = useState("Overview");
  const {
    overview,
    pendingSignals,
    trades,
    stats,
    mode,
    loading,
    error,
    lastUpdate,
    refresh,
    approveSignal,
    rejectSignal,
    closeTrade,
  } = useLiveData(15000);

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

  const openTrades = trades.filter((t) => ["OPEN", "PARTIAL"].includes(t.status));
  const closedTrades = trades.filter((t) => t.status === "CLOSED" || t.status === "STOPPED");

  return (
    <div className="min-h-screen bg-bg text-text">
      <Header overview={overview} lastUpdate={lastUpdate} onRefresh={refresh} mode={mode} />

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
            {tab === "Signals" && pendingSignals.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-accent/20 text-accent rounded-full text-xs">
                {pendingSignals.length}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="px-6 py-4 max-w-7xl mx-auto">
        {/* ── Overview ── */}
        {activeTab === "Overview" && (
          <div className="space-y-4">
            <GoalTracker currentCapital={overview?.balance?.total} />
            <StatsPanel stats={stats} overview={overview} />
            <CoinMBalance coinMBalance={overview?.coinMBalance} />

            {/* Equity Curve */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h2 className="text-xs text-muted mb-3 tracking-wider">
                EQUITY CURVE
              </h2>
              <EquityCurve snapshots={overview?.equityCurve ?? []} />
            </div>

            {/* Active Signals + Open Positions side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs text-muted tracking-wider">
                    PENDING SIGNALS
                  </h2>
                  {pendingSignals.length > 0 && (
                    <span className="text-xs text-accent">
                      {pendingSignals.length} awaiting approval
                    </span>
                  )}
                </div>
                {pendingSignals.length > 0 ? (
                  <SignalAlert
                    signals={pendingSignals.slice(0, 2)}
                    onApprove={approveSignal}
                    onReject={rejectSignal}
                  />
                ) : (
                  <ScanStatus />
                )}
              </div>

              <div className="bg-card border border-border rounded-lg p-4">
                <h2 className="text-xs text-muted mb-3 tracking-wider">
                  OPEN POSITIONS
                </h2>
                <OpenPositions trades={openTrades} onClose={closeTrade} />
              </div>
            </div>
          </div>
        )}

        {/* ── Signals ── */}
        {activeTab === "Signals" && (
          <div className="bg-card border border-border rounded-lg p-4">
            <h2 className="text-xs text-muted mb-4 tracking-wider">
              PENDING SIGNALS — AWAITING APPROVAL ({pendingSignals.length})
            </h2>
            <SignalAlert
              signals={pendingSignals}
              onApprove={approveSignal}
              onReject={rejectSignal}
            />
          </div>
        )}

        {/* ── Trades ── */}
        {activeTab === "Trades" && (
          <div className="space-y-4">
            {openTrades.length > 0 && (
              <div className="bg-card border border-border rounded-lg p-4">
                <h2 className="text-xs text-muted mb-3 tracking-wider">
                  OPEN POSITIONS
                </h2>
                <OpenPositions trades={openTrades} onClose={closeTrade} />
              </div>
            )}
            <div className="bg-card border border-border rounded-lg p-4">
              <h2 className="text-xs text-muted mb-3 tracking-wider">
                TRADE HISTORY ({closedTrades.length})
              </h2>
              <TradeHistory trades={trades} />
            </div>
          </div>
        )}

        {/* ── Analytics ── */}
        {activeTab === "Analytics" && (
          <div className="space-y-4">
            <GoalTracker currentCapital={overview?.balance?.total} />
            <StatsPanel stats={stats} overview={overview} />
            <CoinMBalance coinMBalance={overview?.coinMBalance} />
            <div className="bg-card border border-border rounded-lg p-4">
              <h2 className="text-xs text-muted mb-3 tracking-wider">
                EQUITY CURVE (30 days)
              </h2>
              <EquityCurve snapshots={overview?.equityCurve ?? []} />
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <h2 className="text-xs text-muted mb-3 tracking-wider">
                ALL TRADES
              </h2>
              <TradeHistory trades={trades} />
            </div>
          </div>
        )}

        {/* ── On-Chain ── */}
        {activeTab === "On-Chain" && (
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-lg p-4">
              <h2 className="text-xs text-muted mb-3 tracking-wider">
                MARKET METRICS
              </h2>
              <OnChainPanel overview={overview} />
            </div>
            <div className="bg-card border border-border rounded-lg p-4 text-xs text-muted">
              <p className="mb-2">Data sources:</p>
              <ul className="space-y-1">
                <li>• BingX: Funding Rate, Open Interest, Order Book</li>
                <li>• CoinGlass: Fear & Greed Index, Long/Short Ratio</li>
                <li>• TradingView (MCP): EMA200/D, EMA21/W, MACD/W, RSI/W</li>
                <li>• rules.json: Geopolitical &amp; macro context</li>
              </ul>
              <p className="mt-3 text-accent">
                Run a scan to update metrics: <code>node src/bot/scanner.js --once</code>
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
