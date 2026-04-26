# Guia: Configurando API Keys na BingX

## Pré-requisitos
- Conta verificada na BingX (KYC completo)
- Futuros USDC-M Perpetual habilitado na conta
- USDC depositado na carteira de Futuros (Perpetual)

## Arquitetura de keys — princípio de menor privilégio

O projeto usa **uma única API key** na BingX, com escopo mínimo:

| Key | Permissões | Usada por | Var .env |
|---|---|---|---|
| **TRADE** | Futures Read + Futures Trade | scanner, executor, monitor | `BINGX_API_KEY` / `BINGX_SECRET_KEY` |

A key **não** tem permissão de Withdraw nem Internal Transfer. Se ela
vazar (roda em CI, logs, containers), o atacante não consegue mover
dinheiro pra fora — só pode abrir/fechar posições, o que é
auto-contido no saldo da Perpetual.

Saques são feitos **manualmente** no console da BingX quando você
quiser realizar lucro acumulado. O bot não move USDC pra fora.

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

### 3. Restrição de IP (Recomendado)

Para maior segurança, adicione seu IP público:
- Descubra seu IP em: [whatismyip.com](https://www.whatismyip.com)
- Adicione na lista de IPs permitidos
- Isso garante que a chave só funciona do seu computador

### 4. Confirmar com 2FA

Complete a verificação com seu app autenticador ou e-mail.

### 5. Salvar as credenciais

Você verá:
- **API Key**: string longa (ex: `abc123def456...`)
- **Secret Key**: string longa — **copie agora, não aparece novamente!**

Guarde as 2 strings em local seguro (password manager).

### 6. Configurar no projeto

```bash
# Na pasta tradingview-bingx/
cp .env.example .env
```

Abra `.env` e preencha:
```
BINGX_API_KEY=sua_trade_api_key_aqui
BINGX_SECRET_KEY=sua_trade_secret_key_aqui

PAPER_TRADE=true   # mantenha true para testar primeiro!
```

### 7. Testar a conexão

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

### 8. Antes de ativar trades reais

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
