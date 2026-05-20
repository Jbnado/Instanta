// Bindings extras injetados apenas em testes (via miniflare.bindings em vitest.workers.config.ts).
// `TEST_MIGRATIONS` carrega o SQL gerado pelo Drizzle Kit pra `apply-migrations.ts` aplicar.
//
// Estende `Cloudflare.Env` (tipo gerado por `wrangler types` em worker-configuration.d.ts)
// usando declaration merging — `import { env } from "cloudflare:test"` pega o tipo combinado.
import type { D1Migration } from "@cloudflare/vitest-pool-workers";

declare global {
	namespace Cloudflare {
		interface Env {
			TEST_MIGRATIONS: D1Migration[];
		}
	}
}

export {};
