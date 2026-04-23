// ─────────────────────────────────────────────────────────────────
//  telegram.js — Bot Telegram: sinais + controle remoto do Claude Code
//
//  Features:
//    - Whitelist de chat_id (TELEGRAM_ALLOWED_CHAT_IDS)
//    - PIN de sessão (TELEGRAM_PIN), sessão expira em 4h
//    - Rate limit por hora
//    - Comandos read-only (status, signals, positions) sem gastar Claude
//    - /claude <prompt> invoca Claude Code em plan mode + exige /confirm
//    - Notificações push proativas (sinais, erros, P&L)
//    - Auditoria completa em /var/log/claudecode-trade/telegram.log
//
//  Dependências: node-telegram-bot-api, execa, better-sqlite3 (opcional)
//  Usage: node src/bot/telegram.js
// ─────────────────────────────────────────────────────────────────

import TelegramBot from "node-telegram-bot-api";
import { spawn, execSync } from "child_process";
import { appendFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

// ── Config ────────────────────────────────────────────────────────
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT_IDS = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PIN = process.env.TELEGRAM_PIN;
const SESSION_HOURS = Number(process.env.TELEGRAM_SESSION_HOURS || 4);
const RATE_LIMIT_PER_HOUR = Number(process.env.TELEGRAM_RATE_LIMIT_PER_HOUR || 10);
const ALERT_CHAT_ID = process.env.TELEGRAM_ALERT_CHAT_ID || "";
const CLAUDE_WORKDIR = process.env.CLAUDE_WORKDIR || ROOT;
const CLAUDE_MAX_TURNS = Number(process.env.CLAUDE_MAX_TURNS || 20);
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "";

if (!TOKEN) {
  console.error("[telegram] TELEGRAM_BOT_TOKEN não definido no .env");
  process.exit(1);
}
if (!PIN || PIN.length < 4) {
  console.error("[telegram] TELEGRAM_PIN inválido (mín 4 dígitos)");
  process.exit(1);
}
if (ALLOWED_CHAT_IDS.length === 0) {
  console.error("[telegram] TELEGRAM_ALLOWED_CHAT_IDS vazio — bot ficaria exposto");
  process.exit(1);
}

// ── Logging ───────────────────────────────────────────────────────
const LOG_DIR = "/var/log/claudecode-trade";
try {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
} catch {
  // Fallback: log em data/ se /var/log não tiver permissão
}
const LOG_FILE = existsSync(LOG_DIR)
  ? `${LOG_DIR}/telegram.log`
  : resolve(ROOT, "data", "telegram.log");

function redact(s) {
  if (!s) return s;
  // Redige PIN em /auth e qualquer sequência longa de dígitos
  return s
    .replace(/\/auth\s+\S+/gi, "/auth ******")
    .replace(/\b\d{4,}\b/g, (m) => "*".repeat(m.length));
}

function log(level, chatId, msg) {
  const ts = new Date().toISOString();
  const line = `${ts} [${level}] chat=${chatId} ${redact(msg)}\n`;
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    /* ignore */
  }
  if (level !== "DEBUG") console.log(line.trim());
}

// ── Estado em memória ─────────────────────────────────────────────
const sessions = new Map(); // chat_id → { authedAt: Date }
const failedAttempts = new Map(); // chat_id → { count, firstAt }
const blockedChats = new Map(); // chat_id → unblockAt (timestamp)
const rateCount = new Map(); // chat_id → { count, windowStart }
const pendingConfirms = new Map(); // chat_id → { hash, action, expiresAt }

// ── Utilitários ───────────────────────────────────────────────────
function isAuthorizedChat(chatId) {
  return ALLOWED_CHAT_IDS.includes(String(chatId));
}

function isBlocked(chatId) {
  const until = blockedChats.get(String(chatId));
  if (!until) return false;
  if (Date.now() > until) {
    blockedChats.delete(String(chatId));
    return false;
  }
  return true;
}

