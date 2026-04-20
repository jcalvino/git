import { useState } from "react";
import type { AnalyzeRequest } from "../types";

interface Props {
  onSubmit: (req: AnalyzeRequest) => void;
  loading: boolean;
}

const SUPPORTED = [
  "idealista.pt",
  "imovirtual.com",
  "casa.sapo.pt",
  "casayes.pt",
  "quatru.pt",
];

export function UrlForm({ onSubmit, loading }: Props) {
  const [url, setUrl] = useState("");
  const [use, setUse] = useState<"HPP" | "INVESTMENT">("INVESTMENT");
  const [ltv, setLtv] = useState(80);
  const [rate, setRate] = useState(4.5);
  const [years, setYears] = useState(30);
  const [showAdvanced, setShowAdvanced] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    onSubmit({
      url: url.trim(),
      use,
      financing: { ltv: ltv / 100, annualRatePct: rate, years },
    });
  }

  return (
    <form className="form-card" onSubmit={handleSubmit}>
      <div>
        <label htmlFor="url">URL do Imóvel</label>
        <input
          id="url"
          className="url-input"
          type="url"
          placeholder="https://idealista.pt/imovel/... ou imovirtual.com/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <div className="tags-row">
          {SUPPORTED.map((s) => (
            <span key={s} className="tag tag-gray">{s}</span>
          ))}
        </div>
      </div>

      <div className="use-toggle">
        <button
          type="button"
          className={use === "INVESTMENT" ? "active" : ""}
          onClick={() => setUse("INVESTMENT")}
        >
          📈 Investimento
        </button>
        <button
          type="button"
          className={use === "HPP" ? "active" : ""}
          onClick={() => setUse("HPP")}
        >
          🏠 Habitação Própria
        </button>
      </div>

      <button
        type="button"
        className="details-toggle"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? "▲" : "▼"} Opções de financiamento
      </button>

      {showAdvanced && (
        <div className="financing-grid">
          <div className="field">
            <label htmlFor="ltv">LTV (%)</label>
            <input
              id="ltv"
              type="number"
              min={50}
              max={95}
              step={5}
              value={ltv}
              onChange={(e) => setLtv(Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="rate">Taxa Anual (%)</label>
            <input
              id="rate"
              type="number"
              min={0}
              max={15}
              step={0.1}
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="years">Prazo (anos)</label>
            <input
              id="years"
              type="number"
              min={5}
              max={40}
              step={5}
              value={years}
              onChange={(e) => setYears(Number(e.target.value))}
            />
          </div>
        </div>
      )}

      <button type="submit" className="btn-analyze" disabled={loading}>
        {loading ? "A analisar…" : "Analisar imóvel →"}
      </button>
    </form>
  );
}
