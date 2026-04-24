// ─────────────────────────────────────────────────────────────────
//  repo-health.js — Verifica integridade do repo (Node, portável)
//
//  Usage:
//    node scripts/repo-health.js           (saída completa)
//    node scripts/repo-health.js --quiet   (só imprime se falhar)
//
//  Exit code:
//    0 = tudo ok
//    1 = algum problema encontrado
//
//  Checa:
//    1. Null bytes em qualquer .js/.jsx/.json/.md/.sh
//    2. Sintaxe JavaScript (node --check em .js)
//    3. JSON parseável
//    4. Arquivos < 50 bytes (provável truncamento)
//    5. Debug artifacts na raiz (eth.json, btc.json, *.debug.json)
// ─────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { execSync } from "child_process";
import { resolve, join, dirname, extname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const QUIET = process.argv.includes("--quiet");

// ── Colors ──────────────────────────────────────────────────────
const C = {
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  grey:   (s) => `\x1b[90m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
};

// ── Collector ───────────────────────────────────────────────────
const problems = []; // { severity: 'error' | 'warn', section, msg }
const buffer   = []; // deferred output when --quiet

function out(line = "") {
  if (QUIET) buffer.push(line);
  else console.log(line);
}
function section(name) { out(); out(C.bold(`=== ${name} ===`)); }
function ok(msg)       { out(`  ${C.green("✓")} ${msg}`); }
function bad(section, msg) {
  problems.push({ severity: "error", section, msg });
  out(`  ${C.red("✗")} ${msg}`);
}
function warn(section, msg) {
  problems.push({ severity: "warn", section, msg });
  out(`  ${C.yellow("⚠")} ${msg}`);
}

// ── File walking ────────────────────────────────────────────────
const SKIP_DIRS = new Set(["node_modules", ".git", "data", "dist", "build", ".next", ".cache"]);

function* walk(dir, { exts }) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p, { exts });
    else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (exts.includes(ext)) yield p;
    }
  }
}

function countNullBytes(path) {
  const buf = readFileSync(path);
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 0) n++;
  return n;
}

// ── 1. Null bytes ───────────────────────────────────────────────
function checkNullBytes() {
  section("1. Null bytes em source/config");
  let found = 0;
  const roots = ["src", "scripts", "dashboard/src"].map((r) => resolve(ROOT, r));
  const exts  = [".js", ".jsx", ".json", ".md", ".sh"];
  for (const root of roots) {
    for (const f of walk(root, { exts })) {
      const n = countNullBytes(f);
      if (n > 0) { bad("null_bytes", `${n} null bytes em ${relPath(f)}`); found++; }
    }
  }
  // Root config files
  const rootFiles = [
    "package.json", "package-lock.json", "rules.json", "monitors.json",
    "docker-compose.yml", ".gitignore", "README.md", "CLAUDE.md",
  ];
  for (const name of rootFiles) {
    const p = resolve(ROOT, name);
    if (!existsSync(p)) continue;
    const n = countNullBytes(p);
    if (n > 0) { bad("null_bytes", `${n} null bytes em ${name}`); found++; }
  }
  if (found === 0) ok("nenhum null byte encontrado");
}

// ── 2. Sintaxe JavaScript ───────────────────────────────────────
function checkJsSyntax() {
  section("2. Sintaxe JavaScript (node --check)");
  let found = 0;
  const roots = ["src", "scripts"].map((r) => resolve(ROOT, r));
  for (const root of roots) {
    for (const f of walk(root, { exts: [".js"] })) {
      try {
        execSync(`node --check "${f}"`, { stdio: "pipe" });
      } catch (err) {
        const stderr = (err.stderr?.toString() ?? err.message).split("\n").slice(0, 3).join(" | ");
        bad("js_syntax", `${relPath(f)} — ${stderr}`);
        found++;
      }
    }
  }
  if (found === 0) ok("todos os .js parseiam");
}

// ── 3. JSON válido ──────────────────────────────────────────────
function checkJson() {
  section("3. JSON válido");
  let found = 0;
  const roots = [".", "src", "scripts", "dashboard/src"].map((r) => resolve(ROOT, r));
  const seen = new Set();
  for (const root of roots) {
    for (const f of walk(root, { exts: [".json"] })) {
      if (seen.has(f)) continue;
      seen.add(f);
      try { JSON.parse(readFileSync(f, "utf8")); }
      catch (err) { bad("json", `${relPath(f)} — ${err.message.split("\n")[0]}`); found++; }
    }
  }
  if (found === 0) ok("todos os .json parseiam");
}

// ── 4. Arquivos pequenos (provável truncamento) ─────────────────
function checkSmallFiles() {
  section("4. Arquivos pequenos (possível truncamento)");
  let found = 0;
  const roots = ["src", "scripts", "dashboard/src"].map((r) => resolve(ROOT, r));
  for (const root of roots) {
    for (const f of walk(root, { exts: [".js", ".jsx"] })) {
      const size = statSync(f).size;
      if (size < 50) {
        warn("small_file", `${relPath(f)} apenas ${size} bytes — verifique se foi truncado`);
        found++;
      }
    }
  }
  if (found === 0) ok("nenhum arquivo suspeitosamente pequeno");
}

// ── 5. Debug artifacts na raiz ──────────────────────────────────
function checkDebugArtifacts() {
  section("5. Debug artifacts na raiz");
  const suspect = ["eth.json", "btc.json", "scratch.js", "scratch.json", "tmp.json", "debug.json"];
  let found = 0;
  for (const name of suspect) {
    if (existsSync(resolve(ROOT, name))) {
      warn("debug_artifact", `${name} presente na raiz — é debug? (remover se sim; já está no .gitignore)`);
      found++;
    }
  }
  // *.debug.json
  for (const f of readdirSync(ROOT)) {
    if (f.endsWith(".debug.json")) {
      warn("debug_artifact", `${f} presente na raiz — remover se não é usado em produção`);
      found++;
    }
  }
  if (found === 0) ok("raiz limpa");
}

// ── Helpers ─────────────────────────────────────────────────────
function relPath(p) { return p.replace(ROOT, "").replace(/\\/g, "/").replace(/^\//, ""); }

// ── Run ─────────────────────────────────────────────────────────
checkNullBytes();
checkJsSyntax();
checkJson();
checkSmallFiles();
checkDebugArtifacts();

const errors = problems.filter((p) => p.severity === "error");
const warns  = problems.filter((p) => p.severity === "warn");

// Em --quiet, só emite se algo deu errado
if (QUIET && errors.length === 0 && warns.length === 0) {
  process.exit(0);
}

// Em --quiet com problema, solta tudo que estava bufferizado
if (QUIET) {
  for (const line of buffer) console.log(line);
}

console.log();
if (errors.length === 0 && warns.length === 0) {
  console.log(C.green(C.bold("✓ Repo está saudável.")));
  process.exit(0);
} else if (errors.length === 0) {
  console.log(C.yellow(C.bold(`⚠ ${warns.length} aviso(s) (não fatal).`)));
  process.exit(0);
} else {
  console.log(C.red(C.bold(`✗ ${errors.length} erro(s) encontrado(s).`)));
  if (warns.length > 0) console.log(C.yellow(`  (+ ${warns.length} aviso(s))`));
  process.exit(1);
}
