import { drizzle } from "drizzle-orm/d1";

import * as schema from "./schema";

// Factory chamada uma vez por request a partir do `c.env`.
// Não cachear globalmente: cada Worker invocation recebe um Env próprio.
//
// `DB` é opcional na tipagem porque o env `preview` (Story 1.4) não declara
// d1_databases — preview deploys sem DB. Aqui assumimos que quem chama está
// numa rota que deveria ter DB; jogamos erro claro se faltar.
export function getDB(env: { DB?: D1Database }) {
	if (!env.DB) {
		throw new Error(
			"D1 binding `DB` ausente neste env (provavelmente preview). Rotas que tocam o banco precisam do env de produção.",
		);
	}
	return drizzle(env.DB, { schema });
}

export type DB = ReturnType<typeof getDB>;
export { schema };
