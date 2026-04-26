# Skills — tradingview-bingx

Skills especializadas que Claude (via Cowork ou Claude Code) carrega quando
aciona tarefas específicas neste projeto. Cada skill é uma pasta com
`SKILL.md` + (opcional) scripts de apoio.

## Skills disponíveis

| Skill | Gatilho | Papel |
|---|---|---|
| [technical-analysis](./technical-analysis/SKILL.md) | "analise BTC", "leia indicadores" | Lê EMA/RSI/MACD calculados localmente a partir de OHLCV da Binance Spot e reporta leitura técnica |
| [risk-management](./risk-management/SKILL.md) | "qual posição", "calcule stop", "verificar risco" | Calcula position size, SL/TP e valida regras antes da execução |
| [setup-detector](./setup-detector/SKILL.md) | "existe setup?", "adicionar setup novo" | Reconhece setups definidos em `src/config/strategy.js` e orquestra geração |
| [trade-executor](./trade-executor/SKILL.md) | "executar sinal", "aprovar trade" | Coloca ordem USDC-M na BingX + SL/TP. Saques de lucro são manuais. |

## Como as skills se encaixam no pipeline

```
[technical-analysis] → [setup-detector] → [risk-management] → [trade-executor]
     ↑                                                              ↓
     └──────── dashboard (aprovar)  ←──── sinal pendente ───────────┘
```
