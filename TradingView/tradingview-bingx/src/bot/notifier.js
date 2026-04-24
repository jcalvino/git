// ─────────────────────────────────────────────────────────────────
//  Telegram Notifier — FASE 1 (read-only)
//
//  Envia alertas do bot para um chat Telegram. NÃO recebe comandos
//  nesta fase — polling está desligado. Fase 2 adicionará o command
//  router (/panic, /status, /approve, …).
//
//  Config (.env):
//    TELEGRAM_ENABLED=true/false          master switch
//    TELEGRAM_BOT_TOKEN=123456:ABC...     do @BotFather
//    TELEGRAM_ALLOWED_CHAT_IDS=123,456    lista de chat_ids que recebem
//                                         os alertas (uso pessoal: só o seu)
//
//  Uso:
//    import { notify } from "../bot/notifier.js";
//    notify.signal(signalData);           // novo sinal pendente
//    notify.tradeOpened(tradeData);       // executou entrada
//    notify.tradeClosed(trade, "TP1", 7.94, true);   // parcial
//    notify.tradeClosed(trade, "SL", -5.32, false);  // fechamento total
//    notify.error("scanner", err);
//    notify.info("Scanner subiu");
//
//  Safety:
//    - Nunca faz throw — qualquer erro no Telegram é loggado mas
//      engolido, para não derrubar scanner/monitor por causa de
//      instabilidade do servidor do Telegram.
//    - Se TELEGRAM_ENABLED=false ou credenciais ausentes, TODAS as
//      funções viram no-op e nada é enviado. Zero impacto em prod.
//    - Fire-and-forget: callers não precisam await (mas podem).
// ─────────────────────────────────────────────────────────────────

import TelegramBot from "node-telegram-bot-api";
import config from "../config/index.js";

const { enabled: ENABLED, token: TOKEN, allowedChatIds: CHAT_IDS } = config.telegram;

let bot = null;

if (ENABLED && TOKEN && CHAT_IDS.length > 0) {
  // polling:false → apenas envia mensagens, não escuta updates.
  // Fase 2 muda para polling:true + registra handlers de comando.
  bot = new TelegramBot(TOKEN, { polling: false });
  console.log(
    `[notifier] Telegram ATIVO — ${CHAT_IDS.length} chat(s) na whitelist`
  );
} else {
  if (!ENABLED) {
    console.log("[notifier] Telegram desligado (TELEGRAM_ENABLED=false)");
  } else if (!TOKEN) {
    console.warn(
      "[notifier] TELEGRAM_ENABLED=true mas TELEGRAM_BOT_TOKEN vazio — notifier inerte"
    );
  } else if (!CHAT_IDS.length) {
    console.warn(
      "[notifier] TELEGRAM_ENABLED=true mas TELEGRAM_ALLOWED_CHAT_IDS vazio — notifier inerte"
    );
  }
}

// ── Internal: send a message to every whitelisted chat ──────────
async function send(text) {
  if (!bot) return;
  const payload = text.length > 4000 ? text.slice(0, 3990) + "…" : text;
  for (const chatId of CHAT_IDS) {
    try {
      await bot.sendMessage(chatId, payload, {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      });
    } catch (err) {
      // Nunca propaga — telegram offline não pode derrubar o trading.
      console.error(
        `[notifier] sendMessage falhou para chat_id=${chatId}: ${err.message}`
      );
    }
  }
}

