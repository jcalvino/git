import { useState, useEffect, useCallback } from "react";

const API = "/api";

export function useLiveData(pollIntervalMs = 15000) {
  const [overview, setOverview] = useState(null);
  const [pendingSignals, setPendingSignals] = useState([]);
  const [trades, setTrades] = useState([]);
  const [stats, setStats] = useState(null);
  const [mode, setMode] = useState("paper");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [errorsData, setErrorsData] = useState(null);
  const [dailyRisk, setDailyRisk] = useState(null);
  const [monitors, setMonitors] = useState([]);
  const [marketMetrics, setMarketMetrics] = useState(null);
  const [strategy, setStrategy] = useState(null);
  const [knowledgeBase, setKnowledgeBase] = useState("");

  const fetchAll = useCallback(async () => {
    try {
      // Sync live BingX positions before fetching local data
      await fetch(`${API}/positions/sync`, { method: "POST" }).catch(() => {});

      const [ovRes, sigRes, tradeRes, statsRes, healthRes, errRes, riskRes, monRes, metricsRes, stratRes, kbRes] = await Promise.all([
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
      ]);

      if (!ovRes.ok) throw new Error(`API error: ${ovRes.status}`);

      const [ov, sigs, trs, st, health, errs, risk, mon, metrics, strat, kb] = await Promise.all([
        ovRes.json(),
        sigRes.json(),
        tradeRes.json(),
        statsRes.json(),
        healthRes.json(),
        errRes.ok     ? errRes.json()     : Promise.resolve(null),
        riskRes.ok    ? riskRes.json()    : Promise.resolve(null),
        monRes.ok     ? monRes.json()     : Promise.resolve(null),
        metricsRes.ok ? metricsRes.json() : Promise.resolve(null),
        stratRes.ok   ? stratRes.json()   : Promise.resolve(null),
        kbRes.ok      ? kbRes.json()      : Promise.resolve(null),
      ]);

      setOverview(ov);
      setPendingSignals(sigs);
      setTrades(trs);
      setStats(st);
      setMode(health.mode ?? "paper");
      setErrorsData(errs);
      setDailyRisk(risk);
      setMonitors(mon?.monitors ?? []);
      setMarketMetrics(metrics ?? null);
      setStrategy(strat ?? null);
      setKnowledgeBase(kb?.content ?? "");
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
    const res = await fetch(`${API}/signals/${id}/approve`, { method: "POST" });
    const data = await res.json();
    await fetchAll(); // always refresh — removes stale signals on failure too
    return data;
  };

  const rejectSignal = async (id) => {
    await fetch(`${API}/signals/${id}/reject`, { method: "POST" });
    await fetchAll();
  };

  const closeTrade = async (id) => {
    const res = await fetch(`${API}/trades/${id}/close`, { method: "POST" });
    const data = await res.json();
    await fetchAll(); // always refresh
    return data;
  };

  const dismissErrors = async () => {
    await fetch(`${API}/errors/dismiss`, { method: "POST" }).catch(() => {});
    setErrorsData((prev) => prev ? { ...prev, hasActive: false, errors: prev.errors.map((e) => ({ ...e, dismissed: true })) } : prev);
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
    refresh: fetchAll,
    approveSignal,
    rejectSignal,
    closeTrade,
    dismissErrors,
    clearHistory,
    repairSlTp,
  };
}