function hasValidSession(chatId) {
  const s = sessions.get(String(chatId));
  if (!s) return false;
  const ageH = (Date.now() - s.authedAt) / 3_600_000;
  return ageH < SESSION_HOURS;
}

function checkRateLimit(chatId) {
  const key = String(chatId);
  const now = Date.now();
  const r = rateCount.get(key);
  if (!r || now - r.windowStart > 3_600_000) {
    rateCount.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (r.count >= RATE_LIMIT_PER_HOUR) return false;
  r.count++;
  return true;
}

function recordFailedPin(chatId) {
  const key = String(chatId);
  const rec = failedAttempts.get(key) || { count: 0, firstAt: Date.now() };
  rec.count++;
  failedAttempts.set(key, rec);
  if (rec.count >= 3) {
    blockedChats.set(key, Date.now() + 3_600_000); // bloqueia 1h
    failedAttempts.delete(key);
    log("WARN", chatId, "chat bloqueado por 1h após 3 tentativas de PIN");
    if (ALERT_CHAT_ID && ALERT_CHAT_ID !== key) {
      bot.sendMessage(ALERT_CHAT_ID, `⚠️ Chat ${key} bloqueado (3 PINs errados).`);
    }
  }
}

function shortHash() {
  return crypto.randomBytes(3).toString("hex"); // 6 chars
}

function chunk(str, n = 3800) {
  // Telegram limite: 4096 chars. Deixa margem.
  const out = [];
  for (let i = 0; i < str.length; i += n) out.push(str.slice(i, i + n));
  return out;
}

// ── Bot init ──────────────────────────────────────────────────────
const bot = new TelegramBot(TOKEN, { polling: true });

bot.on("polling_error", (err) => log("ERROR", "system", `polling: ${err.message}`));

// Middleware: roda antes de todo command handler
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";

  log("DEBUG", chatId, `msg: ${text.slice(0, 80)}`);

  if (!isAuthorizedChat(chatId)) {
    log("WARN", chatId, `chat NÃO autorizado tentou acessar`);
    // Não responde — nega silenciosamente para não confirmar existência do bot
    return;
  }

  if (isBlocked(chatId)) {
    bot.sendMessage(chatId, "⛔ Você está temporariamente bloqueado. Tente em 1h.");
    return;
  }

  // /auth bypassa a checagem de sessão
  if (text.startsWith("/auth")) return handleAuth(msg);

  // Comandos que NÃO precisam de sessão (nenhum por enquanto além de /auth)

  // Demais exigem sessão ativa
  if (!hasValidSession(chatId)) {
    bot.sendMessage(chatId, "🔐 Sessão expirada. Envie `/auth <PIN>` para autenticar.", {
      parse_mode: "Markdown",
    });
    return;
  }

  if (!checkRateLimit(chatId)) {
    bot.sendMessage(chatId, `⏸️ Rate limit: máx ${RATE_LIMIT_PER_HOUR} cmds/h. Aguarde.`);
    return;
  }
});

// ── Handlers ──────────────────────────────────────────────────────
function handleAuth(msg) {
  const chatId = msg.chat.id;
  const parts = (msg.text || "").split(/\s+/);
  if (parts.length < 2) {
    bot.sendMessage(chatId, "Uso: `/auth 123456`", { parse_mode: "Markdown" });
    return;
  }
  const pin = parts[1];
  if (pin !== PIN) {
    recordFailedPin(chatId);
    bot.sendMessage(chatId, "❌ PIN incorreto.");
    log("WARN", chatId, "PIN incorreto");
    return;
  }
  sessions.set(String(chatId), { authedAt: Date.now() });
  failedAttempts.delete(String(chatId));
  bot.sendMessage(chatId, `✅ Autenticado. Sessão válida por ${SESSION_HOURS}h.`);
  log("INFO", chatId, "sessão iniciada");
}

