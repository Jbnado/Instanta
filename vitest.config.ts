import { defineConfig } from "vitest/config";

// Config raiz: agrega os 2 projects (client jsdom + workers workerd) e
// concentra coverage. Cada project tem env e pool próprios — Vitest 4.x
// resolve `projects: [path]` lendo o arquivo apontado.
export default defineConfig({
	test: {
		projects: [
			"./vitest.client.config.ts",
			"./vitest.workers.config.ts",
		],
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov", "html"],
			reportsDirectory: "./coverage",
			// Threshold baseline (Story 1.3 — Bernardo aprovou 60% como porta-de-entrada).
			// Story 1.4 aperta no CI gate junto com bundle-size.
			thresholds: {
				lines: 60,
				functions: 60,
				branches: 60,
				statements: 60,
			},
			exclude: [
				"**/node_modules/**",
				"**/dist/**",
				"**/.wrangler/**",
				"**/drizzle/migrations/**",
				"**/*.config.{ts,js}",
				"**/tests/**",
				"**/*.test.{ts,tsx}",
				"worker-configuration.d.ts",
				"src/main.tsx",
				"src/vite-env.d.ts",
			],
		},
	},
});
