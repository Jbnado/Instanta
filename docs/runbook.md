# Instanta — Runbook operacional

Procedimentos operacionais e de manutenção do Instanta. Este documento cresce conforme stories de Epic 1 acrescentam capabilities (monitoramento D1, backups, alertas, etc.).

## Migrations: estratégia N-1 (expand-contract)

**Referência:** PRD B-002 (N-1 schema migrations).

Toda migration destrutiva (rename, drop, type change, NOT NULL retroativo) é dividida em 3 PRs para que **o código anterior e o atual continuem rodando em paralelo** durante o deploy. Isso evita janela de incompatibilidade entre o Worker em produção e o D1 que ele consulta.

### Os 4 passos do ciclo

1. **PR-1 — Expand.** Adiciona a coluna/tabela nova como **nullable** (ou cria a estrutura alvo ao lado da antiga). Nada é removido. Deploy seguro: código antigo ignora a coluna nova; código novo ainda nem foi escrito.
2. **Deploy + dual-write.** O código novo escreve em **ambos** os lugares (antigo e novo) por pelo menos um ciclo de release. Reads continuam vindo do lugar antigo. Esta janela existe pra detectar bugs sem perda de dados.
3. **PR-2 — Switch reads + backfill.** Reads passam para o novo lugar. Job idempotente popula valores faltantes (backfill). Quando o backfill terminou e os reads estão estáveis, marca a coluna nova como `NOT NULL` (se for o caso) numa migration separada.
4. **PR-3 — Contract (cleanup).** Remove o código velho de dual-write, dropa a coluna/tabela antiga, remove flags/feature-toggles. Esta é a primeira migration efetivamente destrutiva, e só roda depois que ninguém mais lê do lugar antigo.

### Quando uma migration é "destrutiva"

- DROP COLUMN
- ALTER COLUMN com mudança de tipo
- Adicionar `NOT NULL` em coluna existente (em SQLite/D1 só funciona via tabela-shadow + COPY, então sempre vira destrutivo)
- RENAME TABLE / RENAME COLUMN com clientes vivos
- Mudança de PK ou de unique constraint

Adicionar coluna nullable, criar tabela nova ou criar índice **não** é destrutivo — vai num PR único sem ciclo expand-contract.

### Comandos operacionais

```bash
# 1. Editar src/server/db/schema.ts com a mudança expand-only.
pnpm db:generate         # gera drizzle/migrations/NNNN_*.sql
# 2. Revisar o SQL gerado.
pnpm db:migrate:local    # aplicar no D1 dev local
# 3. Smoke test (pnpm dev + manual).
pnpm db:migrate:remote   # aplicar no D1 prod (após PR mergeado).
```

### Por que N-1 importa no Instanta

D1 não tem transação cross-database nem replica. O Worker em prod e o Worker do PR de deploy compartilham o mesmo D1 — se a migration roda **antes** do deploy do código novo, requests antigos quebram; se roda **depois**, requests novos quebram. N-1 elimina essa janela ao garantir que **schema(N-1) é compatível com código(N)**.

Quando o cap D1 ≥ 7 GB disparar (Story 1.12), a migração para Neon + Hyperdrive segue o mesmo padrão: dual-write D1↔Neon, switch reads, drop D1. Documentar essa transição aqui quando acontecer.

## CI/CD: secrets e environments

GitHub Actions roda 6 workflows em `.github/workflows/` (Story 1.4). Antes de o primeiro PR rodar, configure isto **uma vez**:

### Secrets necessários

| Nome | Onde achar | Usado em |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token** → template **"Edit Cloudflare Workers"** + adicionar permissões `Workers KV Storage:Edit`, `Account:D1:Edit` se preview consumir DB futuramente | `preview.yml`, `deploy.yml` |
| `CLOUDFLARE_ACCOUNT_ID` | CF dashboard → sidebar direita "Account ID" (32 chars hex) | `preview.yml`, `deploy.yml` |

Configurar via CLI:

