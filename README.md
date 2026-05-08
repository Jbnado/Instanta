# Instanta

Feed colaborativo de fotos por evento. Stack: Vite + React 19 + TypeScript + Hono + Cloudflare Workers + D1 (Drizzle).

## Pré-requisitos

- Node.js ≥ 20 (testado em 24.x)
- pnpm ≥ 10
- Conta Cloudflare com `wrangler login` feito **uma vez**

## Dev local

```sh
pnpm install
pnpm dev          # Vite + Worker via @cloudflare/vite-plugin (HMR)
pnpm typecheck    # tsc -b --noEmit
pnpm lint         # eslint .
pnpm build        # tsc -b && vite build
pnpm preview      # build + vite preview
```

`pnpm dev` sobe Vite + Worker no mesmo processo. Edite `src/react-app/**` ou `src/server/**` e o HMR reflete em <500ms.

## Estrutura

```
src/
├── react-app/    # SPA (entry: main.tsx → App.tsx)
├── server/       # Hono Worker (entry: index.ts)
│   └── services/ # services puros — sem HTTP, sem CF runtime (boundary ESLint)
├── shared/       # tipos e schemas cross frontend↔backend
├── components/ui # shadcn/ui (Button override h-11 / NFR33 touch target)
└── lib/utils.ts  # cn() helper
```

Path aliases (`tsconfig.app.json`, `tsconfig.worker.json`, `vite.config.ts`):

- `@/*` → `src/*`
- `@shared/*` → `src/shared/*`
- `@server/*` → `src/server/*`

## Cloudflare

D1 dev: `instanta-dev` (binding `DB` em `wrangler.jsonc`).

```sh
pnpm wrangler login          # uma vez por máquina
pnpm wrangler d1 list        # confirma instanta-dev
pnpm wrangler types          # regenera worker-configuration.d.ts após mudar bindings
```

Secrets locais ficam em `.dev.vars` (gitignored). Use `.dev.vars.example` como referência. Em produção, `wrangler secret put <NAME>`.

## Boundary ESLint

`src/server/services/**` não pode importar `hono`, `@cloudflare/workers-types`, `routes/`, ou `middleware/`. Services são puros e testáveis sem subir Worker.
