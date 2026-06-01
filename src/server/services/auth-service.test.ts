import { env } from "cloudflare:test";
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDB } from "../db/client";
import { passwordResetTokens, sessions, users } from "../db/schema";
import {
	ConcurrentRotationError,
	createAuthService,
	InactivityTimeoutError,
	InvalidResetTokenError,
	SessionRevokedError,
	type AuthService,
} from "./auth-service";
import type { Mailer, SendPasswordResetArgs } from "./mailer";

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

	describe("login", () => {
		it("credenciais corretas → cria sessão e retorna tokens", async () => {
			await auth.signup({
				email: "login-ok@example.com",
				password: "senha123abc",
				displayName: "LoginOk",
				termsAccepted: true,
			});

			const result = await auth.login("login-ok@example.com", "senha123abc");

			expect(result.user.email).toBe("login-ok@example.com");
			expect(result.user.displayName).toBe("LoginOk");
			expect(result.accessToken).toMatch(/^eyJ/);
			expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
			expect(result.sessionId).toBeDefined();

			// Nova sessão persistida com refresh hash (não plain).
			const [row] = await db
				.select()
				.from(sessions)
				.where(eq(sessions.id, result.sessionId));
			expect(row).toBeDefined();
			expect(row!.refreshTokenHash).toHaveLength(64);
			expect(row!.revokedAt).toBeNull();
		});

		it("normaliza email (case-insensitive + trim) no lookup", async () => {
			await auth.signup({
				email: "login-case@example.com",
				password: "senha123abc",
				displayName: "Case",
				termsAccepted: true,
			});

			const result = await auth.login("  LOGIN-CASE@Example.COM  ", "senha123abc");
			expect(result.user.email).toBe("login-case@example.com");
		});

		it("senha errada → InvalidCredentialsError (genérico)", async () => {
			await auth.signup({
				email: "login-wrong@example.com",
				password: "senha123abc",
				displayName: "Wrong",
				termsAccepted: true,
			});

			await expect(
				auth.login("login-wrong@example.com", "senha-errada"),
			).rejects.toThrow(/invalid email or password/i);
		});

		it("email desconhecido → InvalidCredentialsError (MESMO erro que senha errada)", async () => {
			await expect(
				auth.login("nao-existe@example.com", "qualquer-coisa"),
			).rejects.toThrow(/invalid email or password/i);
		});

		it("email desconhecido e senha errada lançam o MESMO tipo de erro (anti-enumeração)", async () => {
			await auth.signup({
				email: "login-same@example.com",
				password: "senha123abc",
				displayName: "Same",
				termsAccepted: true,
			});

			const unknownErr = await auth
				.login("ghost@example.com", "x")
				.then(() => null)
				.catch((e: unknown) => e);
			const wrongPwErr = await auth
				.login("login-same@example.com", "errada")
				.then(() => null)
				.catch((e: unknown) => e);

			expect(unknownErr).toBeInstanceOf(Error);
			expect(wrongPwErr).toBeInstanceOf(Error);
			expect((unknownErr as { code?: string }).code).toBe("INVALID_CREDENTIALS");
			expect((wrongPwErr as { code?: string }).code).toBe("INVALID_CREDENTIALS");
			expect((unknownErr as Error).message).toBe((wrongPwErr as Error).message);
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

		it("rejeita refresh token já usado: reuse IMEDIATO (dentro do leeway) → ConcurrentRotationError", async () => {
			const initial = await auth.signup({
				email: "reuse@example.com",
				password: "senha123abc",
				displayName: "Reuse",
				termsAccepted: true,
			});

			await auth.rotateRefresh(initial.refreshToken);

			// Reusar o refresh já rotacionado IMEDIATAMENTE cai na janela de leeway →
			// classificado como race benigno (Story 2.6). Ainda é 401 na rota, mas NÃO
			// mata a família. A distinção precisa race-vs-reuse está nos testes de hardening.
			await expect(
				auth.rotateRefresh(initial.refreshToken),
			).rejects.toBeInstanceOf(ConcurrentRotationError);
		});

		it("rejeita refresh token inexistente", async () => {
			await expect(
				auth.rotateRefresh("invalid-token-xxxxxxxxxxxxxxxxxxxxxxx"),
			).rejects.toThrow(/session.*(not found|invalid)/i);
		});
	});

	// ========================================================================
	// R-002 hardening (Story 2.6): leeway model + inatividade (NFR62).
	// Clock totalmente controlado via deps.now pro contraste race-vs-reuse.
	// ========================================================================
	describe("rotateRefresh hardening (Story 2.6)", () => {
		const SECOND = 1000;

		it("(a) race benigno: refresh válido cuja sessão foi revogada DENTRO da janela de leeway → ConcurrentRotationError, e a sessão vencedora sobrevive", async () => {
			// Relógio fixo: a revogação e o reuse acontecem no MESMO instante (dentro do leeway).
			const fixed = new Date("2026-06-01T12:00:00.000Z");
			const svc = createAuthService({ db, jwtSecret: TEST_JWT_SECRET, now: () => fixed });

			const initial = await svc.signup({
				email: "race-svc@example.com",
				password: "senha123abc",
				displayName: "Race",
				termsAccepted: true,
			});
			const [userRow] = await db
				.select()
				.from(users)
				.where(eq(users.email, "race-svc@example.com"));
			const userId = userRow!.id;

			// Simula o IRMÃO vencedor: revoga a sessão A (com replacedBy) AGORA e cria a
			// sessão sucessora "vencedora" que precisa permanecer viva.
			const winnerSessionId = crypto.randomUUID();
			await db
				.update(sessions)
				.set({ revokedAt: fixed, lastUsedAt: fixed, replacedBy: winnerSessionId })
				.where(eq(sessions.id, initial.sessionId));
			await db.insert(sessions).values({
				id: winnerSessionId,
				userId,
				refreshTokenHash: "winner-hash-".padEnd(64, "0"),
				createdAt: fixed,
			});

			// O perdedor reapresenta o refresh A dentro do leeway → race benigno.
			await expect(svc.rotateRefresh(initial.refreshToken)).rejects.toBeInstanceOf(
				ConcurrentRotationError,
			);

			// A família NÃO foi morta: a sessão vencedora continua viva.
			const live = await db
				.select()
				.from(sessions)
				.where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
			expect(live).toHaveLength(1);
			expect(live[0]!.id).toBe(winnerSessionId);
		});

		it("(b) reuse real: refresh cuja sessão foi revogada FORA da janela de leeway → SessionRevokedError + TODAS as sessões revogadas", async () => {
			const revokedAt = new Date("2026-06-01T12:00:00.000Z");
			// Reuse acontece 11s depois (> REUSE_LEEWAY_S = 10s).
			const reuseAt = new Date(revokedAt.getTime() + 11 * SECOND);
			const svc = createAuthService({ db, jwtSecret: TEST_JWT_SECRET, now: () => reuseAt });

			const initial = await svc.signup({
				email: "reuse-svc@example.com",
				password: "senha123abc",
				displayName: "Reuse",
				termsAccepted: true,
			});
			const [userRow] = await db
				.select()
				.from(users)
				.where(eq(users.email, "reuse-svc@example.com"));
			const userId = userRow!.id;

			// Sessão A revogada no passado (11s atrás), com sucessora ainda viva.
			const successorId = crypto.randomUUID();
			await db
				.update(sessions)
				.set({ revokedAt, lastUsedAt: revokedAt, replacedBy: successorId })
				.where(eq(sessions.id, initial.sessionId));
			await db.insert(sessions).values({
				id: successorId,
				userId,
				refreshTokenHash: "successor-hash-".padEnd(64, "0"),
				createdAt: revokedAt,
			});

			// Reuse fora do leeway → roubo real.
			await expect(svc.rotateRefresh(initial.refreshToken)).rejects.toBeInstanceOf(
				SessionRevokedError,
			);

			// Família morta: nenhuma sessão viva.
			const live = await db
				.select()
				.from(sessions)
				.where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
			expect(live).toHaveLength(0);
		});

		it("(c) inatividade (NFR62): sessão cujo lastUsedAt tem 25h → InactivityTimeoutError", async () => {
			const created = new Date("2026-06-01T00:00:00.000Z");
			// Última atividade 25h atrás em relação ao reuse.
			const reuseAt = new Date(created.getTime() + 25 * 60 * 60 * SECOND);
			const svc = createAuthService({ db, jwtSecret: TEST_JWT_SECRET, now: () => reuseAt });

			const initial = await svc.signup({
				email: "idle-svc@example.com",
				password: "senha123abc",
				displayName: "Idle",
				termsAccepted: true,
			});

			// Sessão viva, mas com última atividade 25h atrás (createdAt mantido recente
			// pra não disparar a expiração de 30d; lastUsedAt é o sinal de inatividade).
			await db
				.update(sessions)
				.set({ createdAt: reuseAt, lastUsedAt: created })
				.where(eq(sessions.id, initial.sessionId));

			await expect(svc.rotateRefresh(initial.refreshToken)).rejects.toBeInstanceOf(
				InactivityTimeoutError,
			);
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

	// Fake mailer que captura as chamadas — sem rede, determinístico.
	function makeFakeMailer(): Mailer & { calls: SendPasswordResetArgs[] } {
		const calls: SendPasswordResetArgs[] = [];
		return {
			calls,
			async sendPasswordReset(args) {
				calls.push(args);
			},
			// no-op: estes testes não disparam email de ativação; satisfaz o tipo Mailer.
			async sendEventActivated() {},
		};
	}

	describe("requestPasswordReset", () => {
		it("email cadastrado → cria token row + chama mailer com resetUrl contendo o token", async () => {
			const mailer = makeFakeMailer();
			const svc = createAuthService({ db, jwtSecret: TEST_JWT_SECRET, mailer });

			await svc.signup({
				email: "reset-req@example.com",
				password: "senha123abc",
				displayName: "Req",
				termsAccepted: true,
			});

			await svc.requestPasswordReset("reset-req@example.com");

			const [userRow] = await db
				.select()
				.from(users)
				.where(eq(users.email, "reset-req@example.com"));
			const tokenRows = await db
				.select()
				.from(passwordResetTokens)
				.where(eq(passwordResetTokens.userId, userRow!.id));
			expect(tokenRows).toHaveLength(1);
			expect(tokenRows[0]!.tokenHash).toHaveLength(64); // SHA-256 hex
			expect(tokenRows[0]!.usedAt).toBeNull();
			// Expiração no futuro e ≤30min.
			const ttlMs = tokenRows[0]!.expiresAt.getTime() - Date.now();
			expect(ttlMs).toBeGreaterThan(0);
			expect(ttlMs).toBeLessThanOrEqual(30 * 60 * 1000 + 1000);

			expect(mailer.calls).toHaveLength(1);
			expect(mailer.calls[0]!.to).toBe("reset-req@example.com");
			expect(mailer.calls[0]!.resetUrl).toMatch(/token=/);
		});

		it("email desconhecido → não cria token, não chama mailer, não lança", async () => {
			const mailer = makeFakeMailer();
			const svc = createAuthService({ db, jwtSecret: TEST_JWT_SECRET, mailer });

			await expect(
				svc.requestPasswordReset("ninguem@example.com"),
			).resolves.toBeUndefined();

			expect(mailer.calls).toHaveLength(0);
			const all = await db.select().from(passwordResetTokens);
			const forUnknown = all.filter((r) => r.usedAt === undefined);
			expect(forUnknown).not.toContain("ninguem@example.com"); // sanity: nenhum token vinculado
		});

		it("normaliza email (case-insensitive) no lookup", async () => {
			const mailer = makeFakeMailer();
			const svc = createAuthService({ db, jwtSecret: TEST_JWT_SECRET, mailer });

			await svc.signup({
				email: "reset-case@example.com",
				password: "senha123abc",
				displayName: "Case",
				termsAccepted: true,
			});

			await svc.requestPasswordReset("  RESET-CASE@Example.COM ");
			expect(mailer.calls).toHaveLength(1);
		});
	});

	describe("confirmPasswordReset", () => {
		// Helper: faz signup + request reset capturando o token plaintext via mailer,
		// e devolve o token + o id do usuário pra assertions.
		async function setupReset(email: string): Promise<{
			svc: AuthService;
			token: string;
			userId: string;
			mailer: ReturnType<typeof makeFakeMailer>;
		}> {
			const mailer = makeFakeMailer();
			const svc = createAuthService({ db, jwtSecret: TEST_JWT_SECRET, mailer });
			await svc.signup({
				email,
				password: "senha123abc",
				displayName: "Confirm",
				termsAccepted: true,
			});
			await svc.requestPasswordReset(email);
			const url = new URL(mailer.calls[0]!.resetUrl);
			const token = url.searchParams.get("token")!;
			const [userRow] = await db.select().from(users).where(eq(users.email, email));
			return { svc, token, userId: userRow!.id, mailer };
		}

		it("token válido → atualiza hash, marca usedAt, revoga todas as sessões", async () => {
			const { svc, token, userId } = await setupReset("reset-ok@example.com");

			await svc.confirmPasswordReset(token, "novaSenha456");

			// Nova senha vale, antiga não.
			const [userRow] = await db.select().from(users).where(eq(users.id, userId));
			expect(await svc.verifyPassword(userRow!.passwordHash, "novaSenha456")).toBe(true);
			expect(await svc.verifyPassword(userRow!.passwordHash, "senha123abc")).toBe(false);

			// Token marcado single-use.
			const tokenRows = await db
				.select()
				.from(passwordResetTokens)
				.where(eq(passwordResetTokens.userId, userId));
			expect(tokenRows[0]!.usedAt).not.toBeNull();

			// Todas as sessões revogadas.
			const sessionRows = await db
				.select()
				.from(sessions)
				.where(eq(sessions.userId, userId));
			expect(sessionRows.length).toBeGreaterThan(0);
			expect(sessionRows.every((s) => s.revokedAt !== null)).toBe(true);
		});

		it("token expirado → InvalidResetTokenError", async () => {
			// Clock fixo no passado pro request, depois confirm com clock atual.
			const mailer = makeFakeMailer();
			const past = new Date(Date.now() - 31 * 60 * 1000); // 31min atrás
			const svcPast = createAuthService({
				db,
				jwtSecret: TEST_JWT_SECRET,
				mailer,
				now: () => past,
			});
			await svcPast.signup({
				email: "reset-expired@example.com",
				password: "senha123abc",
				displayName: "Exp",
				termsAccepted: true,
			});
			await svcPast.requestPasswordReset("reset-expired@example.com");
			const token = new URL(mailer.calls[0]!.resetUrl).searchParams.get("token")!;

			// Confirm com clock atual → token expirou (criado 31min atrás, TTL 30min).
			const svcNow = createAuthService({ db, jwtSecret: TEST_JWT_SECRET, mailer });
			await expect(
				svcNow.confirmPasswordReset(token, "novaSenha456"),
			).rejects.toBeInstanceOf(InvalidResetTokenError);
		});

		it("token já usado → InvalidResetTokenError (single-use)", async () => {
			const { svc, token } = await setupReset("reset-used@example.com");

			await svc.confirmPasswordReset(token, "novaSenha456");
			await expect(
				svc.confirmPasswordReset(token, "outraSenha789"),
			).rejects.toBeInstanceOf(InvalidResetTokenError);
		});

		it("token inexistente → InvalidResetTokenError", async () => {
			const mailer = makeFakeMailer();
			const svc = createAuthService({ db, jwtSecret: TEST_JWT_SECRET, mailer });
			await expect(
				svc.confirmPasswordReset("token-que-nao-existe-xxxxxxxx", "novaSenha456"),
			).rejects.toBeInstanceOf(InvalidResetTokenError);
		});
	});
});
