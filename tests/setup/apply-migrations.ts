import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

// `TEST_MIGRATIONS` é injetado pelo binding extra em `vitest.workers.config.ts`
// (via `readD1Migrations`). `env.DB` é o D1 real do workerd, com isolamento
// por teste graças a `isolatedStorage: true`.
// `env.DB` é opcional na tipagem (env.preview não declara d1_databases),
// mas no project workers `wrangler.jsonc` sempre traz o binding. Assert é seguro.
beforeAll(async () => {
	if (!env.DB) throw new Error("env.DB ausente — verifique wrangler.jsonc no project workers");
	await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
