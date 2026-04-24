# research/

Área de pesquisa do projeto — análises externas, avaliações e propostas de mudança de estratégia.

## Estrutura

```
research/
├── external/    ← análises de profissionais (PDFs, markdown, screenshots)
├── review/      ← avaliação do Claude aplicando persona de trader experiente
└── proposals/   ← propostas de mudança na estratégia que precisam aprovação do Julio
```

## Fluxo quando chega análise externa

1. **Julio** dropa o material em `research/external/YYYY-MM-DD-<fonte>.md` (ou PDF)
   - Ex: `research/external/2026-04-25-coinbase-institutional-report.pdf`
   - Ex: `research/external/2026-04-25-glassnode-onchain-thread.md`

2. **Claude** lê e escreve avaliação em `research/review/YYYY-MM-DD-<fonte>-review.md`:
   - Resumo do que a análise diz
   - Avaliação aplicando persona de trader experiente (Buffett/MicroStrategy/Elliott/manipulação)
   - Comparação com o setup atual: onde concorda, onde diverge
   - Vale pra nós? (sim/não/parcial)

3. Se a avaliação identificar algo **valioso que diverge** do setup atual, **Claude** escreve proposta em `research/proposals/YYYY-MM-DD-<tema>.md`:
   - Mudança proposta (qual arquivo, qual linha, qual valor novo)
   - Rationale técnico
   - Impacto esperado (backtest/paper se possível)
   - Risco da mudança

4. **Julio** aprova ou rejeita explicitamente antes de qualquer mudança em código de estratégia.

## Regras de autonomia do Claude

**Requer aprovação antes de editar:**
- `src/strategy/setups.js` — definição dos 5 setups
- `src/strategy/signals.js` — scoring engine
- `src/strategy/risk.js` — SL/TP/sizing
- `src/config/strategy.js` — MIN_SCORE, SCORING_WEIGHTS, etc.

**Pode editar direto (só avisando depois):**
- `rules.json` — contexto macro
- Qualquer coisa em `research/`
