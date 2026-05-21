# 0001 — Stack: Cloudflare Workers + Vite + React + Hono + D1

- **Status:** Accepted (2026-05-07)
- **Deciders:** Bernardo (solo dev)
- **Supersedes:** —
- **Superseded by:** —

## Context

Solo dev. MVP com custo R$ 1-5/evento alvo, ≤5/min de pickup. Decisões prévias travavam stack: shadcn/ui sobre Radix (React lock-in), Tailwind v4 + Inter Variable self-hosted (agnostic), Cloudflare Images decidido como image storage (FR21-28). Next.js explicitamente **vetado** no TAP refinado (2026-04-30). Restavam: framework SPA, runtime backend, banco SQL, hosting.

## Decision

**Frontend:** Vite + React 19 + TypeScript + TanStack Router (file-based) + TanStack Query (server state) + Zustand (client state) + Tailwind v4 + shadcn/ui. pnpm como package manager.

**Backend:** Hono em Cloudflare Workers, com Workers Assets servindo o SPA + API no mesmo Worker (uma origem, mesma deploy). Type-safety end-to-end via Hono RPC (`hc<typeof app>` cliente).

**Banco:** Cloudflare D1 (SQLite edge) + Drizzle ORM + Drizzle Kit. 12 tabelas no schema base. Hard cap 10 GB; plano de migração documentado (veja [[0003-d1-vs-neon]]).

**Validação:** Zod como fonte única, consumida por `react-hook-form` (forms) e `@hono/zod-validator` (request validation).

## Alternatives considered

- **Next.js:** vetado por decisão prévia (custo, complexidade, lock-in Vercel). Não revisitado.
- **NestJS + container tradicional (Railway/Fly):** descartado — overhead operacional, custo fixo independente de uso, latência pior fora da edge.
- **Astro/Solid:** descartados — ecossistema shadcn maduro em React; forks parciais em outros frameworks introduziriam fricção desnecessária pra solo dev.
- **Hono em Bun/Deno (não-CF):** Hono é portável; mas Workers Assets unifica SPA+API+CDN+billing+observability numa stack só. Lock-in CF deliberado e mitigado por `src/server/adapters/`.

## Consequences

**Positive:**
- Code splitting nativo (`import()` dinâmico) + TanStack Router lazy → bundle ≤200 KB gzip atingível (NFR3).
- Edge-first: latência baixa pro Brasil sem multi-região manual.
- Free tier CF cobre MVP (Workers + D1 + Assets gratuitos no plano hobby).
- Cliente type-safe sem codegen (Hono RPC compartilha tipos request/response com o front).
- 1 entry, 1 deploy, 1 origem — simplifica CORS, CSP, debug.

**Negative:**
- **Lock-in Cloudflare**: bindings (D1, KV, DO, Images) são proprietários. Mitigação: adapters em `src/server/adapters/` encapsulam acessos pra eventual migração.
- D1 10 GB hard cap → migração N+1 pra Neon+Hyperdrive já planejada ([[0003-d1-vs-neon]]).
- Workers tem CPU limit por request (~30s wall, mais curto em CPU); jobs longos vão pra Cron Triggers + Queues, não fetch handler.

**Neutral:**
- pnpm escolhido sobre npm/yarn por velocidade e store global. Compatível com CF tooling.

## References

- `_bmad-output/planning-artifacts/architecture.md` § Hosting & Backend Stack
- TAP refinado 2026-04-30 (Next.js veto)
- [[0002-lazy-gate-vs-server-authz]] — interage com bundle splitting
- [[0003-d1-vs-neon]] — depende deste pra entender o banco