```bash
gh secret set CLOUDFLARE_API_TOKEN --body "<paste-token>"
gh secret set CLOUDFLARE_ACCOUNT_ID --body "<your-account-id>"
```

### Variable opcional (preview URL pretty)

`CLOUDFLARE_WORKERS_SUBDOMAIN` (sem prefixo `secrets.`, fica em **Variables**): seu subdomain `*.workers.dev` (ex: `bernardo`). Usado em `preview.yml` pra comentar a URL completa do preview. Sem isso, o comentário usa placeholder.

```bash
gh variable set CLOUDFLARE_WORKERS_SUBDOMAIN --body "<seu-subdomain>"
```

### GitHub Environment `production` com approval gate

`deploy.yml` referencia `environment: production`. Configure:

1. Repo Settings → **Environments** → **New environment** → nome `production`.
2. Marque **Required reviewers** e adicione **Bernardo** (você mesmo). Sem reviewer = sem gate.
3. (Opcional) **Deployment branches** → only `main`. Evita deploy acidental de outras branches.

Quando um push em main dispara `deploy.yml`, ele fica em "Waiting" até alguém aprovar via UI do Actions.

### Verificar setup

```bash
# token funciona?
pnpm dlx wrangler whoami

# secrets configurados?
gh secret list

# workflows visíveis?
gh workflow list
```

### Time budget

- **PR** (ci + integration + bundle-size + preview): ≤ 8 min.
- **main** (ci + integration + e2e + deploy): ≤ 15 min (deploy bloqueado por approval, conta após aprovar).

Se ultrapassar, suspeitar de cache pnpm não hidratado (primeiro run sempre mais lento) ou Playwright install sem cache (Story 1.4 não cacheia browsers — adicionar em 1.5 se virar dor).

## Cron Triggers

`src/server/scheduled.ts` despacha por `controller.cron`. Cron strings sempre em UTC (CF não suporta TZ). BR = UTC-3.

| Cron (UTC) | UTC | BRT | Handler | Finalidade |
|---|---|---|---|---|
| `0 3 * * *` | diário 03:00 | 00:00 | `auto-clean-d30` | DELETE photos com event.ended_at < now-30d (NFR21+NFR27); idempotente |
| `0 4 * * 0` | domingo 04:00 | sáb 01:00 | `audit-log-purge` | DELETE audit_log onde created_at < now-12meses (NFR46) |
| `0 5 * * *` | diário 05:00 | 02:00 | `backup-d1` | `wrangler d1 export` → R2 (NFR29, retenção 7 dias) |
| `*/15 * * * *` | a cada 15min | — | `alert-monitor` | spike detection auth/cap/D1 size/auto-clean failures (NFR61) |

**Story 1.8 = scaffold no-op.** Handlers só logam started/completed; cada feature substitui o no-op na sua story (4.x photo pipeline, 1.12 monitoring, etc.).

### Disparar local

```bash
# Terminal A: sobe wrangler dev com scheduled habilitado
pnpm wrangler dev --test-scheduled

# Terminal B: dispara um cron manualmente
curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"
# Encode espaço como `+`. Use o cron exato registrado em wrangler.jsonc.
```

Logs no terminal A mostram `cron.<name>.started` + `cron.<name>.completed`.

### Ambientes que disparam cron

- **production** — todos os 4 crons rodam.
- **preview** — **sem cron** (omitido em `env.preview.triggers`). Evita disparos no Worker `instanta-preview` por PRs vivos.

## Observability (Sentry + Microsoft Clarity)

**Story 1.9 = env-gated (prod-only).** Dev local e PR previews não carregam Sentry nem Clarity — não poluem dashboards nem queimam quota.

### Sentry (errors no Worker)

