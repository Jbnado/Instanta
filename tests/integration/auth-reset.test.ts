import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import app from "../../src/server/app";
import { getDB } from "../../src/server/db/client";
import { passwordResetTokens, sessions, users } from "../../src/server/db/schema";
import { createAuthService } from "../../src/server/services/auth-service";
import type { Mailer, SendPasswordResetArgs } from "../../src/server/services/mailer";

// Integration do fluxo de reset (Stories 2.4/2.5) no workerd real.
// Request (POST /reset) e invalid-token (POST /reset-confirm) rodam via HTTP.
// O caminho confirm que depende de um token usável roda no nível de service:
// o plaintext do token não é recuperável do hash no DB, então capturamos via um
// mailer fake injetado no createAuthService (mesmo db `env`).
const ORIGIN = "http://localhost:5173";
const TEST_JWT_SECRET = "test-secret-aaaa-bbbb-cccc-dddd-eeee-ffff-32-bytes";

function resetRequest(body: Record<string, unknown>): Request {
	return new Request("http://localhost/api/auth/reset", {
		method: "POST",
		headers: { "content-type": "application/json", origin: ORIGIN },
		body: JSON.stringify(body),
	});
}

function confirmRequest(body: Record<string, unknown>): Request {
	return new Request("http://localhost/api/auth/reset-confirm", {
		method: "POST",
		headers: { "content-type": "application/json", origin: ORIGIN },
		body: JSON.stringify(body),
	});
}

function signupRequest(body: Record<string, unknown>, ip: string): Request {
	return new Request("http://localhost/api/auth/signup", {
		method: "POST",
		headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": ip },
		body: JSON.stringify(body),
	});
}

function makeFakeMailer(): Mailer & { calls: SendPasswordResetArgs[] } {
	const calls: SendPasswordResetArgs[] = [];
	return {
		calls,
		async sendPasswordReset(args) {
			calls.push(args);
		},
	};
}

describe("POST /api/auth/reset (Story 2.4)", () => {
	let db: ReturnType<typeof getDB>;

	beforeEach(() => {
		db = getDB(env);
	});

	it("AC: resposta 200 + body idêntico pra email cadastrado e não-cadastrado (anti-enum)", async () => {
		// Registra um usuário.
		await app.request(
			signupRequest(
				{
					email: "reset-known@example.com",
					password: "senha123abc",
					displayName: "Known",
					termsAccepted: true,
				},
				"ip-reset-1",
			),
			{},
			env,
		);

		const resKnown = await app.request(resetRequest({ email: "reset-known@example.com" }), {}, env);
		const resUnknown = await app.request(
			resetRequest({ email: "reset-unknown@example.com" }),
			{},
			env,
		);

		expect(resKnown.status).toBe(200);
		expect(resUnknown.status).toBe(200);
		const bodyKnown = await resKnown.json();
		const bodyUnknown = await resUnknown.json();
		expect(bodyKnown).toEqual(bodyUnknown);
		expect((bodyKnown as { message: string }).message).toBe(
			"Se este email estiver cadastrado, você receberá um link em até 5 minutos.",
		);

		// Email cadastrado gerou token row; o desconhecido não.
		const [userRow] = await db.select().from(users).where(eq(users.email, "reset-known@example.com"));
		const tokens = await db
			.select()
			.from(passwordResetTokens)
			.where(eq(passwordResetTokens.userId, userRow!.id));
		expect(tokens.length).toBeGreaterThanOrEqual(1);
	});

	it("AC: rate limit 3/hora por email → 4ª tentativa no mesmo email retorna 429", async () => {
		const email = "reset-rl@example.com";
		for (let i = 0; i < 3; i++) {
			await app.request(resetRequest({ email }), {}, env);
		}
		const res = await app.request(resetRequest({ email }), {}, env);
		expect(res.status).toBe(429);
		expect(res.headers.get("Retry-After")).toBeTruthy();
	});
});

describe("POST /api/auth/reset-confirm (Story 2.5)", () => {
	let db: ReturnType<typeof getDB>;

	beforeEach(() => {
		db = getDB(env);
	});

	it("AC: fluxo completo — signup, request, confirm → senha atualizada + sessões revogadas", async () => {
		// signup via HTTP.
		await app.request(
			signupRequest(
				{
					email: "reset-flow@example.com",
					password: "senha123abc",
					displayName: "Flow",
					termsAccepted: true,
				},
				"ip-flow",
			),
			{},
			env,
		);

		// request reset via service (mailer fake captura o token plaintext).
		const mailer = makeFakeMailer();
		const auth = createAuthService({ db, jwtSecret: TEST_JWT_SECRET, mailer });
		await auth.requestPasswordReset("reset-flow@example.com");
		const token = new URL(mailer.calls[0]!.resetUrl).searchParams.get("token")!;

		// confirm via HTTP.
		const res = await app.request(
			confirmRequest({ token, password: "novaSenha456" }),
			{},
			env,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });

		const [userRow] = await db.select().from(users).where(eq(users.email, "reset-flow@example.com"));
		expect(await auth.verifyPassword(userRow!.passwordHash, "novaSenha456")).toBe(true);

		const sessionRows = await db.select().from(sessions).where(eq(sessions.userId, userRow!.id));
		expect(sessionRows.every((s) => s.revokedAt !== null)).toBe(true);
	});

	it("AC: token inválido via HTTP → 400 INVALID_RESET_TOKEN", async () => {
		const res = await app.request(
			confirmRequest({ token: "token-invalido-xxxxxxxxxxxx", password: "novaSenha456" }),
			{},
			env,
		);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "INVALID_RESET_TOKEN" });
	});
});
