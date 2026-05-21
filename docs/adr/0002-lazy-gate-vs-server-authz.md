# 0002 — Lazy permission gates (UX/perf) + Server-side authz (segurança)

- **Status:** Accepted (2026-05-07)
- **Deciders:** Bernardo (solo dev)
- **Supersedes:** —
- **Superseded by:** —

## Context

NFR15 pede que "rotas e código de funcionalidades restritas não cheguem ao bundle de usuários sem permissão". NFR52 pede authz server-side em **toda** rota mutável e em rotas com dado privilegiado. A confusão clássica é tratar essas duas regras como redundantes ("se o bundle não tem, ninguém acessa") ou como conflitantes ("qual é a camada de segurança real?"). Sem decisão explícita, é fácil cair em um dos dois antipadrões: bundle gating como única defesa (vulnerável a request direta na API) ou middleware authz sem lazy gate (UX vaza informação sobre features que o usuário não pode usar).

## Decision

**Defense-in-depth: ambos, sempre, com responsabilidades distintas.**

**NFR15 — Lazy permission gate (frontend):**
- Rotas restritas (`/admin/*`, host-only) usam `React.lazy()` + dynamic registration no TanStack Router.
- Hook `use-permission-gate` decide carregar o chunk com base em role atual do usuário.
- **Propósito**: UX (não exibir entries de menu pra features inacessíveis) + perf (não baixar código que o user não vai usar).
- **Não é segurança**: assume que um atacante pode modificar o bundle local; isso não vaza dado privilegiado.

**NFR52 — Server-side authz middleware (backend):**
- Toda rota mutável + toda rota com dado privilegiado passa pelo `src/server/middleware/authz.ts` (futuro).
- Middleware revalida role atual no DB pra ações sensíveis (admin, role assignment) — **nunca** confia em flag de role no JWT/cookie sem revalidar.
- 401 se sem sessão; **404 (não 403)** se sem permissão — anti-enumeration (FR56).
- **Propósito**: segurança real. Esta é a camada que para acesso não-autorizado.

**Enforcement automatizado:**
- ESLint `no-restricted-imports` em `src/server/services/**` impede imports de `hono`/`@cloudflare/workers-types` — services puros, blindados, testáveis isoladamente, sem dependência de runtime CF.
- PR review checklist (manual): "endpoint novo passa por authz middleware?".

## Alternatives considered

- **Apenas server authz, sem lazy gate:** mais simples mas vaza estrutura de menu pra usuários sem permissão; bundle inteiro baixa em todas as sessões.
- **Apenas lazy gate:** falso senso de segurança; atacante puxa direto na API.
- **Authz em Hono no `app.use()` global em vez de middleware dedicado:** acopla todas as rotas; difícil dar exceção pra rotas públicas (login, signup) sem boilerplate. Middleware dedicado em `/api/*` específicos é mais legível.

## Consequences

**Positive:**
- Camadas independentes — falha em uma não compromete a outra.
- UX limpa (sem opções fantasma) + segurança robusta.
- 401 vs 404 padrão evita account enumeration.
- ESLint guard impede regressões silenciosas em services puros.

**Negative:**
- 2 lugares pra ler/aprovar em PR (lazy registration + middleware). Mitigado por checklist + ESLint.
- Lazy chunks adicionam complexidade de routing (skeletons, error boundaries) — aceito (TanStack Router resolve).

**Neutral:**
- Convenção 401/404 precisa ser doc'd no playbook de auth (futura story).

## References

- `_bmad-output/planning-artifacts/prd.md` NFR15, NFR52, FR56
- `_bmad-output/planning-artifacts/architecture.md` § Authz check (regra de ouro)
- `instanta/eslint.config.js` — `no-restricted-imports` em `src/server/services/**`
- [[0001-stack-cloudflare-vite-react]] — bundle splitting habilita lazy gate