1. Criar projeto no [sentry.io](https://sentry.io) → tipo "Cloudflare Workers".
2. Copiar o DSN gerado.
3. Configurar como Wrangler secret no env **top-level** (prod). O `wrangler.jsonc` declara `env.preview`, então o CLI exige passar `--env` explícito pra evitar ambiguidade:
   ```bash
   pnpm dlx wrangler secret put SENTRY_DSN --env=""
   # `--env=""` (string vazia) = env top-level (Worker `instanta`).
   # Cola o DSN quando solicitado.
   ```
   Pra setar no Worker preview (raro — preview é Sentry no-op por design):
   ```bash
   pnpm dlx wrangler secret put SENTRY_DSN --env=preview
   ```
4. Verificar: `pnpm dlx wrangler secret list --env=""` (e `--env=preview` se setou lá).

Em dev local, `SENTRY_DSN` fica vazio em `.dev.vars` → Sentry vira no-op. Em preview, omitimos intencionalmente (a env `preview` não declara `version_metadata` nem aceita o secret).

**Release tagging:** `version_metadata` binding (gratuito) expõe `env.CF_VERSION_METADATA.id` que Sentry usa como release tag. Sem config adicional.

**Sampling:** `sampleRate: 1` (100% errors), `tracesSampleRate: 0` (sem performance traces no MVP — queimam quota free tier). Ajustar quando perf debugging for necessário.

**Como capturar um error customizado:**
```ts
import { logger } from "@server/lib/logger";

try {
  await riskyOp();
} catch (err) {
  logger.error({ event: "feature.failed", userId: user.id }, err);
  // Logger emite JSON local + Sentry.captureException se inicializado.
}
```

### Microsoft Clarity (session replay frontend)

1. Criar projeto em [clarity.microsoft.com](https://clarity.microsoft.com).
2. Copiar o project ID (alfanumérico curto, ex: `abc123xyz`).
3. Definir como GH variable (não secret — IDs Clarity são públicos):
   ```bash
   gh variable set VITE_CLARITY_PROJECT_ID --body "<seu-project-id>"
   ```
4. Atualizar `deploy.yml` pra exportar o ID no step de build:
   ```yaml
   - name: Build
     run: pnpm build
     env:
       VITE_CLARITY_PROJECT_ID: ${{ vars.VITE_CLARITY_PROJECT_ID }}
   ```
   *(pendente — adicionar quando o ID existir; sem `env`, build prod ainda funciona sem Clarity.)*

Em dev local (`pnpm dev`), `import.meta.env.PROD === false` → Clarity nunca carrega.

**Convenção `data-clarity-mask`:** forms e elementos com PII (email de outros usuários, senha, MFA codes, conteúdo de fotos no DOM, qualquer ID pessoal) **devem** receber `data-clarity-mask` no input/container. Clarity respeita nativamente — replay mostra placeholder em vez do conteúdo.

Stories de form futuras aplicarão. Padrão:
```tsx
<input data-clarity-mask type="email" name="email" />
<div data-clarity-mask>{user.email}</div>
```

## Domain DNS + Email Auth

`instanta.jbnado.dev` é o subdomínio prod (Bernardo possui `jbnado.dev`). Email transacional via Resend com sender `noreply@instanta.jbnado.dev`. NFR44 exige SPF + DKIM + DMARC válidos.

### Passo 1 — DNS provider

Duas opções, escolha **uma**:

**Opção A — migrar zona inteira `jbnado.dev` pra Cloudflare DNS** (recomendado se você não tem amarração com Vercel DNS):
- CF Dashboard → Add Site → `jbnado.dev` → CF mostra os 2 nameservers a configurar no registrar.
- No registrar do `jbnado.dev`, trocar nameservers pros da CF.
- Vercel (portfolio em `jbnado.dev`) continua funcionando — você cria CNAME/A no CF apontando pro Vercel.
- Propagação DNS: 5min-24h.

**Opção B — manter zona no Vercel, expor só subdomínio via CNAME**:
- No Vercel DNS panel, criar CNAME `instanta.jbnado.dev` → `<seu-worker>.<account>.workers.dev`.
- TXT records SPF/DKIM/DMARC ainda ficam no Vercel DNS.
- Mais simples se zona Vercel está cheia de outras configs.

### Passo 2 — Cloudflare Worker custom domain

Após zona DNS no CF (opção A) ou registro CNAME no Vercel (opção B):

- CF Dashboard → Workers & Pages → `instanta` → Settings → **Domains** → Add Custom Domain → `instanta.jbnado.dev`.
- CF provisiona TLS cert automático (Let's Encrypt). Aguarda alguns minutos.

`wrangler.jsonc` já tem `routes: [{ pattern: "instanta.jbnado.dev", custom_domain: true }]`. `wrangler deploy --env=""` em prod usa esse routing.

### Passo 3 — Conta Resend

- Criar conta em [resend.com](https://resend.com).
- Domains → **Add Domain** → `instanta.jbnado.dev`.
- Resend mostra **2 TXT records** a adicionar no DNS:
  - SPF (hostname `instanta.jbnado.dev` ou `@`).
  - DKIM (hostname `resend._domainkey.instanta.jbnado.dev` ou `resend._domainkey`).

### Passo 4 — TXT records no DNS

Adicionar no CF DNS (opção A) ou Vercel DNS (opção B):

| Type | Name | Value |
|---|---|---|
| TXT | `instanta.jbnado.dev` (ou `instanta`) | `v=spf1 include:_spf.resend.com -all` |
| TXT | `resend._domainkey.instanta.jbnado.dev` (ou `resend._domainkey.instanta`) | (valor do Resend dashboard — chave pública longa) |
| TXT | `_dmarc.instanta.jbnado.dev` (ou `_dmarc.instanta`) | `v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@jbnado.dev; fo=1` |

**DMARC mailbox**: o `rua=` é opcional mas valida o setup. Criar mailbox `dmarc-reports@jbnado.dev` (Resend ou Gmail) ou trocar pro seu email pessoal. Sem `rua=` válido, ainda passa pelo `verify:domain` desde que tenha `p=` e `v=DMARC1`.

### Passo 5 — Verificar propagação

```bash
# Em instanta/
pnpm verify:domain

# Forçar resolver CF (bypass cache do ISP/sistema)
pnpm verify:domain --server=1.1.1.1
```

Saída esperada após propagação:
```
SPF    ✓ SPF Resend OK
DKIM   ✓ 1 record(s)
DMARC  ✓ DMARC quarantine/reject + rua OK
```

### Passo 6 — Resend marca como Verified

No dashboard Resend, o domínio passa de "Pending" pra **Verified**. Sem isso, envios são bloqueados.

### Passo 7 — Wrangler secret RESEND_API_KEY

Resend → API Keys → Create → escopo "Send emails" → copiar.

```bash
pnpm dlx wrangler secret put RESEND_API_KEY --env=""
# Cola a key quando solicitado.
```

Stories futuras de email (reset de senha, ativação de evento, alertas LGPD) consomem `env.RESEND_API_KEY`.

### DMARC: subir pra reject após 30 dias

Comece em `p=quarantine` (emails legítimos vão pra spam se config quebrar). Após 30 dias sem reports estranhos, subir pra `p=reject` (negação dura). Editar TXT `_dmarc.instanta.jbnado.dev` no DNS.

### HSTS preload submission (decisão pendente)

NFR14 pede submeter `jbnado.dev` à HSTS preload list ([hstspreload.org](https://hstspreload.org)). Isso obriga **`includeSubDomains`** no apex — todos os subdomínios do `jbnado.dev` (portfolio Vercel + futuros) precisam servir HTTPS válido com cert.

- **Submeter no apex** se você está confortável com o lock-in (reversão leva meses).
- **Submeter só em `instanta.jbnado.dev`** se quer escopo restrito (HSTS preload na zona específica).
- **Adiar**: header HSTS já está sendo emitido (Story 1.6); preload é "force HTTPS antes mesmo do primeiro request". Não bloqueia produção.

### Custom domain em dev?

`pnpm dev` continua em `http://localhost:5173`. Não bate em `instanta.jbnado.dev`. CSP/CORS dev usa allowlist `localhost:5173` configurada em `.dev.vars`.
