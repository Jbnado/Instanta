import { defineConfig } from "drizzle-kit";

// Apenas `generate` aqui. `apply` é via wrangler (`pnpm db:migrate:local|remote`),
// por isso não precisamos de `driver: "d1-http"` nem dbCredentials.
export default defineConfig({
	out: "./drizzle/migrations",
	schema: "./src/server/db/schema.ts",
	dialect: "sqlite",
	verbose: true,
	strict: true,
});
