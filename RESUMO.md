# Resumo — Loja de Plugins CS 1.6 ([DEV] Alastor)

> ⚠️ **Versão atualizada e completa em `RESUMO.txt`.** Este arquivo é o resumo resumido; consulte o `.txt` para o passo a passo de deploy.

## Estado atual (02/09/2026)
- Site completo funcionando em `C:\Users\Windows\Desktop\ajuda` (Node.js + Express)
- Entrega automática do `.amxx` **confirmada funcionando** (compilador AMXX 1.10.0.5478)
- Página de **compilador online** (`/compilador`) criada e testada
- Token Mercado Pago de produção **funcionando** (testado via API)
- `DEMO_MODE=off`, `APPROVAL_MODE=auto`
- Código commitado e no GitHub (`84c020c`, repo `Alastorpro/loja_plugins`)

## Painel admin (`/admin` - senha `ADMIN_PASSWORD` do `.env` = `Alastor105004349`)
- Cadastrar/editar valor/ativar/excluir plugins
- Pedidos: ver, aprovar manualmente, enviar `.amxx` (p/ `needs_compile`), baixar `.sma`
- Sugestões: lidas não expiram; não lidas expiram em 24h (purge a cada hora)

## Importante sobre "precisa compilar manualmente"
- **Não é bug do compilador.** Com `DEMO_MODE=off` em localhost, o MP real não alcança o site (sem URL pública) → cai em manual.
- Para testar local: `DEMO_MODE=on` simula pagamento aprovado → entrega `.amxx` automático.
- Em produção (Render) com URL pública + webhook → funciona 100% automático.

## Próximo passo: deploy no Render
Ver `RESUMO.txt` para o passo a passo completo (variáveis de ambiente, webhook do MP, etc.).

## Como rodar
```bash
cd C:\Users\Windows\Desktop\ajuda
npm run dev        # ou npm start
# site em http://localhost:3000
```

## Arquivos importantes
- `src/services/compiler.js` → troca de tag + compilação (+ `compileStandalone`)
- `src/services/delivery.js` → entrega automática do `.amxx`
- `src/routes/public.js` + `src/views/compilador.ejs` → compilador online
- `src/routes/admin.js` + `src/views/admin.ejs` → painel
- `.data/` → plugins, pedidos, sugestões (JSON)
- `compiler/` → compilador AMXX (não vai pro git)
- `setup-compiler.sh` + `render.yaml` → deploy no Render