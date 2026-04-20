import { useState } from "react";
import { UrlForm } from "./components/UrlForm";
import { ResultCard } from "./components/ResultCard";
import type { AnalyzeRequest, AnalysisSummary, AppState } from "./types";

export default function App() {
  const [state, setState] = useState<AppState>({ status: "idle" });

  async function handleSubmit(req: AnalyzeRequest) {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        const msg = typeof body.message === "string" ? body.message : `Erro ${res.status}`;
        setState({ status: "error", message: msg });
        return;
      }
      const data = await res.json() as AnalysisSummary;
      setState({ status: "success", data });
    } catch {
      setState({ status: "error", message: "Não foi possível contactar o servidor. Verifica se a API está a correr." });
    }
  }

  return (
    <>
      <div className="hero">
        <h1>🏠 Análise de Imóvel · Portugal</h1>
        <p>Cola o link do anúncio — calculamos tudo: IMT, CAPEX, yields, risco.</p>
      </div>

      <div className="container">
        <UrlForm onSubmit={handleSubmit} loading={state.status === "loading"} />

        {state.status === "loading" && (
          <div className="loading-wrap">
            <div className="spinner" />
            <p>A carregar página, extrair dados e calcular análise…</p>
            <p style={{ fontSize: ".82rem", marginTop: 6, opacity: .7 }}>Pode demorar 15–30 segundos</p>
          </div>
        )}

        {state.status === "error" && (
          <div className="error-box">⚠ {state.message}</div>
        )}

        {state.status === "success" && (
          <ResultCard data={state.data} />
        )}
      </div>
    </>
  );
}
