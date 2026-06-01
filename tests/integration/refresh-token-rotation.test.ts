import { env } from "cloudflare:test";
import { and, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import app from "../../src/server/app";
import { getDB } from "../../src/server/db/client";
import { sessions, users } from "../../src/server/db/schema";

// AC-7 (rotação single-use) + AC-8 (race protection R-002) via workerd real.
// Signup hashea com argon2id (argon2-wasm-edge — .wasm como módulo ES); a lógica
// de rotação/race vive em auth-service e tem cobertura isolada em auth-service.test.ts.
// Estes testes exercitam o caminho HTTP completo (signup → middleware → rotação).

const ORIGIN = "http://localhost:5173";

function signupRequest(email: string): Request {
	return new Request("http://localhost/api/auth/signup", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: ORIGIN,
			"cf-connecting-ip": `ip-${email}`,
		},
		body: JSON.stringify({
			email,
			password: "senha123abc",
			displayName: "Tester",
			termsAccepted: true,
		}),
	});
}

// Extrai `name=value` (sem atributos) dos Set-Cookie de uma response.
function readCookies(res: Response): Record<string, string> {
	const raw = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
	const jar: Record<string, string> = {};
	for (const line of raw) {
		const [pair] = line.split(";");
		const eqIdx = pair?.indexOf("=") ?? -1;
		if (pair && eqIdx > 0) {
			jar[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
		}
	}
	return jar;
}

function cookieHeader(jar: Record<string, string>): string {
	return Object.entries(jar)
		.map(([k, v]) => `${k}=${v}`)
		.join("; ");
}

function authTestRequest(jar: Record<string, string>): Request {
	return new Request("http://localhost/api/auth/_auth-test", {
		method: "GET",
		headers: { origin: ORIGIN, cookie: cookieHeader(jar) },
	});
}

describe("refresh token rotation", () => {
	let db: ReturnType<typeof getDB>;

	beforeEach(() => {
		db = getDB(env);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("AC-7: rotação single-use ao expirar access; reuse do refresh antigo → 401 + sessões revogadas", async () => {
		const signup = await app.request(signupRequest("rot7@example.com"), {}, env);
		expect(signup.status).toBe(201);
		const jar = readCookies(signup);
		expect(jar.instanta_access).toBeTruthy();
		expect(jar.instanta_refresh).toBeTruthy();

		// Access válido → 200.
		const ok = await app.request(authTestRequest(jar), {}, env);
		expect(ok.status).toBe(200);

		// Expira o access avançando 16min (JWT exp checa Date.now()).
		vi.useFakeTimers();
		vi.advanceTimersByTime(16 * 60 * 1000);

		// Próximo request: access expirado → middleware rotaciona via refresh → 200 + novos cookies.
		const rotated = await app.request(authTestRequest(jar), {}, env);
		expect(rotated.status).toBe(200);
		const newJar = readCookies(rotated);
		expect(newJar.instanta_refresh).toBeTruthy();
		expect(newJar.instanta_refresh).not.toBe(jar.instanta_refresh);

		// Avança o relógio ALÉM da janela de leeway (REUSE_LEEWAY_S = 10s) para que o
		// reuse do refresh ANTIGO seja classificado como roubo real (não race benigno).
		// O service lê `now()` via `new Date()`, então os fake timers movem seu relógio.
		vi.advanceTimersByTime(11_000);

		// Reusar o refresh ANTIGO (jar original) fora da janela → 401 + reuse detection
		// mata TODAS as sessões do user (kill all devices).
		const reuse = await app.request(
			authTestRequest({ instanta_refresh: jar.instanta_refresh! }),
			{},
			env,
		);
		expect(reuse.status).toBe(401);

		vi.useRealTimers();

		const [userRow] = await db.select().from(users).where(eq(users.email, "rot7@example.com"));
		const live = await db
			.select()
			.from(sessions)
			.where(and(eq(sessions.userId, userRow!.id), isNull(sessions.revokedAt)));
		expect(live).toHaveLength(0); // reuse detection matou todas as sessões
	});

	it("AC-8: race — 2 requests com mesmo refresh → exatamente 1×200 e 1×401", async () => {
		const signup = await app.request(signupRequest("race8@example.com"), {}, env);
		expect(signup.status).toBe(201);
		const jar = readCookies(signup);

		// Expira o access pra forçar o branch de rotação em ambos.
		vi.useFakeTimers();
		vi.advanceTimersByTime(16 * 60 * 1000);

		const refreshOnly = { instanta_refresh: jar.instanta_refresh! };
		const [a, b] = await Promise.all([
			app.request(authTestRequest(refreshOnly), {}, env),
			app.request(authTestRequest(refreshOnly), {}, env),
		]);
		vi.useRealTimers();

		const statuses = [a.status, b.status].sort();
		expect(statuses).toEqual([200, 401]);

		// DB: a original fica revogada e EXATAMENTE 1 sessão viva sobrevive — a nova do
		// vencedor. O perdedor encontra a original revogada DENTRO da janela de leeway
		// (REUSE_LEEWAY_S), classifica como race benigno (ConcurrentRotationError) e NÃO
		// mata a família. Isto é a dívida R-002 sendo fechada: antes era
		// toBeLessThanOrEqual(1) (não-determinístico); agora é determinístico.
		const [userRow] = await db.select().from(users).where(eq(users.email, "race8@example.com"));
		const all = await db.select().from(sessions).where(eq(sessions.userId, userRow!.id));
		const live = all.filter((s) => s.revokedAt === null);
		expect(live).toHaveLength(1);
	});
});
