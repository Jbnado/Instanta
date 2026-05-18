import { drizzle } from "drizzle-orm/d1";

import * as schema from "./schema";

// Factory chamada uma vez por request a partir do `c.env`.
// Não cachear globalmente: cada Worker invocation recebe um Env próprio.
export function getDB(env: { DB: D1Database }) {
	return drizzle(env.DB, { schema });
}

export type DB = ReturnType<typeof getDB>;
export { schema };
