#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  repo-health.sh — Verifica integridade do repo no Windows
#
#  Rode no Git Bash a partir da raiz do projeto:
#    bash scripts/repo-health.sh
#
#  Checa:
#    1. Null bytes em qualquer arquivo de código/config
#    2. Sintaxe JavaScript (node --check em todos os .js)
#    3. JSON válido (python -m json.tool em todos os .json)
#    4. Arquivos "pequenos demais" que podem estar truncados
#    5. Debug artifacts na raiz (eth.json, btc.json, *.debug.json)
# ─────────────────────────────────────────────────────────────

set -u
cd "$(dirname "$0")/.." || exit 1

RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; GREY=$'\e[90m'; BOLD=$'\e[1m'; RESET=$'\e[0m'
fail=0

section () { echo; echo "${BOLD}=== $* ===${RESET}"; }
ok ()      { echo "  ${GREEN}✓${RESET} $*"; }
bad ()     { echo "  ${RED}✗${RESET} $*"; fail=$((fail+1)); }
warn ()    { echo "  ${YELLOW}⚠${RESET} $*"; }

# ── 1. Null bytes ───────────────────────────────────────────
section "1. Null bytes em source/config"
found=0
while IFS= read -r f; do
  n=$(tr -cd '\000' < "$f" | wc -c | tr -d ' ')
  if [ "$n" -gt 0 ]; then
    bad "$n null bytes em $f"
    found=1
  fi
done < <(find src scripts dashboard/src -type f \( -name "*.js" -o -name "*.jsx" -o -name "*.json" -o -name "*.md" -o -name "*.sh" \) 2>/dev/null)
for f in package.json package-lock.json rules.json monitors.json docker-compose.yml .gitignore README.md CLAUDE.md; do
  [ -f "$f" ] || continue
  n=$(tr -cd '\000' < "$f" | wc -c | tr -d ' ')
  if [ "$n" -gt 0 ]; then
    bad "$n null bytes em $f"
    found=1
  fi
done
[ $found -eq 0 ] && ok "nenhum null byte encontrado"

# ── 2. Sintaxe JavaScript ───────────────────────────────────
section "2. Sintaxe JavaScript (node --check)"
found=0
while IFS= read -r f; do
  if ! out=$(node --check "$f" 2>&1); then
    bad "$f"
    echo "    ${GREY}$(echo "$out" | head -3 | tail -1)${RESET}"
    found=1
  fi
done < <(find src scripts -type f -name "*.js" 2>/dev/null)
[ $found -eq 0 ] && ok "todos os .js parseiam"

# ── 3. JSON válido ──────────────────────────────────────────
section "3. JSON válido"
found=0
while IFS= read -r f; do
  if ! python -m json.tool "$f" >/dev/null 2>&1; then
    bad "$f"
    found=1
  fi
done < <(find . -maxdepth 3 -type f -name "*.json" -not -path "./node_modules/*" -not -path "./dashboard/node_modules/*" -not -path "./dashboard/dist/*" -not -path "./data/*" 2>/dev/null)
[ $found -eq 0 ] && ok "todos os .json parseiam"

# ── 4. Arquivos suspeitos de truncamento ────────────────────
section "4. Arquivos pequenos (possível truncamento)"
found=0
# Arquivos .js/.jsx com menos de 50 bytes costumam ser placeholders/truncados
while IFS= read -r f; do
  size=$(wc -c < "$f" | tr -d ' ')
  if [ "$size" -lt 50 ]; then
    warn "$f apenas $size bytes — verifique se foi truncado"
    found=1
  fi
done < <(find src scripts dashboard/src -type f \( -name "*.js" -o -name "*.jsx" \) 2>/dev/null)
[ $found -eq 0 ] && ok "nenhum arquivo suspeitosamente pequeno"

# ── 5. Debug artifacts na raiz ──────────────────────────────
section "5. Debug artifacts na raiz"
found=0
for pat in eth.json btc.json "*.debug.json" scratch.* tmp.*; do
  for f in $pat; do
    [ -f "$f" ] || continue
    warn "$f presente — é debug artifact? (rm se sim, já está no .gitignore)"
    found=1
  done
done 2>/dev/null
[ $found -eq 0 ] && ok "raiz limpa"

# ── Resumo ──────────────────────────────────────────────────
echo
if [ $fail -eq 0 ]; then
  echo "${GREEN}${BOLD}✓ Repo está saudável.${RESET}"
  exit 0
else
  echo "${RED}${BOLD}✗ $fail problema(s) encontrado(s).${RESET}"
  exit 1
fi