bot.onText(/^\/help$/, (msg) => {
  if (!isAuthorizedChat(msg.chat.id) || !hasValidSession(msg.chat.id)) return;
  const help = [
    "*Comandos disponíveis:*",
    "",
    "`/status` — visão geral",
    "`/signals` — últimos 10 sinais",
    "`/positions` — posições abertas",
    "`/scan` — força scan agora",
    "`/pause` — pausa scanner",
    "`/resume` — retoma scanner",
    "`/claude <prompt>` — envia prompt pro Claude Code",
    "`/confirm <hash>` — confirma operação pendente",
    "`/auth <PIN>` — renova sessão",
    "`/help` — esta mensagem",
  ].join("\n");
  bot.sendMessage(msg.chat.id, help, { parse_mode: "Markdown" });
});

bot.onText(/^\/status$/, (msg) => {
  if (!isAuthorizedChat(msg.chat.id) || !hasValidSession(msg.chat.id)) return;
  try {
    const status = buildStatus();
    bot.sendMessage(msg.chat.id, status, { parse_mode: "Markdown" });
    log("INFO", msg.chat.id, "/status");
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ Erro: ${e.message}`);
  }
});

bot.onText(/^\/signals$/, (msg) => {
  if (!isAuthorizedChat(msg.chat.id) || !hasValidSession(msg.chat.id)) return;
  try {
    const out = listRecentSignals(10);
    bot.sendMessage(msg.chat.id, out || "Nenhum sinal ainda.", { parse_mode: "Markdown" });
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ ${e.message}`);
  }
});

bot.onText(/^\/positions$/, (msg) => {
  if (!isAuthorizedChat(msg.chat.id) || !hasValidSession(msg.chat.id)) return;
  try {
    const out = listOpenPositions();
    bot.sendMessage(msg.chat.id, out || "Sem posições abertas.", { parse_mode: "Markdown" });
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ ${e.message}`);
  }
});

bot.onText(/^\/scan$/, async (msg) => {
  if (!isAuthorizedChat(msg.chat.id) || !hasValidSession(msg.chat.id)) return;
  bot.sendMessage(msg.chat.id, "🔎 Disparando scan...");
  try {
    const out = execSync(`node ${ROOT}/src/bot/scanner.js --once`, {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 120_000,
    });
    bot.sendMessage(msg.chat.id, "```\n" + out.slice(-3000) + "\n```", {
      parse_mode: "Markdown",
    });
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ Scan falhou: ${e.message}`);
  }
});

bot.onText(/^\/pause$/, (msg) => {
  if (!isAuthorizedChat(msg.chat.id) || !hasValidSession(msg.chat.id)) return;
  try {
    execSync("sudo systemctl stop claudecode-scanner", { timeout: 10_000 });
    bot.sendMessage(msg.chat.id, "⏸️ Scanner pausado.");
    log("INFO", msg.chat.id, "/pause");
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ ${e.message}`);
  }
});

bot.onText(/^\/resume$/, (msg) => {
  if (!isAuthorizedChat(msg.chat.id) || !hasValidSession(msg.chat.id)) return;
  try {
    execSync("sudo systemctl start claudecode-scanner", { timeout: 10_000 });
    bot.sendMessage(msg.chat.id, "▶️ Scanner retomado.");
    log("INFO", msg.chat.id, "/resume");
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ ${e.message}`);
  }
});

// /claude <prompt>
bot.onText(/^\/claude\s+([\s\S]+)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAuthorizedChat(chatId) || !hasValidSession(chatId)) return;
  const prompt = match[1].trim();
  if (prompt.length < 5) {
    bot.sendMessage(chatId, "Prompt muito curto.");
    return;
  }
  if (prompt.length > 2000) {
    bot.sendMessage(chatId, "Prompt muito longo (máx 2000 chars).");
    return;
  }

  log("INFO", chatId, `/claude: ${prompt.slice(0, 120)}`);
  await bot.sendMessage(chatId, "🤖 Invocando Claude Code (plan mode)...");

  try {
    const output = await runClaudeCode(prompt);
    const hash = shortHash();
    pendingConfirms.set(String(chatId), {
      hash,
      action: { type: "apply-claude-plan", prompt },
      expiresAt: Date.now() + 30 * 60_000, // 30 min
    });

    const truncated = output.slice(0, 3500);
    await bot.sendMessage(
      chatId,
      "```\n" + truncated + "\n```\n\nPara aplicar: `/confirm " + hash + "`",
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    log("ERROR", chatId, `claude exec: ${e.message}`);
    bot.sendMessage(chatId, `❌ Claude Code falhou:\n\`\`\`\n${e.message.slice(0, 500)}\n\`\`\``, {
      parse_mode: "Markdown",
    });
  }
});

