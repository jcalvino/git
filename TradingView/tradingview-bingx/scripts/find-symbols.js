// ─────────────────────────────────────────────────────────────────
//  find-symbols.js — Busca nomes exatos de contratos na BingX
//  Usage: node scripts/find-symbols.js
// ─────────────────────────────────────────────────────────────────

const SEARCH_TERMS = [
  "GASOLINE", "SOYBEAN", "WHEAT", "COCOA", "COPPER", "ALUMIN",
  "GOLD", "SILVER", "XAG", "XPT", "BRENT", "WTI", "NATGAS",
  "EUR", "TSLA", "NVDA", "GOOGL", "AMZN", "MSFT", "HYPE",
];

const FAILING = [
  "NCCOGASOLINE2USD-USDT",
  "NCCOSOYBEANS2USD-USDT",
  "NCCOWHEAT2USD-USDT",
  "NCCOCOCOA2USD-USDT",
  "NCCOCOPPER2USD-USDT",
  "NCCOALUMINIUM2USD-USDT",
];

const res = await fetch("https://open-api.bingx.com/openApi/swap/v2/quote/contracts");
const json = await res.json();
const contracts = json.data || [];
const syms = contracts.map((c) => c.symbol).sort();

console.log(`\nBingX tem ${syms.length} contratos.\n`);

console.log("=== Símbolos com erro no scanner ===");
for (const sym of FAILING) {
  const exact = syms.includes(sym);
  console.log(`  ${exact ? "✅" : "❌"} ${sym}${exact ? "  ← EXISTE (pode estar pausado)" : "  ← NÃO EXISTE"}`);
}

console.log("\n=== Sugestões por palavra-chave ===");
for (const term of SEARCH_TERMS) {
  const hits = syms.filter((s) => s.toUpperCase().includes(term));
  console.log(`  ${term.padEnd(12)}: ${hits.length > 0 ? hits.join("  |  ") : "(nenhum)"}`);
}
