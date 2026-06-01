import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import app from "../../src/server/app";
import { getDB } from "../../src/server/db/client";
import { sessions, users } from "../../src/server/db/schema";

// Integration end-to-end do POST /api/auth/signup dentro do workerd real.
// CSRF/assertOrigin exigem Origin allowlisted (localhost:5173 — incluso no
// ALLOWED_ORIGINS de teste em vitest.workers.config.ts). `cf-connecting-ip`
// controla o bucket de rate limit. Hashing argon2id via argon2-wasm-edge
// (.wasm importado como módulo ES; ~244ms/hash no workerd).

const ORIGIN = "http://localhost:5173";

function signupRequest(
	body: Record<string, unknown>,
	ip = "10.0.0.1",
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

const validPayload = {
	email: "alice@example.com",
	password: "senha123abc",
	displayName: "Alice",
	termsAccepted: true,
};

describe("POST /api/auth/signup", () => {
	let db: ReturnType<typeof getDB>;

	beforeEach(() => {
		db = getDB(env);
	});

	it("AC-1: happy path → 201 + cookies httpOnly + rows no DB", async () => {
		const res = await app.request(signupRequest(validPayload, "ip-ac1"), {}, env);
		expect(res.status).toBe(201);

		const json = (await res.json()) as { user: { id: string; email: string; displayName: string } };
		expect(json.user.email).toBe("alice@example.com");
		expect(json.user.displayName).toBe("Alice");
		expect(json.user.id).toBeTruthy();

		// Set-Cookie: ambos os cookies, httpOnly + SameSite=Lax (sem Secure em dev).
		const setCookies = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
		const joined = setCookies.join("\n");
		expect(joined).toMatch(/instanta_access=/);
		expect(joined).toMatch(/instanta_refresh=/);
		expect(joined).toMatch(/HttpOnly/i);
		expect(joined).toMatch(/SameSite=Lax/i);

		// DB: 1 user com argon2id hash + terms_accepted_at; 1 session com refresh hash.
		const [userRow] = await db.select().from(users).where(eq(users.email, "alice@example.com"));
		expect(userRow).toBeDefined();
		expect(userRow!.passwordHash).toMatch(/^\$argon2id\$/);
		expect(userRow!.termsAcceptedAt).toBeInstanceOf(Date);

		const sessionRows = await db.select().from(sessions).where(eq(sessions.userId, userRow!.id));
		expect(sessionRows).toHaveLength(1);
		expect(sessionRows[0]!.refreshTokenHash).toHaveLength(64); // SHA-256 hex, não plain
	});

	it("AC-2: email descartável → 200 com error DISPOSABLE_EMAIL, sem criar conta", async () => {
		const res = await app.request(
			signupRequest({ ...validPayload, email: "spam@mailinator.com" }, "ip-ac2"),
			{},
			env,
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { error: string };
		expect(json.error).toBe("DISPOSABLE_EMAIL");

		const rows = await db.select().from(users).where(eq(users.email, "spam@mailinator.com"));
		expect(rows).toHaveLength(0);
	});

	it("AC-3: rate limit → 4ª tentativa no mesmo IP retorna 429 com Retry-After", async () => {
		const ip = "10.0.0.99";
		// 3 tentativas permitidas (emails distintos pra não bater dedup).
		for (let i = 0; i < 3; i++) {
			await app.request(
				signupRequest({ ...validPayload, email: `rl${i}@example.com` }, ip),
				{},
				env,
			);
		}
		const res = await app.request(
			signupRequest({ ...validPayload, email: "rl-blocked@example.com" }, ip),
			{},
			env,
		);
		expect(res.status).toBe(429);
		expect(res.headers.get("Retry-After")).toBeTruthy();
	});

	it("AC-4: email já cadastrado → 200 com error EMAIL_EXISTS (microcopy humana)", async () => {
		await app.request(
			signupRequest({ ...validPayload, email: "dup@example.com" }, "ip-ac4"),
			{},
			env,
		);
		const res = await app.request(
			signupRequest({ ...validPayload, email: "dup@example.com", displayName: "Outro" }, "ip-ac4"),
			{},
			env,
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { error: string };
		expect(json.error).toBe("EMAIL_EXISTS");

		// Só 1 conta — a 2ª não criou nada.
		const rows = await db.select().from(users).where(eq(users.email, "dup@example.com"));
		expect(rows).toHaveLength(1);
	});

	describe("AC-5: validação Zod → 400", () => {
		it("sem displayName → 400", async () => {
			const { displayName: _omit, ...noName } = validPayload;
			const res = await app.request(
				signupRequest({ ...noName, email: "zod1@example.com" }, "ip-zod1"),
				{},
				env,
			);
			expect(res.status).toBe(400);
		});

		it("senha muito curta → 400", async () => {
			const res = await app.request(
				signupRequest({ ...validPayload, email: "zod2@example.com", password: "ab1" }, "ip-zod2"),
				{},
				env,
			);
			expect(res.status).toBe(400);
		});

		it("termsAccepted: false → 400", async () => {
			const res = await app.request(
				signupRequest(
					{ ...validPayload, email: "zod3@example.com", termsAccepted: false },
					"ip-zod3",
				),
				{},
				env,
			);
			expect(res.status).toBe(400);
		});
	});

	it("AC-6: dedup case-insensitive (Alice@Gmail.com vs alice@gmail.com)", async () => {
		await app.request(
			signupRequest({ ...validPayload, email: "Alice@Gmail.com" }, "ip-ac6"),
			{},
			env,
		);
		const res = await app.request(
			signupRequest({ ...validPayload, email: "alice@gmail.com", displayName: "Outra" }, "ip-ac6"),
			{},
			env,
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { error: string };
		expect(json.error).toBe("EMAIL_EXISTS");
	});
});