bot.onText(/^\/confirm\s+(\w+)$/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAuthorizedChat(chatId) || !hasValidSession(chatId)) return;
  const hash = match[1];
  const pending = pendingConfirms.get(String(chatId));
  if (!pending || pending.hash !== hash) {
    bot.sendMessage(chatId, "❌ Nenhuma operação pendente com esse hash.");
    return;
  }
  if (Date.now() > pending.expiresAt) {
    pendingConfirms.delete(String(chatId));
    bot.sendMessage(chatId, "❌ Confirmação expirada.");
    return;
  }
  pendingConfirms.delete(String(chatId));

  if (pending.action.type === "apply-claude-plan") {
    try {
      await bot.sendMessage(chatId, "✍️ Aplicando alterações...");
      // Re-executa Claude Code, desta vez em acceptEdits (aplica mudanças)
      await runClaudeCode(pending.action.prompt, { apply: true });
      // Commit em branch dedicado
      const branch = `claude/${Date.now()}`;
      const gitOpts = { cwd: CLAUDE_WORKDIR, timeout: 30_000 };
      execSync(`git checkout -b ${branch}`, gitOpts);
      execSync(`git add -A`, gitOpts);
      // Escapa aspas no prompt para o -m
      const safeMsg = pending.action.prompt.slice(0, 60).replace(/"/g, "'");
      execSync(
        `git -c user.email=bot@claudecode.trade -c user.name="Claude Bot" commit -m "claude: ${safeMsg}"`,
        gitOpts
      );
      bot.sendMessage(chatId, `✅ Commit em branch \`${branch}\`.`, { parse_mode: "Markdown" });
      log("INFO", chatId, `applied claude plan, branch=${branch}`);
    } catch (e) {
      log("ERROR", chatId, `apply: ${e.message}`);
      bot.sendMessage(chatId, `❌ Falha ao aplicar: ${e.message.slice(0, 500)}`);
    }
  }
});

// ── Claude Code execution ────────────────────────────────────────
async function runClaudeCode(prompt, { apply = false } = {}) {
  return new Promise((resolveP, reject) => {
    const args = [
      "-p",
      prompt,
      "--output-format",
      "text",
      "--max-turns",
      String(CLAUDE_MAX_TURNS),
      "--add-dir",
      CLAUDE_WORKDIR,
      "--permission-mode",
      apply ? "acceptEdits" : "plan",
      "--disallowedTools",
      "Bash(rm:*)",
      "--disallowedTools",
      "Bash(sudo:*)",
      "--disallowedTools",
      "Bash(curl:*)",
      "--disallowedTools",
      "Bash(wget:*)",
      "--disallowedTools",
      "Bash(ssh:*)",
      "--disallowedTools",
      "Bash(scp:*)",
    ];
    if (CLAUDE_MODEL) args.push("--model", CLAUDE_MODEL);

    const child = spawn("claude", args, {
      cwd: CLAUDE_WORKDIR,
      env: { ...process.env, NO_COLOR: "1" },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolveP(out);
      else reject(new Error(`exit ${code}: ${err.slice(0, 400)}`));
    });

    // Timeout de 5 min
    setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timeout 5min"));
    }, 300_000);
  });
}

