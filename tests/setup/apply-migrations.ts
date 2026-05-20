import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

// `TEST_MIGRATIONS` é injetado pelo binding extra em `vitest.workers.config.ts`
// (via `readD1Migrations`). `env.DB` é o D1 real do workerd, com isolamento
// por teste graças a `isolatedStorage: true`.
beforeAll(async () => {
	await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