// ── Formatters ──────────────────────────────────────────────────
function fmtUsd(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  const v = parseFloat(n);
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtPct(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  const pct = parseFloat(n) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function dirEmoji(direction) {
  return direction === "LONG" ? "🟢" : "🔴";
}

// Escape caracteres sensíveis do Markdown legacy dentro de backticks.
function code(str) {
  return "`" + String(str).replace(/`/g, "'") + "`";
}

// ── Public API ──────────────────────────────────────────────────
export const notify = {
  /**
   * Sinal novo gerado pelo scanner. Sai antes da execução, então
   * chega no celular mesmo que o executor falhe na sequência.
   */
  async signal(sig) {
    const lines = [
      `🔔 *Novo sinal* — #${sig.id ?? "?"}`,
      `${dirEmoji(sig.direction)} ${code(sig.symbol)} *${sig.direction}*  ` +
        `score *${sig.score}*`,
      sig.setup_name ? `Setup: _${sig.setup_name}_` : null,
      `Entry ${fmtUsd(sig.entry)}  |  SL ${fmtUsd(sig.sl)}`,
      `TP1 ${fmtUsd(sig.tp1)}  |  TP2 ${fmtUsd(sig.tp2)}  |  TP3 ${fmtUsd(sig.tp3)}`,
      sig.risk_dollars ? `Risco: ${fmtUsd(sig.risk_dollars)}` : null,
    ].filter(Boolean);
    await send(lines.join("\n"));
  },

  /**
   * Trade aberto com sucesso (paper ou live).
   */
  async tradeOpened(t) {
    const modeTag = t.paper_trade ? " _(PAPER)_" : "";
    const lines = [
      `✅ *Trade aberto*${modeTag} — #${t.id ?? t.tradeId ?? "?"}`,
      `${dirEmoji(t.direction)} ${code(t.symbol)} ${t.direction} @ ${fmtUsd(
        t.entry_price ?? t.avg_entry_price ?? t.price
      )}`,
      `Size: ${t.size}  |  SL ${fmtUsd(t.sl_price)}`,
      `TP1 ${fmtUsd(t.tp1_price)}  |  TP2 ${fmtUsd(t.tp2_price)}  |  TP3 ${fmtUsd(t.tp3_price)}`,
    ];
    await send(lines.join("\n"));
  },

  /**
   * TP/SL atingido ou trade fechado manualmente.
   * @param {object} trade   — objeto trade do DB
   * @param {string} reason  — "TP1" | "TP2" | "TP3" | "SL" | "MANUAL" | "PANIC"
   * @param {number} pnl     — P&L realizado no evento (pode ser parcial)
   * @param {boolean} partial — true se ainda tem size restante aberto
   */
  async tradeClosed(trade, reason, pnl, partial = false) {
    const win = pnl >= 0;
    const emoji = reason === "SL" ? "🛑" : reason === "PANIC" ? "🚨" : win ? "🎯" : "⚠️";
    const header = partial
      ? `${emoji} *${reason} atingido* — #${trade.id}`
      : `${emoji} *Trade fechado* (${reason}) — #${trade.id}`;
    const price = trade.exit_price ?? trade.current_price ?? trade.price ?? trade.entry_price;
    const lines = [
      header,
      `${dirEmoji(trade.direction)} ${code(trade.symbol)} ${trade.direction} @ ${fmtUsd(price)}`,
      `P&L: ${fmtUsd(pnl)}` +
        (trade.pnl_pct != null ? `  (${fmtPct(trade.pnl_pct)})` : ""),
      partial ? `_(parcial — resto da posição continua aberto)_` : null,
    ].filter(Boolean);
    await send(lines.join("\n"));
  },

  /**
   * Erro crítico em algum serviço — vale um push pro celular.
   * Truncamos a mensagem pra não bater no limite do Telegram.
   */
  async error(service, err) {
    const msg = err?.message || String(err);
    const lines = [
      `⚠️ *Erro em ${service}*`,
      "```",
      msg.slice(0, 500),
      "```",
    ];
    await send(lines.join("\n"));
  },

  /**
   * Alerta genérico (info-level). Útil pra startup, resume, etc.
   */
  async info(message) {
    await send(`ℹ️ ${message}`);
  },

  /**
   * Ping de subida do processo. Use uma vez por service após boot
   * para confirmar que está vivo.
   */
  async startup(processName) {
    await send(`🟢 *${processName}* subiu \`${new Date().toISOString()}\``);
  },
};

export default notify;

// ── Self-test (node src/bot/notifier.js) ───────────────────────
import { fileURLToPath } from "url";
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("notifier.js")) {
  (async () => {
    console.log("Testando notifier…\n");
    if (!bot) {
      console.log("❌ Bot não inicializado. Verifique .env:");
      console.log(`   TELEGRAM_ENABLED = ${ENABLED}`);
      console.log(`   TELEGRAM_BOT_TOKEN set = ${!!TOKEN}`);
      console.log(`   TELEGRAM_ALLOWED_CHAT_IDS = [${CHAT_IDS.join(", ")}]`);
      process.exit(1);
    }
    await notify.info("Teste do notifier — se você está lendo isso, funcionou ✅");
    await notify.signal({
      id: 999,
      symbol: "BTCUSDC",
      direction: "LONG",
      score: 72,
      setup_name: "rsi_reclaim_demo",
      entry: 74500,
      sl: 74127,
      tp1: 75059,
      tp2: 75477,
      tp3: 76079,
      risk_dollars: 10.6,
    });
    await notify.tradeOpened({
      id: 42,
      symbol: "BTCUSDC",
      direction: "LONG",
      entry_price: 74502,
      size: 0.0142,
      sl_price: 74127,
      tp1_price: 75059,
      tp2_price: 75477,
      tp3_price: 76079,
      paper_trade: 1,
    });
    await notify.tradeClosed(
      { id: 42, symbol: "BTCUSDC", direction: "LONG", exit_price: 75058, pnl_pct: 0.0075 },
      "TP1",
      7.94,
      true
    );
    console.log("\n✅ Enviei 3 mensagens de teste. Confira no Telegram.");
    process.exit(0);
  })();
}
