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

  const fetchAll = useCallback(async () => {
    try {
      // Sync live BingX positions before fetching local data
      await fetch(`${API}/positions/sync`, { method: "POST" }).catch(() => {});

      const [ovRes, sigRes, tradeRes, statsRes, healthRes] = await Promise.all([
        fetch(`${API}/overview`),
        fetch(`${API}/signals/pending`),
        fetch(`${API}/trades?limit=100`),
        fetch(`${API}/stats`),
        fetch(`${API}/health`),
      ]);

      if (!ovRes.ok) throw new Error(`API error: ${ovRes.status}`);

      const [ov, sigs, trs, st, health] = await Promise.all([
        ovRes.json(),
        sigRes.json(),
        tradeRes.json(),
        statsRes.json(),
        healthRes.json(),
      ]);

      setOverview(ov);
      setPendingSignals(sigs);
      setTrades(trs);
      setStats(st);
      setMode(health.mode ?? "paper");
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

  return {
    overview,
    pendingSignals,
    trades,
    stats,
    mode,
    loading,
    error,
    lastUpdate,
    refresh: fetchAll,
    approveSignal,
    rejectSignal,
    closeTrade,
  };
}