// ── Notificações proativas (chamadas de outros módulos via IPC/arquivo) ─
export function notifySignal(signal) {
  // signal: { symbol, direction, score, entry, sl, tp1, tp2, tp3, id }
  const msg = [
    `⚠️ *Sinal novo: ${signal.symbol} ${signal.direction}*`,
    `Score: ${signal.score}/100`,
    `Entry: ${signal.entry}  SL: ${signal.sl}`,
    `TP1: ${signal.tp1}  TP2: ${signal.tp2}  TP3: ${signal.tp3}`,
  ].join("\n");
  for (const chatId of ALLOWED_CHAT_IDS) {
    bot.sendMessage(chatId, msg, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ APROVAR", callback_data: `approve:${signal.id}` },
            { text: "❌ REJEITAR", callback_data: `reject:${signal.id}` },
          ],
        ],
      },
    });
  }
}

bot.on("callback_query", async (cb) => {
  const chatId = cb.message.chat.id;
  if (!isAuthorizedChat(chatId) || !hasValidSession(chatId)) {
    bot.answerCallbackQuery(cb.id, { text: "Sessão expirada. /auth primeiro." });
    return;
  }
  const [action, rawId] = cb.data.split(":");
  // Defesa em profundidade: valida o id mesmo que venha de callback_data
  // gerado pelo próprio bot. Se algum dia o id virar texto livre, blinda.
  if (!/^\d+$/.test(rawId || "")) {
    bot.answerCallbackQuery(cb.id, { text: "ID inválido." });
    return;
  }
  const id = parseInt(rawId, 10);
  try {
    if (action === "approve") {
      execSync(`node src/bot/executor.js --signal-id ${id}`, {
        cwd: ROOT,
        timeout: 60_000,
      });
      bot.answerCallbackQuery(cb.id, { text: "Ordem enviada ao executor." });
      bot.sendMessage(chatId, `✅ Sinal ${id} aprovado e executado.`);
    } else if (action === "reject") {
      execSync(`node -e "import('./src/storage/trades.js').then(m=>m.rejectSignal(${id}))"`, {
        cwd: ROOT,
        timeout: 10_000,
      });
      bot.answerCallbackQuery(cb.id, { text: "Sinal rejeitado." });
      bot.sendMessage(chatId, `❌ Sinal ${id} rejeitado.`);
    }
  } catch (e) {
    bot.answerCallbackQuery(cb.id, { text: "Erro." });
    bot.sendMessage(chatId, `❌ ${e.message}`);
  }
});

// ── Stubs — implementar quando src/storage/trades.js existir ──────
function buildStatus() {
  // TODO: ler data/trades.db via better-sqlite3
  // Placeholder:
  const services = ["api", "scanner", "monitor"];
  const lines = ["*Status:*"];
  for (const s of services) {
    try {
      const active = execSync(
        `systemctl is-active claudecode-${s} 2>/dev/null || echo unknown`,
        { encoding: "utf8", timeout: 5_000 }
      ).trim();
      lines.push(`• ${s}: ${active}`);
    } catch {
      lines.push(`• ${s}: ?`);
    }
  }
  // Tentar ler last-scan.json
  try {
    const p = resolve(ROOT, "data", "last-scan.json");
    if (existsSync(p)) {
      const data = JSON.parse(readFileSync(p, "utf8"));
      lines.push(`\nÚltimo scan: ${data.timestamp || "?"}`);
    }
  } catch {
    /* noop */
  }
  return lines.join("\n");
}

function listRecentSignals(n) {
  // TODO: SELECT * FROM signals ORDER BY id DESC LIMIT n
  return "_(implementar após src/storage/trades.js)_";
}

function listOpenPositions() {
  // TODO: SELECT * FROM positions WHERE status='open'
  return "_(implementar após src/storage/trades.js)_";
}

// ── Boot ─────────────────────────────────────────────────────────
log("INFO", "system", `bot iniciado (chats autorizados: ${ALLOWED_CHAT_IDS.length})`);
console.log(`[telegram] bot online — ${ALLOWED_CHAT_IDS.length} chat(s) autorizado(s)`);
