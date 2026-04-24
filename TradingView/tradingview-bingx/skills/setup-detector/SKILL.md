---
name: setup-detector
description: Reconhece padrões/setups definidos em src/config/strategy.js → SETUPS e avalia confluência (entry trigger + filters). Use quando o usuário perguntar "tem algum setup aparecendo?", "identifique padrão", "rode o scanner", ou quando quiser adicionar/editar um setup nomeado. Orquestra technical-analysis → evaluateSetups() → sinal candidato, mas não executa nem dimensiona — isso é trabalho de risk-management e trade-executor.
---

# setup-detector

Varre os símbolos ativos (`STRATEGY.SYMBOLS` × `SYMBOL_CONFIG.enabled`)
rodando os avaliadores em `src/strategy/setups.js` e retorna quais
setups triggaram.

## Quando usar

- Usuário pergunta "tem algum setup aparecendo?"
- Usuário pede para rodar um scan único ou contínuo
- Usuário pede para adicionar um setup novo

## Como rodar um scan

```bash
# Scan único (uma passada em todos os símbolos ativos)
node src/bot/scanner.js --once

# Ou programaticamente:
node -e "import('./src/strategy/signals.js').then(m => m.generateSignal('BTCUSDC').then(console.log))"
```

## Como adicionar um setup novo

1. **Definir config** em `src/config/strategy.js → SETUPS`:

   ```js
   MEU_SETUP: {
     id:          "MEU_SETUP",
     name:        "Título curto",
     description: "O que dispara em 1 frase",
     leverage:    3,
     sl_pct:      0.005,
     tp_r:        { tp1: 1.5, tp2: 2.618, tp3: 4.236 },
     enabled:     true,
     symbols:     ["BTCUSDC"],
     direction:   "LONG",
     // … parâmetros custom do trigger
   }
   ```

2. **Criar avaliador** em `src/strategy/setups.js`:

   ```js
   async function _evalMeuSetup(symbol, technical, onchain) {
     const cfg = SETUPS.MEU_SETUP;
     if (!cfg?.enabled || (cfg.symbols && !cfg.symbols.includes(symbol))) {
       return _notTriggered(cfg);
     }
     const rationale = [];
     // … sua lógica …
     if (!triggered) return _notTriggered(cfg, rationale);
     return {
       setup_id: cfg.id, setup_name: cfg.name, triggered: true,
       direction: "LONG", confidence: 75, rationale,
       leverage: cfg.leverage, sl_pct: cfg.sl_pct, tp_r: cfg.tp_r,
     };
   }
   ```

3. **Registrar** em `_ALL_EVALUATORS` no topo do `setups.js`.

4. **Validar** rodando: `npm run test:signals`

## Tipos de monitor (estado-máquina) em `monitors.json`

Além dos setups estatísticos acima, existem price-level monitors para
gatilhos discretos (toque em nível, breakout+retest). Schema:

```json
{
  "id": "string único",
  "symbol": "BTCUSDC",
  "enabled": true,
  "type": "TOUCH_WEAKNESS_ENTRY | BREAKOUT_RETEST",
  "direction": "LONG | SHORT",
  "touch_level": 78000,          // TOUCH_WEAKNESS_ENTRY
  "entry_level": 77500,          // TOUCH_WEAKNESS_ENTRY
  "level": 78000,                // BREAKOUT_RETEST
  "retest_tolerance_pct": 0.012, // BREAKOUT_RETEST
  "leverage": 5,
  "sl_pct": 0.015,
  "tp_r":    { "tp1": 1.5, "tp2": 2.6, "tp3": 4.0 },   // ou…
  "tp_fixed": [79000, 80000, 81000],                   // …preços absolutos
  "reset_above": 78500,          // condição de rearme
  "expiry_hours": 72
}
```

## Checklist ao criar setup

1. ✅ `tp_r.tp1 ≥ 1.5` (regra do projeto — pós-fees R:R ≥ 1.4)
2. ✅ `sl_pct > 0` e coerente com a volatilidade do símbolo
3. ✅ Avaliador nunca lança exceção — em dúvida, retorne `_notTriggered()`
4. ✅ `rationale[]` sempre populado — fica visível no dashboard
