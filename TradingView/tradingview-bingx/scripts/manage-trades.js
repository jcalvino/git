// ─────────────────────────────────────────────────────────────────
//  manage-trades.js — Utilitário CLI para inspecionar e apagar
//  trades do banco local (data/trades.db).
//
//  Usage:
//    node scripts/manage-trades.js --list
//    node scripts/manage-trades.js --list --date=2026-04-23
//    node scripts/manage-trades.js --show=<id>
//    node scripts/manage-trades.js --delete=<id>          (pede confirmação)
//    node scripts/manage-trades.js --delete=<id> --yes    (sem confirmação)
//    node scripts/manage-trades.js --delete-external      (apaga todos EXTERNAL)
//
//  Regra de segurança:
//    • Delete nunca é silencioso. Mostra o registro antes e pede "yes".
//    • Delete cascata: remove também positions ligadas ao trade_id.
// ─────────────────────────────────────────────────────────────────

import readline from "readline";
import db from "../src/storage/db.js";

const args = process.argv.slice(2);
const getArg = (name) => {
  const m = args.find((a) => a.startsWith(`--${name}=`));
  return m ? m.split("=").slice(1).join("=") : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

// ── Formatters ──────────────────────────────────────────────────

function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const date = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

function fmtPrice(p) {
  if (p == null) return "—";
  if (p >= 1000) return `$${p.toLocaleString("en-US", { maximumFractionDigits: 1 })}`;
  return `$${p.toFixed(2)}`;
}

function fmtPnl(pnl) {
  if (pnl == null) return "—";
  const sign = pnl > 0 ? "+" : "";
  return `${sign}$${pnl.toFixed(2)}`;
}

function color(str, c) {
  const codes = { red: 31, green: 32, yellow: 33, cyan: 36, grey: 90, bold: 1 };
  return `\x1b[${codes[c] ?? 0}m${str}\x1b[0m`;
}

// ── Queries ─────────────────────────────────────────────────────

function listTrades({ dateFilter = null } = {}) {
  let sql = `
    SELECT id, symbol, direction, entry_price, exit_price, pnl, pnl_pct,
           status, trade_type, signal_id, close_reason,
           opened_at, closed_at
    FROM trades
    ORDER BY opened_at DESC
  `;
  const rows = db.prepare(sql).all();
  if (!dateFilter) return rows;
  return rows.filter((r) => (r.opened_at ?? "").startsWith(dateFilter));
}

function getTrade(id) {
  return db.prepare("SELECT * FROM trades WHERE id = ?").get(id);
}

function deleteTrade(id) {
  const delPositions = db.prepare("DELETE FROM positions WHERE trade_id = ?").run(id);
  const delTrade     = db.prepare("DELETE FROM trades WHERE id = ?").run(id);
  return { deletedTrade: delTrade.changes, deletedPositions: delPositions.changes };
}

// ── Rendering ───────────────────────────────────────────────────

function printTable(rows) {
  if (rows.length === 0) {
    console.log(color("  Nenhum trade encontrado.", "grey"));
    return;
  }

  console.log();
  console.log(
    color(
      [
        "ID".padStart(4),
        "Data/Hora".padEnd(18),
        "Symbol".padEnd(10),
        "Dir".padEnd(5),
        "Entry".padStart(10),
        "Exit".padStart(10),
        "P&L".padStart(9),
        "Status".padEnd(10),
        "Type".padEnd(9),
        "Signal",
      ].join(" | "),
      "bold"
    )
  );
  console.log(color("─".repeat(110), "grey"));

  for (const r of rows) {
    const dir = r.direction === "LONG" ? color(r.direction, "green") : color(r.direction, "red");
    const pnl = r.pnl == null
      ? color("  open  ".padStart(9), "grey")
      : (r.pnl >= 0 ? color(fmtPnl(r.pnl).padStart(9), "green")
                    : color(fmtPnl(r.pnl).padStart(9), "red"));
    const type = r.trade_type ?? "—";
    const typeColored = type === "EXTERNAL" ? color(type.padEnd(9), "yellow") : type.padEnd(9);
    const sig = r.signal_id ? `#${r.signal_id}` : color("manual", "yellow");

    console.log(
      [
        String(r.id).padStart(4),
        fmtDateTime(r.opened_at).padEnd(18),
        (r.symbol ?? "").padEnd(10),
        (r.direction ?? "").padEnd(5).replace(r.direction ?? "", dir),
        fmtPrice(r.entry_price).padStart(10),
        (r.exit_price ? fmtPrice(r.exit_price) : "—").padStart(10),
        pnl,
        (r.status ?? "").padEnd(10),
        typeColored,
        sig,
      ].join(" | ")
    );
  }
  console.log();
  console.log(color(`Total: ${rows.length} trade(s)`, "grey"));
}

function printTradeDetail(t) {
  if (!t) {
    console.log(color("  Trade não encontrado.", "red"));
    return;
  }
  console.log();
  console.log(color(`═══ Trade #${t.id} ═══`, "bold"));
  console.log(`Symbol       : ${t.symbol}`);
  console.log(`Direction    : ${t.direction}`);
  console.log(`Status       : ${t.status}`);
  console.log(`Trade type   : ${t.trade_type ?? "—"}${t.trade_type === "EXTERNAL" ? color("  ← abriu fora do bot", "yellow") : ""}`);
  console.log(`Signal ID    : ${t.signal_id ?? color("(nenhum — trade manual/externo)", "yellow")}`);
  console.log(`Setup        : ${t.setup_name ?? "—"}`);
  console.log(`Opened at    : ${fmtDateTime(t.opened_at)}`);
  console.log(`Closed at    : ${fmtDateTime(t.closed_at)}`);
  console.log(`Entry price  : ${fmtPrice(t.entry_price)}`);
  console.log(`Exit price   : ${fmtPrice(t.exit_price)}`);
  console.log(`SL           : ${fmtPrice(t.sl_price)}`);
  console.log(`TPs          : ${fmtPrice(t.tp1_price)} / ${fmtPrice(t.tp2_price)} / ${fmtPrice(t.tp3_price)}`);
  console.log(`Size         : ${t.size ?? "—"}`);
  console.log(`P&L          : ${fmtPnl(t.pnl)}${t.pnl_pct != null ? ` (${t.pnl_pct.toFixed(2)}%)` : ""}`);
  console.log(`Close reason : ${t.close_reason ?? "—"}`);
  console.log();
}

// ── Confirmation helper ─────────────────────────────────────────

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  const doList           = hasFlag("list");
  const showId           = getArg("show");
  const deleteId         = getArg("delete");
  const deleteExternal   = hasFlag("delete-external");
  const skipConfirm      = hasFlag("yes");
  const dateFilter       = getArg("date");

  // Default = list
  if (!showId && !deleteId && !deleteExternal) {
    printTable(listTrades({ dateFilter }));
    if (!doList) {
      console.log(color("\nDica: use --show=<id> pra detalhes, --delete=<id> pra apagar.", "grey"));
    }
    return;
  }

  if (showId) {
    printTradeDetail(getTrade(parseInt(showId)));
    return;
  }

  if (deleteId) {
    const t = getTrade(parseInt(deleteId));
    if (!t) {
      console.log(color(`✗ Trade #${deleteId} não existe.`, "red"));
      process.exit(1);
    }
    printTradeDetail(t);

    if (!skipConfirm) {
      const answer = await ask(color(`⚠  Apagar PERMANENTEMENTE o trade #${deleteId}? (yes/no): `, "yellow"));
      if (answer !== "yes" && answer !== "y") {
        console.log(color("Cancelado.", "grey"));
        return;
      }
    }

    const result = deleteTrade(parseInt(deleteId));
    console.log(color(`✓ Trade #${deleteId} apagado.`, "green"));
    console.log(color(`  Positions removidas: ${result.deletedPositions}`, "grey"));
    return;
  }

  if (deleteExternal) {
    const external = db.prepare("SELECT id, symbol, direction, opened_at FROM trades WHERE trade_type = 'EXTERNAL'").all();
    if (external.length === 0) {
      console.log(color("Nenhum trade EXTERNAL no banco.", "grey"));
      return;
    }
    console.log(color(`\nTrades EXTERNAL encontrados (${external.length}):`, "bold"));
    for (const t of external) {
      console.log(`  #${t.id}  ${fmtDateTime(t.opened_at)}  ${t.symbol}  ${t.direction}`);
    }

    if (!skipConfirm) {
      const answer = await ask(color(`\n⚠  Apagar TODOS os ${external.length} trades EXTERNAL? (yes/no): `, "yellow"));
      if (answer !== "yes" && answer !== "y") {
        console.log(color("Cancelado.", "grey"));
        return;
      }
    }

    let totalTrades = 0, totalPositions = 0;
    for (const t of external) {
      const r = deleteTrade(t.id);
      totalTrades    += r.deletedTrade;
      totalPositions += r.deletedPositions;
    }
    console.log(color(`✓ ${totalTrades} trades EXTERNAL apagados (${totalPositions} positions).`, "green"));
    return;
  }
}

main().catch((err) => {
  console.error(color(`✗ Erro: ${err.message}`, "red"));
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
