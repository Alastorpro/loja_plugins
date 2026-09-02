# Resumo — Loja de Plugins CS 1.6 ([DEV] Alastor)

## O que está pronto

Site completo em `C:\Users\Windows\Desktop\ajuda` (Node.js + Express), tema **vermelho e preto**.

### Fluxo de venda
1. Cliente escolhe plugin na loja → informa e-mail + **tag** (ex: `FURIA`)
2. O sistema procura tags tipo `[TRS]` no `.sma` e troca pela tag do cliente
   (chat, `#define PLUGIN`, `register_plugin`, `new TAG[] = "[...]"`)
3. Pagamento via **Mercado Pago** (webhook em `/api/webhook/mp`)
4. Após aprovado → compila `.amxx` **automaticamente** (compilador AMXX 1.10 já baixado)
5. Cliente baixa o **`.amxx`**; admin baixa o **`.sma`** pra conferir a tag

### Painel admin (`/admin` - senha `ADMIN_PASSWORD` do `.env`, hoje `mude-essa-senha`)
- Cadastrar/editar valor/ativar/excluir plugins (com upload do `.sma` base)
- Pedidos: ver, aprovar manualmente, **enviar `.amxx`** (p/ pedidos `needs_compile`), baixar `.sma` p/ conferir
- Sugestões: ver, marcar lida, excluir — **não lida expira em 24h** (purge automático a cada hora)

### Testes feitos (tudo confirmado funcionando)
- Compilação `.amxx` real (header `XXMA`, download 200)
- Tag `[TRS]` → `[FURIA]` aplicada em todas as ocorrências
- `.sma` só acessível pelo admin (cliente: 404)
- Sugestão não lida com 25h → sumiu; lida → ficou
- Modo demo simula pagamento (útil p/ testar local)
- ID do pedido no Discord (integração opcional)

## Pendências / próximos passos (amanhã)

1. **Discord webhook** — terminar teste rápido e colar sua URL real no `.env`:
   `DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/ID/TOKEN`
   (ativado: avisos de pedido iniciado / pagamento aprovado / sugestão)
2. **Deploy** — decidir: Render free (atenção: disco efêmero, dados resetam no redeploy)
   ou VPS Oracle free (recomendada p/ operar). Chamar `sh setup-compiler.sh` no build p/ baixar compilador.
3. **Credenciais Mercado Pago reais** — gerar token de produção `APP_USR-...` e configurar
   notificação (`https://SEUAPP/api/webhook/mp`, evento Pagamentos). Trocar senha admin.
4. **Demo/wire o pagamento real** — colocar `DEMO_MODE=off` quando for operar de verdade.

## Como rodar de novo

```bash
cd C:\Users\Windows\Desktop\ajuda
npm run dev        # ou npm start
# site em http://localhost:3000
```

## Arquivos importantes
- `src/services/compiler.js` → troca de tag + compilação
- `src/services/delivery.js` → entrega automática do `.amxx`
- `src/services/discord.js` → avisos no Discord
- `src/routes/admin.js` + `src/views/admin.ejs` → painel
- `.data/` → plugins, pedidos e sugestões (banco em JSON)
- `compiler/` → compilador AMXX instalado
- `plugins-src/` → `.sma` de exemplo (`antiflood.sma`, `vipsystem.sma`)