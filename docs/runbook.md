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
