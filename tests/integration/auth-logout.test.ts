import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import app from "../../src/server/app";
import { getDB } from "../../src/server/db/client";
import { sessions, users } from "../../src/server/db/schema";

// Integration end-to-end do POST /api/auth/logout dentro do workerd real.
// Logout exige usuário autenticado (authMiddleware lê o cookie instanta_access)
// e revoga TODAS as sessões ativas do user (multi-device, NFR62) + limpa cookies.

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

function logoutRequest(jar: Record<string, string>): Request {
	return new Request("http://localhost/api/auth/logout", {
		method: "POST",
		headers: {
			origin: ORIGIN,
			"content-type": "application/json",
			cookie: cookieHeader(jar),
		},
	});
}

describe("POST /api/auth/logout", () => {
	let db: ReturnType<typeof getDB>;

	beforeEach(() => {
		db = getDB(env);
	});

	it("autenticado → 200, revoga TODAS as sessões do user e limpa cookies", async () => {
		// Signup cria sessão #1 + cookies.
		const signup = await app.request(signupRequest("logout1@example.com"), {}, env);
		expect(signup.status).toBe(201);
		const jar = readCookies(signup);
		expect(jar.instanta_access).toBeTruthy();

		const [userRow] = await db
			.select()
			.from(users)
			.where(eq(users.email, "logout1@example.com"));

		// Cria sessão #2 manualmente pro mesmo user (simula 2º dispositivo).
		await db.insert(sessions).values({
			id: crypto.randomUUID(),
			userId: userRow!.id,
			refreshTokenHash: "a".repeat(64),
			createdAt: new Date(),
		});

		const before = await db
			.select()
			.from(sessions)
			.where(eq(sessions.userId, userRow!.id));
		expect(before.length).toBeGreaterThanOrEqual(2);

		// Logout com o cookie de access.
		const res = await app.request(logoutRequest(jar), {}, env);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { ok: boolean };
		expect(json.ok).toBe(true);

		// TODAS as sessões do user agora revogadas (multi-device kill).
		const after = await db
			.select()
			.from(sessions)
			.where(eq(sessions.userId, userRow!.id));
		expect(after.length).toBeGreaterThanOrEqual(2);
		expect(after.every((s) => s.revokedAt !== null)).toBe(true);

		// Cookies limpos: Set-Cookie com expiração no passado / Max-Age=0.
		const setCookies =
			res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
		const joined = setCookies.join("\n");
		expect(joined).toMatch(/instanta_access=/);
		expect(joined).toMatch(/instanta_refresh=/);
		expect(joined).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
	});

	it("sem sessão (sem cookie) → 401", async () => {
		const res = await app.request(logoutRequest({}), {}, env);
		expect(res.status).toBe(401);
	});
});
