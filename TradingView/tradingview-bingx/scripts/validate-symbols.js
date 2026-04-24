#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────
//  Symbol Validator
//  Queries BingX /contracts endpoint and cross-checks every symbol
//  in STRATEGY.SYMBOLS. Reports exact mismatches with suggestions.
//
//  Usage:
//    node scripts/validate-symbols.js
// ─────────────────────────────────────────────────────────────────

import { STRATEGY } from "../src/config/strategy.js";

const BINGX_CONTRACTS_URL =
  "https://open-api.bingx.com/openApi/swap/v2/quote/contracts";

// ── Symbols that live on Binance Spot (not BingX contracts) ───────
function isBingxSymbol(sym) {
  return (
    sym.startsWith("NCC") ||
    sym.startsWith("NCFX") ||
    sym.startsWith("NCSK") ||
    sym === "HYPEUSDT" ||
    sym.endsWith("USDC")
  );
}

// Convert internal symbol to BingX API format (USDC primário, USDT legado).
function toBingxSymbol(sym) {
  if (sym.includes("-")) return sym;                      // já no formato BingX
  if (sym.endsWith("USDC")) return sym.slice(0, -4) + "-USDC";
  if (sym.endsWith("USDT")) return sym.slice(0, -4) + "-USDT";
  return sym;
}

async function main() {
  console.log("🔍 Fetching BingX contract list…\n");

  let contracts;
  try {
    const res = await fetch(BINGX_CONTRACTS_URL);
    const json = await res.json();
    contracts = json.data ?? [];
  } catch (err) {
    console.error("❌ Could not reach BingX API:", err.message);
    process.exit(1);
  }

  const bingxSet = new Set(contracts.map((c) => c.symbol));
  console.log(`  BingX has ${bingxSet.size} contracts total.\n`);

  const bingxSymbols = STRATEGY.SYMBOLS.filter(isBingxSymbol);
  const binanceSymbols = STRATEGY.SYMBOLS.filter((s) => !isBingxSymbol(s));

  console.log(`  Strategy has ${STRATEGY.SYMBOLS.length} symbols:`);
  console.log(`    ${binanceSymbols.length} on Binance Spot`);
  console.log(`    ${bingxSymbols.length} on BingX (NCC/NCFX/NCSK/HYPE)\n`);

  // ── Validate BingX symbols ─────────────────────────────────────
  const ok    = [];
  const fails = [];

  for (const sym of bingxSymbols) {
    const bingxFmt = toBingxSymbol(sym);
    if (bingxSet.has(bingxFmt)) {
      ok.push({ sym, bingxFmt });
    } else {
      // Try to find a close match (fuzzy — same prefix)
      const prefix = bingxFmt.split("-")[0].substring(0, 8).toUpperCase();
      const suggestions = [...bingxSet]
        .filter((s) => s.toUpperCase().includes(prefix.substring(0, 6)))
        .slice(0, 5);
      fails.push({ sym, bingxFmt, suggestions });
    }
  }

  // ── Results ────────────────────────────────────────────────────
  if (ok.length > 0) {
    console.log(`✅ OK (${ok.length}):`);
    ok.forEach(({ sym, bingxFmt }) =>
      console.log(`   ${sym.padEnd(35)} → ${bingxFmt}`)
    );
    console.log();
  }

  if (fails.length > 0) {
    console.log(`❌ NOT FOUND on BingX (${fails.length}):`);
    fails.forEach(({ sym, bingxFmt, suggestions }) => {
      console.log(`\n   ✗ ${sym}`);
      console.log(`     Looked for: "${bingxFmt}"`);
      if (suggestions.length > 0) {
        console.log(`     Suggestions:`);
        suggestions.forEach((s) => console.log(`       • ${s}`));
      } else {
        console.log(`     No close matches found.`);
      }
    });
    console.log();
    console.log(
      "💡 Fix: update the symbol string in src/config/strategy.js to match the BingX name above."
    );
  } else {
    console.log("🎉 All BingX symbols validated — no mismatches!");
  }

  // ── Quick price check on first 3 BingX symbols ─────────────────
  if (ok.length > 0) {
    console.log("\n📡 Quick price ping (first 3 BingX symbols):");
    for (const { bingxFmt } of ok.slice(0, 3)) {
      try {
        const r = await fetch(
          `https://open-api.bingx.com/openApi/swap/v2/quote/price?symbol=${encodeURIComponent(bingxFmt)}`
        );
        const j = await r.json();
        const price = j?.data?.price ?? j?.price ?? "?";
        console.log(`   ${bingxFmt.padEnd(35)} $${price}`);
      } catch (e) {
        console.log(`   ${bingxFmt.padEnd(35)} ERROR: ${e.message}`);
      }
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
