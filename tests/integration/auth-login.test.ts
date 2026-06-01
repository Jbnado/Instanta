import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import app from "../../src/server/app";
import { getDB } from "../../src/server/db/client";
import { sessions, users } from "../../src/server/db/schema";

// Integration end-to-end do POST /api/auth/login dentro do workerd real.
// CSRF/assertOrigin exigem Origin allowlisted (localhost:5173). `cf-connecting-ip`
// controla o bucket de rate limit. O usuário é registrado via /api/auth/signup
// (mesmo pipeline real de hashing argon2id) antes de cada cenário de login.

const ORIGIN = "http://localhost:5173";

function signupRequest(
	body: Record<string, unknown>,
	ip = "10.1.0.1",
): Request {
	return new Request("http://localhost/api/auth/signup", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: ORIGIN,
			"cf-connecting-ip": ip,
		},
		body: JSON.stringify(body),
	});
}

function loginRequest(
	body: Record<string, unknown>,
	ip = "10.1.0.2",
): Request {
	return new Request("http://localhost/api/auth/login", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: ORIGIN,
			"cf-connecting-ip": ip,
		},
		body: JSON.stringify(body),
	});
}

async function registerUser(email: string, ip: string): Promise<void> {
	const res = await app.request(
		signupRequest(
			{ email, password: "senha123abc", displayName: "Tester", termsAccepted: true },
			ip,
		),
		{},
		env,
	);
	expect(res.status).toBe(201);
}

describe("POST /api/auth/login", () => {
	let db: ReturnType<typeof getDB>;

	beforeEach(() => {
		db = getDB(env);
	});

	it("AC-1: credenciais corretas → 200 + cookies httpOnly + nova session row", async () => {
		await registerUser("login1@example.com", "ip-signup-1");

		const res = await app.request(
			loginRequest({ email: "login1@example.com", password: "senha123abc" }, "ip-login-1"),
			{},
			env,
		);
		expect(res.status).toBe(200);

		const json = (await res.json()) as { user: { id: string; email: string } };
		expect(json.user.email).toBe("login1@example.com");
		expect(json.user.id).toBeTruthy();

		const setCookies =
			res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
		const joined = setCookies.join("\n");
		expect(joined).toMatch(/instanta_access=/);
		expect(joined).toMatch(/instanta_refresh=/);
		expect(joined).toMatch(/HttpOnly/i);
		expect(joined).toMatch(/SameSite=Lax/i);

		// Signup criou 1 sessão; login cria outra → 2 sessões pro mesmo user.
		const [userRow] = await db
			.select()
			.from(users)
			.where(eq(users.email, "login1@example.com"));
		const sessionRows = await db
			.select()
			.from(sessions)
			.where(eq(sessions.userId, userRow!.id));
		expect(sessionRows.length).toBeGreaterThanOrEqual(2);
	});

	it("AC-2: senha errada → 401 genérico INVALID_CREDENTIALS", async () => {
		await registerUser("login-wrong@example.com", "ip-signup-2");

		const res = await app.request(
			loginRequest(
				{ email: "login-wrong@example.com", password: "senha-errada" },
				"ip-login-2",
			),
			{},
			env,
		);
		expect(res.status).toBe(401);
		const json = (await res.json()) as { error: string };
		expect(json.error).toBe("INVALID_CREDENTIALS");
	});

	it("AC-3: email desconhecido → 401 com a MESMA resposta que senha errada (anti-enumeração)", async () => {
		const res = await app.request(
			loginRequest(
				{ email: "ghost@example.com", password: "qualquer-coisa" },
				"ip-login-3",
			),
			{},
			env,
		);
		expect(res.status).toBe(401);
		const json = (await res.json()) as { error: string };
		expect(json.error).toBe("INVALID_CREDENTIALS");
	});

	it("AC-4: rate limit → 6ª falha no mesmo IP retorna 429 com Retry-After", async () => {
		const ip = "ip-login-rl";
		// 5 falhas permitidas (limit: 5). Email desconhecido = falha rápida.
		for (let i = 0; i < 5; i++) {
			await app.request(
				loginRequest({ email: `rl${i}@example.com`, password: "x" }, ip),
				{},
				env,
			);
		}
		const res = await app.request(
			loginRequest({ email: "rl-blocked@example.com", password: "x" }, ip),
			{},
			env,
		);
		expect(res.status).toBe(429);
		expect(res.headers.get("Retry-After")).toBeTruthy();
	});

	it("AC-5: validação Zod → senha vazia retorna 400", async () => {
		const res = await app.request(
			loginRequest({ email: "zod@example.com", password: "" }, "ip-login-zod"),
			{},
			env,
		);
		expect(res.status).toBe(400);
	});
});
