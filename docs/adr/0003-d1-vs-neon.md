# 0003 — D1 no MVP; plano de migração pra Neon+Hyperdrive

- **Status:** Accepted (2026-05-07)
- **Deciders:** Bernardo (solo dev)
- **Supersedes:** —
- **Superseded by:** —

## Context

Precisamos SQL relacional (NFR41). MVP com custo zero target, latência baixa pro Brasil. Cap 10 GB hard do D1 vs ~5-10 MB/evento estimado = ~1000 eventos antes de chegar perto do teto. Schema atual cabe folgado: fotos vão pra Cloudflare Images, só metadados ficam no DB. Cap atomic check (NFR59) precisa ser server-side com strong consistency.

## Decision

**MVP roda em Cloudflare D1.** SQLite edge-distributed, binding nativo no Worker, free tier suficiente. Migrations gerenciadas via Drizzle Kit (`pnpm db:generate`) + aplicadas via `wrangler d1 migrations apply`.

**Estratégia N+1 (expand-contract)** documentada em `docs/runbook.md` § "Migrations: estratégia N-1" — toda migration destrutiva é dividida em 3 PRs (expand → switch reads → contract) pra evitar janela de incompatibilidade entre Worker em prod e schema.

**Gatilhos de migração pra Neon+Hyperdrive (documentados, NÃO implementados no MVP):**
- **Gatilho 1**: aproximação de **7 GB** (70% do limite D1) → migrar **tudo** pra Neon+Hyperdrive.
- **Gatilho 2**: hot table específica com contention de escrita → mover **só ela** pra Neon, manter resto em D1.

**Mecanismo da migração:**
- Drizzle ORM suporta D1 e Postgres com mesma API → código de queries não muda.
- Dual-write D1↔Neon durante janela de transição.
- Switch reads pro Neon.
- Drop D1 (ou drop só a hot table).

**Alert**: Cron Trigger `alert-monitor` (Story 1.8/1.12) inclui check de D1 size → email admin quando atinge 7 GB.

## Alternatives considered

- **Neon desde o início:** custo R$/mês mesmo com 0 eventos (free tier limitado); latência maior (Postgres não-edge); over-engineering pro MVP.
- **PlanetScale/Vitess:** custo fixo, MySQL (Drizzle suporta, mas perdemos triggers/single-thread features do SQLite que `cap atomic` usa).
- **Supabase:** ótimo DX mas mistura Auth/Storage/Realtime que não precisamos (já temos CF Images, Resend, polling); custo fixo.
- **AWS RDS:** descartado por custo e complexidade operacional.

## Consequences

**Positive:**
- **Custo zero** no MVP (free tier).
- **Latência baixa** (edge SQLite).
- **Cap atomic via single-thread SQLite**: NFR59 resolvido sem 2-phase commit nem locking distribuído.
- **Drizzle agnóstico**: a migração futura não é re-escrita do código de DB, só switch de provider.

**Negative:**
- **10 GB hard cap** — depois disso, D1 começa a rejeitar writes. Mitigado pelo alert em 7 GB + auto-clean D+30 que mantém DB enxuto.
- **Single-thread por DB**: feature de escrita pesada (não esperada no MVP) viraria gargalo.
- **Sem extensions Postgres** (full-text search, JSONB indexing). Aceito — usamos D1 só pra metadata leve.

**Neutral:**
- Audit log 12 meses retenção: pode virar candidato pra hot table → move só ele pra Neon antes do resto.

## References

- `_bmad-output/planning-artifacts/architecture.md` § Data Architecture
- `instanta/docs/runbook.md` § Migrations: estratégia N-1 (expand-contract)
- PRD NFR41, NFR59, B-001, B-002
- [[0001-stack-cloudflare-vite-react]] — escolha de provider de banco depende da escolha de runtime
