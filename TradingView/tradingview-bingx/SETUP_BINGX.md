# Guia: Configurando API Keys na BingX

## Pré-requisitos
- Conta verificada na BingX (KYC completo)
- Futuros USDC-M Perpetual habilitado na conta
- USDC depositado na carteira de Futuros (Perpetual)

## Arquitetura de keys — princípio de menor privilégio

O projeto usa **duas API keys separadas** na BingX:

| Key | Permissões | Usada por | Var .env |
|---|---|---|---|
| **TRADE** | Futures Read + Futures Trade | scanner, executor, monitor | `BINGX_API_KEY` / `BINGX_SECRET_KEY` |
| **WITHDRAW** | Withdraw + Internal Transfer | `src/exchanges/withdraw.js` | `BINGX_WITHDRAW_API_KEY` / `BINGX_WITHDRAW_SECRET_KEY` |

Benefício: se a **trade key** vazar (roda em CI, logs, containers), o
atacante não consegue sacar fundos — ela não tem permissão Withdraw.
Inversamente, a **withdraw key** não consegue abrir posição alguma.

A withdraw key é **opcional**. Se ficar em branco, `withdraw.js` cai de
volta para a trade key e loga um aviso — mas nesse caso a trade key
teria que ter Withdraw habilitado, o que é exatamente o que queremos
evitar. Só rode `AUTO_WITHDRAW_ENABLED=true` + `WITHDRAW_DRY_RUN=false`
depois de gerar a segunda key.

## Passo a Passo

### 1. Acessar o gerenciamento de API

1. Faça login em [bingx.com](https://bingx.com)
2. Clique no seu avatar (canto superior direito)
3. Selecione **"API Management"** (Gerenciamento de API)

### 2. Criar a API Key de TRADE

1. Clique em **"Create API"**
2. Preencha os campos:
   - **Label**: `btc-eth-trader-trade` (ou qualquer nome descritivo)
   - **Passphrase**: uma senha forte para a API (anote com segurança)

Permissões desta key (somente estas):
- ✅ **Read** — obrigatório
- ✅ **Futures Trade** — obrigatório
- ❌ **Withdraw** — NÃO habilitar nesta key
- ❌ **Internal Transfer** — NÃO habilitar nesta key
- ❌ Sub-account

### 3. Criar a API Key de WITHDRAW (segunda key)

Somente se você for ligar `AUTO_WITHDRAW_ENABLED=true`. Caso contrário
pode pular este passo.

1. Clique em **"Create API"** de novo (nova key separada)
2. Label: `btc-eth-trader-withdraw`
3. Passphrase: uma senha forte DIFERENTE da trade key

Permissões desta key (somente estas):
- ✅ **Withdraw** — obrigatório
- ✅ **Internal Transfer** — obrigatório (move USDC de Perpetual → Fund/Main)
- ❌ **Futures Trade** — NÃO habilitar nesta key
- ❌ Sub-account

### 4. Restrição de IP (Recomendado)

Para maior segurança, adicione seu IP público:
- Descubra seu IP em: [whatismyip.com](https://www.whatismyip.com)
- Adicione na lista de IPs permitidos
- Isso garante que a chave só funciona do seu computador

### 5. Confirmar com 2FA

Complete a verificação com seu app autenticador ou e-mail.

### 6. Salvar as credenciais

Para **cada** key criada (trade e, se aplicável, withdraw) você verá:
- **API Key**: string longa (ex: `abc123def456...`)
- **Secret Key**: string longa — **copie agora, não aparece novamente!**

Guarde as 4 strings em local seguro (password manager).

### 7. Configurar no projeto

```bash
# Na pasta btc-eth-trader/
cp .env.example .env
```

Abra `.env` e preencha:
```
# Trade key (obrigatória p/ live trading)
BINGX_API_KEY=sua_trade_api_key_aqui
BINGX_SECRET_KEY=sua_trade_secret_key_aqui

# Withdraw key (deixe em branco se AUTO_WITHDRAW_ENABLED=false)
BINGX_WITHDRAW_API_KEY=sua_withdraw_api_key_aqui
BINGX_WITHDRAW_SECRET_KEY=sua_withdraw_secret_key_aqui

PAPER_TRADE=true   # mantenha true para testar primeiro!
```

### 8. Testar a conexão

```bash
node src/exchanges/bingx.js
```

Saída esperada:
```
✅ BingX connection OK
   Account balance: 1100.00 USDC (available)
   BTC price: $74,500.00
   ETH price: $2,315.00
```

### 9. Antes de ativar trades reais

- [ ] Rodar em PAPER_TRADE=true por pelo menos 2 semanas
- [ ] Validar que os sinais gerados fazem sentido
- [ ] Confirmar que os cálculos de SL/TP estão corretos
- [ ] Verificar que o position sizing está correto (≈1% do capital USDC de risco máx)
- [ ] Só então mudar PAPER_TRADE=false

## Testnet BingX

A BingX oferece um ambiente de testnet para desenvolvedores:
- URL: `https://open-api-vst.bingx.com`
- Para usar o testnet, altere `BINGX_BASE_URL` no `.env`:
  ```
  BINGX_BASE_URL=https://open-api-vst.bingx.com
  ```

## Configurar Futuros USDC-M na BingX

1. Acesse **Futures** → **USDC-M Perpetual**
2. Transfira USDC do Fund/Spot para Perpetual (Futures):
   - Clique em **Transfer** → **From Fund to Perpetual** (ou Spot → Perpetual)
3. Configure a alavancagem:
   - Abra BTC-USDC → Clique em **"Leverage"** → Set **1x**
   - Repita para ETH-USDC
4. Modo de margem: **Cross** (padrão para 1x sem alavancagem)

## Resolução de Problemas

| Erro | Causa | Solução |
|------|-------|---------|
| `Invalid API-KEY` | Chave errada ou expirada | Verifique .env, recrie a chave |
| `Signature error` | Secret key incorreta | Verifique espaços extras no .env |
| `IP not allowed` | IP mudou | Atualize IP nas configurações da API |
| `Insufficient balance` | Sem USDC em Perpetual | Transfira Fund/Spot → Perpetual |
| `Position mode error` | Modo de posição errado | Mude para "One-way mode" nas config |
