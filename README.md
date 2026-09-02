# Loja de Plugins CS 1.6 — Automática

Sistema completo de loja para vender plugins Counter-Strike 1.6 com **tag personalizada**, pagamento via **Mercado Pago** e **entrega automática do plugin compilado (`.amxx`)** — só se vende `.amxx`, nunca `.sma`.

## Funcionamento

1. Cliente escolhe um plugin na loja
2. Preenche e-mail e **tag** (ex: `TRS`)
3. O sistema **procura qualquer tag tipo `[TRS]`** no `.sma` (nas mensagens de chat, defines, etc.) e **substitui pela tag do cliente**
4. Paga via Mercado Pago (checkout externo)
5. O webhook confirma o pagamento **automaticamente**
6. O sistema compila o `.sma` personalizado para `.amxx` e entrega na hora
7. O cliente baixa o `.amxx` pronto pela página "Meu pedido"

Se o compilador não conseguir gerar o `.amxx`, o pedido fica **pendente de compilação manual**
no painel admin (`needs_compile`) e você envia o `.amxx` pronto pela interface.

## Troca da tag (`.sma` → `tag do cliente`)

A função `applyTag` substitui **todos** os padrões de tag encontrados:

- Tags entre colchetes em strings de chat: `"[TRS] %s"` → `"[FURIA] %s"` (iguais a `[TRS]`)
- `#define PLUGIN "VipSystem"` → `#define PLUGIN "FURIA"`
- `register_plugin("VipSystem", ...)` → `register_plugin("FURIA", ...)`
- `new const TAG[] = "[TRS]";` → `new const TAG[] = "[FURIA]";`
- `#define TAG [TRS]` (fora de string) → `#define TAG [FURIA]`

> Se você usa um nome/prefixo único no seu `.sma` (ex: `[TRS]`) nas mensagens,
> ele será trocado em **todas** as ocorrências. Use um nome fora do padrão se quiser
> garantir que só a "tag verdadeira" seja atingida.

## Compilador: OBRIGATÓRIO (entrega é `.amxx`)

O site **só vende `.amxx`**. Sem compilador ele não entrega o `.sma`, apenas marca o pedido
como `needs_compile` para você resolver pelo admin.

### Local (Windows)

O compilador já foi baixado para a pasta `compiler/`:

```
compiler/addons/amxmodx/scripting/amxxpc.exe
```

No `.env`: `AMXXPC_PATH=C:\Users\Windows\Desktop\ajuda\compiler\addons\amxmodx\scripting\amxxpc.exe`
(o `.env` atual já está apontando para ele)

### Render (Linux) — automático

O `buildCommand` já roda `sh setup-compiler.sh`, que baixa e extrai o compilador AMXX 1.10
(base + cstrike) na hora do deploy. Configure no painel do Render:

```
AMXXPC_PATH=/app/compiler/addons/amxmodx/scripting/amxxpc
```

### Includes customizados

Se algum `.sma` usa includes que não vêm no pacote padrão (factureshop, nvault, etc.),
copie os `.inc` extras para `compiler/addons/amxmodx/scripting/include/`
(no Render, para dentro da mesma pasta `include/`).

## Como rodar localmente

```bash
npm install
npm run dev
```

Acesse `http://localhost:3000`

### Testar SEM Mercado Pago (modo demo)

Com `DEMO_MODE=on` (padrão quando `MP_ACCESS_TOKEN` está vazio), o checkout **simula o
pagamento aprovado** e entrega o `.amxx` na hora. Fluxo de teste:

1. Abra `/admin` (senha: `ADMIN_PASSWORD` do `.env`) e cadastre um plugin (envie um `.sma` e defina o preço)
2. Na loja, clique em Comprar, informe e-mail + tag (ex: `FURIA`)
3. O sistema compila e entrega o `.amxx` automaticamente
4. Baixe e confira

## Deploy no Render

1. Crie um serviço **Blueprint** ou **Web Service** Node
2. Importe este repositório (o `setup-compiler.sh` cuida do compilador)
3. Variáveis de ambiente (ver `.env.example`):
   - `MP_ACCESS_TOKEN` (para produção usar `APP_USR-...`)
   - `WEBHOOK_SECRET` (string aleatória)
   - `ADMIN_PASSWORD`
   - `AMXXPC_PATH=/app/compiler/addons/amxmodx/scripting/amxxpc`
   - `APP_URL=https://SEUAPP.onrender.com`
   - `DEMO_MODE=off`

## Config no Mercado Pago

1. Crie uma app em https://www.mercadopago.com.br/developers
2. Pegue o **Access Token** (test: `TEST-...`, produção: `APP_USR-...`)
3. No painel do MP, configure a URL de notificação:

- **URL de notificação (webhook):** `https://SEUAPP/api/webhook/mp`
- Evento: **Pagamentos** (payment)

## Cadastrando plugins (painel admin)

1. Acesse `/admin` (senha do `.env`)
2. Preencha nome, preço, descrição
3. Envie o arquivo `.sma` base — o sistema usará ele como molde
4. Alterne ativo/inativo e mude o **valor** direto na tabela
5. Na aba Pedidos: ver, aprovar manualmente e **enviar `.amxx`** para pedidos `needs_compile`

## Estrutura

```
src/
  server.js            # entrypoint Express
  data/store.js        # persistência (.sma base + pedidos em JSON)
  services/compiler.js # troca de tag ([TAG]) + compilação via amxxpc
  services/mercadopago.js
  services/delivery.js # entrega automática pós-pagamento (.amxx)
  routes/              # public, checkout, api (webhook), admin
  public/css/          # estilos
  views/               # páginas EJS
compiler/              # compilador AMXX (gera .amxx)  — Windows local
setup-compiler.sh      # baixa o compilador no Render (build)
plugins-src/           # .sma de exemplo
```