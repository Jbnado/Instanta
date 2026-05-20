import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Project `client`: componentes React em jsdom. Não usa CF runtime nem D1.
export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: [
			{ find: /^@shared\//, replacement: fileURLToPath(new URL("./src/shared/", import.meta.url)) },
			{ find: /^@server\//, replacement: fileURLToPath(new URL("./src/server/", import.meta.url)) },
			{ find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) },
		],
	},
	test: {
		name: "client",
		environment: "jsdom",
		globals: false,
		include: ["src/**/*.test.{ts,tsx}"],
		// `src/server/**` é responsabilidade do project `workers`.
		exclude: ["src/server/**", "node_modules/**", "dist/**", ".wrangler/**"],
		setupFiles: ["./tests/setup/vitest-setup-client.ts"],
	},
});
