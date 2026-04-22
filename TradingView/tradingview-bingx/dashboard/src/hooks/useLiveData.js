import { useState, useEffect, useCallback } from "react";

const API = "/api";

export function useLiveData(pollIntervalMs = 15000) {
  const [overview, setOverview]           = useState(null);
  const [pendingSignals, setPendingSignals] = useState([]);
  const [trades, setTrades]               = useState([]);
  const [stats, setStats]                 = useState(null);
  const [mode, setMode]                   = useState("paper");
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);
  const [lastUpdate, setLastUpdate]       = useState(null);
  const [errorsData, setErrorsData]       = useState(null);
  const [dailyRisk, setDailyRisk]         = useState(null);
  const [monitors, setMonitors]           = useState([]);
  const [marketMetrics, setMarketMetrics] = useState(null);
  const [strategy, setStrategy]           = useState(null);
  const [knowledgeBase, setKnowledgeBase] = useState("");

  // ── NEW: analytics state ──────────────────────────────────────
  const [goalProgress, setGoalProgress]     = useState(null);
  const [dailySeries, setDailySeries]       = useState([]);
  const [monthlySeries, setMonthlySeries]   = useState([]);
  const [bySetup, setBySetup]               = useState([]);
  const [bySymbol, setBySymbol]             = useState([]);
  const [drawdownSeries, setDrawdownSeries] = useState([]);
  const [closeReasons, setCloseReasons]     = useState([]);

  const fetchAll = useCallback(async () => {
    try {
      await fetch(`${API}/positions/sync`, { method: "POST" }).catch(() => {});

      const endpoints = [
        fetch(`${API}/overview`),
        fetch(`${API}/signals/pending`),
        fetch(`${API}/trades?limit=100`),
        fetch(`${API}/stats`),
        fetch(`${API}/health`),
        fetch(`${API}/errors`),
        fetch(`${API}/risk/daily`),
        fetch(`${API}/monitors`),
        fetch(`${API}/market-metrics`),
        fetch(`${API}/strategy`),
        fetch(`${API}/knowledge-base`),
        fetch(`${API}/stats/goal`),
        fetch(`${API}/stats/daily-series?days=30`),
        fetch(`${API}/stats/monthly-series?months=12`),
        fetch(`${API}/stats/by-setup`),
        fetch(`${API}/stats/by-symbol`),
        fetch(`${API}/stats/drawdown?days=90`),
        fetch(`${API}/stats/close-reasons`),
      ];

      const responses = await Promise.all(endpoints);
      const [ovRes, sigRes, tradeRes, statsRes, healthRes, errRes, riskRes, monRes, metricsRes, stratRes, kbRes, goalRes, dailySrRes, monthSrRes, setupRes, symRes, ddRes, reasonsRes] = responses;

      if (!ovRes.ok) throw new Error(`API error: ${ovRes.status}`);

      const parseMaybe = async (r) => (r.ok ? r.json().catch(() => null) : null);

      const [ov, sigs, trs, st, health, errs, risk, mon, metrics, strat, kb, goal, dailySr, monthSr, bs, bySym, dd, reasons] =
        await Promise.all(responses.map(parseMaybe));

      setOverview(ov);
      setPendingSignals(sigs ?? []);
      setTrades(trs ?? []);
      setStats(st);
      setMode(health?.mode ?? "paper");
      setErrorsData(errs);
      setDailyRisk(risk);
      setMonitors(mon?.monitors ?? []);
      setMarketMetrics(metrics ?? null);
      setStrategy(strat ?? null);
      setKnowledgeBase(kb?.content ?? "");
      setGoalProgress(goal);
      setDailySeries(dailySr ?? []);
      setMonthlySeries(monthSr ?? []);
      setBySetup(bs ?? []);
      setBySymbol(bySym ?? []);
      setDrawdownSeries(dd ?? []);
      setCloseReasons(reasons ?? []);
      setError(null);
      setLastUpdate(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, pollIntervalMs);
    return () => clearInterval(interval);
  }, [fetchAll, pollIntervalMs]);

  const approveSignal = async (id) => {
    const res  = await fetch(`${API}/signals/${id}/approve`, { method: "POST" });
    const data = await res.json();
    await fetchAll();
    return data;
  };

  const rejectSignal = async (id) => {
    await fetch(`${API}/signals/${id}/reject`, { method: "POST" });
    await fetchAll();
  };

  const closeTrade = async (id) => {
    const res  = await fetch(`${API}/trades/${id}/close`, { method: "POST" });
    const data = await res.json();
    await fetchAll();
    return data;
  };

  const dismissErrors = async () => {
    await fetch(`${API}/errors/dismiss`, { method: "POST" }).catch(() => {});
    setErrorsData((prev) =>
      prev ? { ...prev, hasActive: false, errors: prev.errors.map((e) => ({ ...e, dismissed: true })) } : prev
    );
  };

  const clearHistory = async () => {
    const res = await fetch(`${API}/admin/clear-history`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Server returned ${res.status}`);
    }
    await fetchAll();
  };

  const repairSlTp = async () => {
    const res = await fetch(`${API}/admin/repair-sl-tp`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Server returned ${res.status}`);
    }
    return res.json();
  };

  return {
    overview,
    pendingSignals,
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
    // analytics (new)
    goalProgress,
    dailySeries,
    monthlySeries,
    bySetup,
    bySymbol,
    drawdownSeries,
    closeReasons,
    // actions
    refresh: fetchAll,
    approveSignal,
    rejectSignal,
    closeTrade,
    dismissErrors,
    clearHistory,
    repairSlTp,
  };
}
