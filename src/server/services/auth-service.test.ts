import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDB } from "../db/client";
import { sessions, users } from "../db/schema";
import { createAuthService, type AuthService } from "./auth-service";

const TEST_JWT_SECRET = "test-secret-aaaa-bbbb-cccc-dddd-eeee-ffff-32-bytes";

describe("auth-service", () => {
	let auth: AuthService;
	let db: ReturnType<typeof getDB>;

	beforeEach(() => {
		db = getDB(env);
		auth = createAuthService({ db, jwtSecret: TEST_JWT_SECRET });
	});

	describe("hashPassword + verifyPassword (argon2id)", () => {
		it("hashes em formato argon2id encoded", async () => {
			const hash = await auth.hashPassword("senha123abc");
			expect(hash).toMatch(/^\$argon2id\$/);
		});

		it("verify retorna true pra senha correta", async () => {
			const hash = await auth.hashPassword("senha123abc");
			expect(await auth.verifyPassword(hash, "senha123abc")).toBe(true);
		});

		it("verify retorna false pra senha errada", async () => {
			const hash = await auth.hashPassword("senha123abc");
			expect(await auth.verifyPassword(hash, "senha-errada")).toBe(false);
		});

		it("hashes diferentes pra mesma senha (salt random)", async () => {
			const h1 = await auth.hashPassword("senha123abc");
			const h2 = await auth.hashPassword("senha123abc");
			expect(h1).not.toBe(h2);
		});
	});

	describe("signup", () => {
		it("cria user + sessão e retorna tokens", async () => {
			const result = await auth.signup({
				email: "alice@example.com",
				password: "senha123abc",
				displayName: "Alice",
				termsAccepted: true,
			});

			expect(result.user.id).toBeDefined();
			expect(result.user.email).toBe("alice@example.com");
			expect(result.user.displayName).toBe("Alice");
			expect(result.accessToken).toMatch(/^eyJ/); // JWT começa com header base64
			expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]{40,}$/); // base64url 32B = 43 chars
			expect(result.sessionId).toBeDefined();
		});

		it("persiste argon2id hash e terms_accepted_at no DB", async () => {
			await auth.signup({
				email: "bob@example.com",
				password: "senha123abc",
				displayName: "Bob",
				termsAccepted: true,
			});

			const [row] = await db
				.select()
				.from(users)
				.where(eq(users.email, "bob@example.com"));

			expect(row).toBeDefined();
			expect(row!.passwordHash).toMatch(/^\$argon2id\$/);
			expect(row!.termsAcceptedAt).toBeInstanceOf(Date);
			expect(row!.displayName).toBe("Bob");
		});

		it("persiste session com refresh_token_hash (não plain)", async () => {
			const result = await auth.signup({
				email: "carol@example.com",
				password: "senha123abc",
				displayName: "Carol",
				termsAccepted: true,
			});

			const [row] = await db
				.select()
				.from(sessions)
				.where(eq(sessions.id, result.sessionId));

			expect(row).toBeDefined();
			expect(row!.refreshTokenHash).not.toBe(result.refreshToken); // hashed!
			expect(row!.refreshTokenHash).toHaveLength(64); // SHA-256 hex = 64 chars
			expect(row!.revokedAt).toBeNull();
		});

		it("normaliza email para lowercase + trim", async () => {
			await auth.signup({
				email: "  ALICE-CASE@Example.COM  ",
				password: "senha123abc",
				displayName: "Alice",
				termsAccepted: true,
			});

			const [row] = await db
				.select()
				.from(users)
				.where(eq(users.email, "alice-case@example.com"));

			expect(row).toBeDefined();
		});

		it("rejeita email descartável com erro tipado DisposableEmailError", async () => {
			await expect(
				auth.signup({
					email: "spam@mailinator.com",
					password: "senha123abc",
					displayName: "Spam",
					termsAccepted: true,
				}),
			).rejects.toThrow(/disposable/i);
		});

		it("rejeita email já cadastrado com erro EmailAlreadyExistsError", async () => {
			await auth.signup({
				email: "dup@example.com",
				password: "senha123abc",
				displayName: "Dup",
				termsAccepted: true,
			});

			await expect(
				auth.signup({
					email: "dup@example.com",
					password: "senha-outra",
					displayName: "Outro",
					termsAccepted: true,
				}),
			).rejects.toThrow(/already exists/i);
		});

		it("dedup é case-insensitive", async () => {
			await auth.signup({
				email: "case@example.com",
				password: "senha123abc",
				displayName: "Case",
				termsAccepted: true,
			});

			await expect(
				auth.signup({
					email: "CASE@Example.COM",
					password: "senha-outra",
					displayName: "Outro",
					termsAccepted: true,
				}),
			).rejects.toThrow(/already exists/i);
		});
	});

	describe("rotateRefresh", () => {
		it("rotaciona single-use: novo par de tokens + sessão antiga revogada", async () => {
			const initial = await auth.signup({
				email: "rot@example.com",
				password: "senha123abc",
				displayName: "Rot",
				termsAccepted: true,
			});

			const rotated = await auth.rotateRefresh(initial.refreshToken);

			expect(rotated.accessToken).toBeDefined();
			expect(rotated.refreshToken).not.toBe(initial.refreshToken);
			expect(rotated.sessionId).not.toBe(initial.sessionId);

			const [oldSession] = await db
				.select()
				.from(sessions)
				.where(eq(sessions.id, initial.sessionId));
			expect(oldSession!.revokedAt).not.toBeNull();
		});

		it("rejeita refresh token já usado (reuse detection)", async () => {
			const initial = await auth.signup({
				email: "reuse@example.com",
				password: "senha123abc",
				displayName: "Reuse",
				termsAccepted: true,
			});

			await auth.rotateRefresh(initial.refreshToken);

			// tentar reusar o refresh já rotacionado.
			await expect(
				auth.rotateRefresh(initial.refreshToken),
			).rejects.toThrow(/session.*(revoked|invalid)/i);
		});

		it("rejeita refresh token inexistente", async () => {
			await expect(
				auth.rotateRefresh("invalid-token-xxxxxxxxxxxxxxxxxxxxxxx"),
			).rejects.toThrow(/session.*(not found|invalid)/i);
		});
	});

	describe("verifyAccessToken", () => {
		it("decoda JWT válido e retorna payload", async () => {
			const result = await auth.signup({
				email: "jwt@example.com",
				password: "senha123abc",
				displayName: "JWT",
				termsAccepted: true,
			});

			const payload = await auth.verifyAccessToken(result.accessToken);

			expect(payload.sub).toBe(result.user.id);
			expect(payload.sid).toBe(result.sessionId);
			expect(payload.role).toBe("user");
		});

		it("rejeita JWT com assinatura inválida", async () => {
			const result = await auth.signup({
				email: "bad@example.com",
				password: "senha123abc",
				displayName: "Bad",
				termsAccepted: true,
			});

			// muta o último char (assinatura).
			const tampered = result.accessToken.slice(0, -1) + "X";
			await expect(auth.verifyAccessToken(tampered)).rejects.toThrow();
		});
	});
});
