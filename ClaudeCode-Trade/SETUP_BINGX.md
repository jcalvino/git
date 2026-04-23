# Guia: Configurando API Keys na BingX

## Pré-requisitos
- Conta verificada na BingX (KYC completo)
- Futuros USDT-M habilitado na conta

## Passo a Passo

### 1. Acessar o gerenciamento de API

1. Faça login em [bingx.com](https://bingx.com)
2. Clique no seu avatar (canto superior direito)
3. Selecione **"API Management"** (Gerenciamento de API)

### 2. Criar nova API Key

1. Clique em **"Create API"**
2. Preencha os campos:
   - **Label**: `btc-eth-trader` (ou qualquer nome descritivo)
   - **Passphrase**: uma senha forte para a API (anote com segurança)

### 3. Configurar permissões (IMPORTANTE)

Marque APENAS estas permissões:
- ✅ **Read** (leitura de conta e mercado)
- ✅ **Futures Trade** (execução de trades em futuros)

Deixe desmarcado:
- ❌ Withdraw (nunca habilitar para bots)
- ❌ Internal Transfer
- ❌ Sub-account

### 4. Restrição de IP (Recomendado)

Para maior segurança, adicione seu IP público:
- Descubra seu IP em: [whatismyip.com](https://www.whatismyip.com)
- Adicione na lista de IPs permitidos
- Isso garante que a chave só funciona do seu computador

### 5. Confirmar com 2FA

Complete a verificação com seu app autenticador ou e-mail.

### 6. Salvar as credenciais

Você verá:
- **API Key**: string longa (ex: `abc123def456...`)
- **Secret Key**: string longa — **copie agora, não aparece novamente!**

### 7. Configurar no projeto

```bash
# Na pasta claudecode-trade/
cp .env.example .env
```

Abra `.env` e preencha:
```
BINGX_API_KEY=sua_api_key_aqui
BINGX_SECRET_KEY=sua_secret_key_aqui
PAPER_TRADE=true   # mantenha true para testar primeiro!
```

### 8. Testar a conexão

```bash
node src/exchanges/bingx.js
```

Saída esperada:
```
✅ BingX connection OK
   Account balance: 200.00 USDT (available)
   BTC price: $74,500.00
   ETH price: $2,315.00
```

### 9. Antes de ativar trades reais

- [ ] Rodar em PAPER_TRADE=true por pelo menos 2 semanas
- [ ] Validar que os sinais gerados fazem sentido
- [ ] Confirmar que os cálculos de SL/TP estão corretos
- [ ] Verificar que o position sizing está correto ($2 max risk)
- [ ] Só então mudar PAPER_TRADE=false

## Testnet BingX

A BingX oferece um ambiente de testnet para desenvolvedores:
- URL: `https://open-api-vst.bingx.com`
- Para usar o testnet, altere `BINGX_BASE_URL` no `.env`:
  ```
  BINGX_BASE_URL=https://open-api-vst.bingx.com
  ```

## Configurar Futuros USDT-M na BingX

1. Acesse **Futures** → **USDT-M Perpetual**
2. Transfira $200 USDT do spot para futuros:
   - Clique em **Transfer** → **From Spot to Futures**
3. Configure a alavancagem:
   - Abra BTCUSDT → Clique em **"Leverage"** → Set **1x**
   - Repita para ETHUSDT
4. Modo de margem: **Cross** (padrão para 1x sem alavancagem)

## Resolução de Problemas

| Erro | Causa | Solução |
|------|-------|---------|
| `Invalid API-KEY` | Chave errada ou expirada | Verifique .env, recrie a chave |
| `Signature error` | Secret key incorreta | Verifique espaços extras no .env |
| `IP not allowed` | IP mudou | Atualize IP nas configurações da API |
| `Insufficient balance` | Sem USDT em futuros | Transfira de spot para futuros |
| `Position mode error` | Modo de posição errado | Mude para "One-way mode" nas config |
