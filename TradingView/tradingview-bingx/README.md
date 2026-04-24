# tradingview-bingx

Sistema semi-automatizado de trading em BingX USDC-M Perpetual Futures.
Indicadores técnicos (EMA, RSI, MACD, StochRSI) são computados localmente a
partir de OHLCV da Binance Spot REST API — nenhuma dependência externa de
GUI ou desktop.

Refatorado em 2026-04-23 para rodar portável via Docker, sem instalar
Node ou dependências no host.

## Roda em 2 comandos (qualquer OS)

```bash
cp .env.example .env    # preencha API keys + wallet de withdraw
docker compose up -d
```

Dashboard fica em `http://localhost:3000`, API em `http://localhost:3001`.

## Como está estruturado

```
src/
  analysis/       leitura de mercado (técnica, on-chain, orderbook, macro)
  strategy/       setups, risk, fibonacci, signals (vazio após reset 04/23)
  exchanges/      bingx.js (USDC-M futures) + withdraw.js (USDC → BASE)
  bot/            scanner, monitor, executor
  api/            Express :3001
  config/         strategy.js (parâmetros), index.js (.env loader)
  storage/        SQLite schema + queries
dashboard/        React + Vite + Tailwind, roda em :3000
skills/           4 skills especializadas (technical, risk, setup, executor)
scripts/          start, stop, restart, reset-stack, docker-start, …
```

## Skills disponíveis

| Skill | Quando aciona |
|---|---|
| [technical-analysis](skills/technical-analysis/SKILL.md) | "Analise BTC agora" |
| [risk-management](skills/risk-management/SKILL.md) | "Quanto posso arriscar?" |
| [setup-detector](skills/setup-detector/SKILL.md) | "Existe setup aparecendo?" |
| [trade-executor](skills/trade-executor/SKILL.md) | "Aprove o sinal" / "withdraw lucro" |

## Modos de operação

| Modo | `.env` |
|---|---|
| **Paper** (simula) | `PAPER_TRADE=true` |
| **Live** | `PAPER_TRADE=false` + BingX API keys válidas |
| **Auto-withdraw dry-run** | `AUTO_WITHDRAW_ENABLED=true` + `WITHDRAW_DRY_RUN=true` |
| **Auto-withdraw live** | `AUTO_WITHDRAW_ENABLED=true` + `WITHDRAW_DRY_RUN=false` + whitelist BingX feito |

## Auto-withdraw

Ao fechar um trade USDC-M com P&L > 0:

1. Transfere USDC de Perpetual Futures → Fund/Main
2. Saca USDC direto para a carteira configurada na rede **BASE**

Não há mais swap USDT→USDC: os trades já são liquidados em USDC, então
o lucro sai direto para a wallet externa.

Destino (configurável em `.env`):
- `WITHDRAW_WALLET_ADDRESS=0xD211b268fc17556C0cF8540938CE5C61f0E18E90`
- `WITHDRAW_NETWORK=BASE`

### Arquitetura de keys (menor privilégio)

O projeto usa **duas API keys separadas** na BingX:

- **Trade key** (`BINGX_API_KEY`/`BINGX_SECRET_KEY`) — Futures Read + Trade. Sem Withdraw.
- **Withdraw key** (`BINGX_WITHDRAW_API_KEY`/`BINGX_WITHDRAW_SECRET_KEY`) — Withdraw + Internal Transfer. Sem Trade.

Se a trade key vazar, o atacante não saca fundos. A withdraw key fica
em branco enquanto `AUTO_WITHDRAW_ENABLED=false`.

### Antes de ligar em produção

1. Adicionar `0xD211…8E90` na whitelist BingX para BASE
2. Gerar **duas** API keys separadas (trade e withdraw)
3. Preencher `BINGX_WITHDRAW_API_KEY` / `BINGX_WITHDRAW_SECRET_KEY` no `.env`
4. Rodar em `WITHDRAW_DRY_RUN=true` por ≥3 trades lucrativos
5. Validar logs, depois flipar para `false`

## Comandos úteis

```bash
# Nativo (requer Node 18+)
npm run start      # sobe tudo em background
npm run stop       # mata processos e libera portas
npm run reset      # para tudo + apaga DB e logs (reset completo)
npm run scan       # um ciclo de scan único

# Docker (sem instalar nada, qualquer OS)
npm run docker:up      # docker compose up -d --build
npm run docker:logs    # stream de logs
npm run docker:down    # para e remove containers
npm run docker:reset   # limpa volumes + rebuild
```

## Limpeza do repositório (primeira vez)

O repositório vinha com `node_modules/` commitado (~36MB). Para limpar:

```bash
git rm -r --cached node_modules dashboard/node_modules
git commit -m "chore: remove node_modules from tracking"
```

Isso não apaga a pasta localmente; só tira do git. O `.gitignore`
atualizado garante que elas não voltem.

## Fonte de dados de mercado

Os indicadores técnicos são computados localmente a partir de OHLCV público
(`api.binance.com`) em `src/analysis/technical.js`. Preços de execução e
orderbook vêm direto da BingX REST API. Não há dependência de cliente
desktop, extensão de navegador, ou bridge CDP.

## Arquivos de estratégia

| Arquivo | Papel |
|---|---|
| `src/config/strategy.js` | `STRATEGY` e `SETUPS` — vazio após reset |
| `rules.json` | Contexto de mercado + regras de risco (vazio após reset) |
| `monitors.json` | Price-level monitors (vazio após reset) |
| `.env` | Keys, capital, modos de operação |

Preencha conforme a nova estratégia. As skills em `skills/` têm schemas
prontos e exemplos de como escrever cada tipo.
