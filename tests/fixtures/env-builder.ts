// Builder pra services puros (não usam bindings reais do CF runtime).
// Para testes que **precisam** de D1/KV/DO de verdade, use `import { env } from "cloudflare:test"`
// no project `workers`, não este builder.
//
// `Env` é o tipo gerado por `wrangler types` em `worker-configuration.d.ts`.
// Faz cast porque defaults só preenchem o que services puros costumam ler
// (strings de config); bindings ficam `undefined` e quebram em runtime real —
// é o ponto: forçar quem chama a setar o que precisa via `overrides`.

const defaults = {
	// vazio hoje. Quando JWT_SECRET / RESEND_API_KEY / etc. existirem (Story 2.x / 1.11),
	// adicionar valores fake aqui pra services pegarem sem caller precisar repetir.
};

export function mockEnv(overrides: Partial<Env> = {}): Env {
	return { ...defaults, ...overrides } as Env;
}
