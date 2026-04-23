# ClaudeCode-Trade — Deploy AWS

Pasta com tudo que você precisa para rodar o projeto na AWS dentro do **Free Tier** (gratuito por 12 meses) e controlá-lo do celular via Telegram.

## Arquivos

| Arquivo | Para quê |
|---------|----------|
| `01-GUIA-AWS-COMPLETO.md` | **Comece por aqui.** Passo a passo do zero: conta AWS, billing, EC2, SSH, deploy. |
| `02-SEGURANCA.md` | Camadas de segurança: Tailscale, fail2ban, IAM, gestão de segredos, backup. |
| `03-TELEGRAM-BOT.md` | Como criar o bot, autenticação, comandos, executar Claude Code remotamente. |
| `bootstrap.sh` | Script de primeira inicialização do EC2 (cole no "User Data"). |
| `harden.sh` | Hardening do SO: SSH, fail2ban, unattended-upgrades. |
| `backup-db.sh` | Backup diário do SQLite para `/var/backups/claudecode-trade`. |
| `deploy.sh` | Deploy do seu PC local → EC2 via rsync + SSH. |
| `systemd/*.service` e `*.timer` | Serviços que mantêm tudo rodando 24/7 e reiniciam sozinhos. |
| `nginx.conf` | Opcional: reverse-proxy HTTPS se quiser dashboard exposto. |
| `../../.env.aws.example` | Template de variáveis para produção na nuvem. |

## Ordem sugerida

1. Leia `01-GUIA-AWS-COMPLETO.md` até o fim antes de clicar em nada.
2. Crie a conta AWS + billing alert (Seção 1–3 do guia).
3. Lance o EC2 com `bootstrap.sh` (Seção 4).
4. Rode `harden.sh` + instale Tailscale (Seção 5 + `02-SEGURANCA.md`).
5. Configure o bot Telegram (`03-TELEGRAM-BOT.md`).
6. Faça o primeiro deploy com `deploy.sh` (Seção 7).
7. Teste tudo em **PAPER_TRADE=true** por 2 semanas antes de tocar em API keys reais.

## Resumo de custos

Tudo aqui cabe no Free Tier. Depois de 12 meses, custo estimado: **~US$ 8,50/mês** (EC2 t3.micro). Veja seção 3 do guia para como configurar alerta de cobrança em US$ 1.
