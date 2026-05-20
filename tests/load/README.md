# Load tests

Scripts manuais de carga (k6, autocannon) **fora do CI**. Use antes de release maior pra validar NFRs de performance que unit/integration não cobrem.

## Quando rodar

- **NFR9 — polling thundering herd:** 200 clientes fazendo `GET /api/events/:eventId/since?ts=` em loop por 10 min. Confirma que ETag/304 no edge segura a carga sem aumentar Worker invocations linearmente.
- Antes de subir Story que abre endpoint público sob polling agressivo (feed, telão).
- Quando suspeitar que uma mudança no cache layer degradou perf.

## Como rodar

Não há setup automático. Cada script é standalone:

```bash
# k6 (instalar via https://k6.io/docs/get-started/installation/)
k6 run tests/load/polling-thundering-herd.ts

# autocannon (vem como devDep quando uma story precisar)
pnpm exec autocannon -c 200 -d 600 http://localhost:5173/api/events/<slug>/since
```

## Scripts previstos (não implementados ainda)

- `polling-thundering-herd.ts` — origem na architecture, NFR9. Story 1.3 só reserva o slot; implementação real quando o endpoint `/api/events/:eventId/since` existir (Epic 3+).

## O que NÃO entra aqui

- Testes que rodam em todo PR — usar `tests/integration/` (Vitest + workerd).
- Testes E2E de usuário — usar `tests/e2e/` (Playwright).
- Benchmarks de bundle size — Story 1.5 (CI gate dedicado).
