import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDB } from "../../src/server/db/client";
import { users } from "../../src/server/db/schema";
import { makeUser } from "../fixtures/seeds";

// Smoke worker test — prova que:
// 1. `env.DB` é um D1Database real (vindo do workerd via vitest-pool-workers).
// 2. `apply-migrations.ts` rodou em beforeAll (tabelas existem).
// 3. Drizzle factory `getDB(env)` retorna client tipado e funciona.
// 4. `isolatedStorage: true` zera dados entre arquivos — não precisa cleanup manual.
describe("D1 smoke", () => {
	it("insere e lê um user", async () => {
		const db = getDB(env);
		const user = makeUser({ email: "smoke@instanta.dev" });

		await db.insert(users).values(user);
		const rows = await db.select().from(users).where(eq(users.email, "smoke@instanta.dev"));

		expect(rows).toHaveLength(1);
		expect(rows[0].id).toBe(user.id);
		expect(rows[0].displayName).toBe(user.displayName);
	});
});
