// ─────────────────────────────────────────────────────────────────
//  update-rules.js
//  Auto-updates rules.json with fresh Fear/Greed index and prices.
//  Manual fields (overall_bias, key_dates, macro_drivers) are
//  preserved from the previous day — update them yourself as needed.
// ─────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync } from "fs";
import https from "https";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Load .env to get TV_RULES_PATH if customized
const envPath = resolve(ROOT, ".env");
let rulesPath = resolve(ROOT, "./rules.json");
if (existsSync(envPath)) {
  const env = readFileSync(envPath, "utf8");
  const match = env.match(/^TV_RULES_PATH=(.+)$/m);
  if (match) rulesPath = resolve(ROOT, match[1].trim());
}

// ── Fetch helpers ──────────────────────────────────────────────

function httpsGet(hostname, path) {
  return new Promise((resolve) => {
    const req = https.request(
      { hostname, path, method: "GET", headers: { "Content-Type": "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve({ ok: true, data: JSON.parse(data) }); }
          catch { resolve({ ok: false }); }
        });
      }
    );
    req.on("error", () => resolve({ ok: false }));
    req.end();
  });
}

async function getFearGreed() {
  const res = await httpsGet(
    "open-api.coinglass.com",
    "/public/v2/index/fear_greed_history?limit=1"
  );
  if (!res.ok) return null;
  const latest = res.data?.data?.[0] ?? res.data?.[0];
  if (!latest) return null;
  return {
    value: parseInt(latest.value ?? latest.index ?? 50),
    label: latest.valueClassification ?? latest.label ?? "Neutral",
  };
}

async function getBingXPrice(symbol) {
  const res = await httpsGet(
    "open-api.bingx.com",
    `/openApi/swap/v2/quote/price?symbol=${symbol}`
  );
  if (!res.ok) return null;
  return parseFloat(res.data?.data?.price ?? 0) || null;
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
  console.log("Updating rules.json...");

  if (!existsSync(rulesPath)) {
    console.error(`  rules.json not found at: ${rulesPath}`);
    process.exit(1);
  }

  const rules = JSON.parse(readFileSync(rulesPath, "utf8"));

  const contextKey = Object.keys(rules)
    .filter((k) => k.startsWith("market_context_"))
    .sort()
    .pop();
  const prev = contextKey ? rules[contextKey] : {};

  const [fearGreed, btcPrice, ethPrice] = await Promise.all([
    getFearGreed(),
    getBingXPrice("BTC-USDT"),
    getBingXPrice("ETH-USDT"),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const newKey = `market_context_${today.replace(/-/g, "_")}`;

  const newContext = {
    ...prev,
    last_updated: today,
    fear_greed_index: fearGreed?.value ?? prev.fear_greed_index ?? 50,
    fear_greed_label: fearGreed
      ? `${fearGreed.label} (${fearGreed.value})`
      : prev.fear_greed_label ?? "Neutral",
    btc: {
      ...(prev.btc ?? {}),
      price_today: btcPrice ?? prev.btc?.price_today ?? 0,
    },
    eth: {
      ...(prev.eth ?? {}),
      price_today: ethPrice ?? prev.eth?.price_today ?? 0,
    },
  };

  if (contextKey && contextKey !== newKey) {
    delete rules[contextKey];
  }
  rules[newKey] = newContext;

  writeFileSync(rulesPath, JSON.stringify(rules, null, 2), "utf8");

  console.log(`  Fear/Greed : ${newContext.fear_greed_index} — ${fearGreed?.label ?? "unchanged"}`);
  console.log(`  BTC        : $${(btcPrice ?? prev.btc?.price_today ?? 0).toLocaleString()}`);
  console.log(`  ETH        : $${(ethPrice ?? prev.eth?.price_today ?? 0).toLocaleString()}`);
  console.log(`  Bias       : ${newContext.overall_bias ?? "unchanged (edit manually)"}`);
  console.log(`  Key        : ${newKey}`);
  console.log("  rules.json updated.\n");
}

main().catch((err) => {
  console.error("  Failed to update rules.json:", err.message);
});
