import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
	cloudflareTest,
	readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Project `workers`: testes rodam dentro do workerd real (CF runtime).
// Bindings (D1, KV, DO) vêm de `wrangler.jsonc` via plugin `cloudflareTest`.
// `TEST_MIGRATIONS` é um binding de teste extra: carrega o SQL gerado pelo
// Drizzle Kit pra `apply-migrations.ts` aplicar em `beforeAll`.
export default defineConfig({
	plugins: [
		cloudflareTest(async () => {
			const migrationsPath = path.join(__dirname, "drizzle", "migrations");
			const migrations = await readD1Migrations(migrationsPath);
			return {
				wrangler: { configPath: "./wrangler.jsonc" },
				miniflare: {
					bindings: { TEST_MIGRATIONS: migrations },
					compatibilityFlags: ["nodejs_compat"],
				},
				// Zera D1/KV/DO entre testes — sobrescreve a granularidade que a
				// architecture original previa (por arquivo). Pool-workers dá mais sem custo.
				isolatedStorage: true,
			};
		}),
	],
	resolve: {
		alias: [
			{ find: /^@shared\//, replacement: fileURLToPath(new URL("./src/shared/", import.meta.url)) },
			{ find: /^@server\//, replacement: fileURLToPath(new URL("./src/server/", import.meta.url)) },
			{ find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) },
		],
	},
	test: {
		name: "workers",
		include: ["tests/integration/**/*.test.ts", "src/server/**/*.test.ts"],
		setupFiles: ["./tests/setup/apply-migrations.ts"],
	},
});
