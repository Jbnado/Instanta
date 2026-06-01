/**
 * Rotas de auth — Story 2.1.
 *
 * `POST /signup` (montado em `/api/auth/signup`): rate limit 3/hora/IP + validação
 * Zod + chamada ao auth-service + set de cookies httpOnly. Microcopy humana PT-BR
 * (UX-DR20) pra email duplicado/descartável. Jitter anti-enumeração em todas as branches.
 *
 * `GET /_auth-test` (montado em `/api/auth/_auth-test`): rota protegida de diagnóstico
 * usada pelos testes de rotação de refresh (AC-7). Devolve `c.get('user')`.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";

import {
	loginInputSchema,
	mfaCodeSchema,
	resetConfirmSchema,
	resetRequestSchema,
	signupInputSchema,
} from "../../lib/shared/schemas/auth";
import { getDB } from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { rateLimitMiddleware } from "../middleware/rate-limit";
import { clearAuthCookies, setAuthCookies, type AuthUser } from "../lib/auth-cookies";
import { getAllowedOrigins } from "../middleware/cors";
import { createMailer } from "../services/mailer";
import {
	createAuthService,
	DisposableEmailError,
	EmailAlreadyExistsError,
	InvalidCredentialsError,
	InvalidResetTokenError,
} from "../services/auth-service";
import {
	createMfaService,
	InvalidMfaCodeError,
	MfaNotConfiguredError,
	MfaReplayError,
} from "../services/mfa-service";

type AuthVariables = { user: AuthUser; sessionId: string };

// Jitter 50–250ms em TODAS as branches do signup pra mascarar o delta de timing
// entre hash+insert (~150ms) e lookup+return (~5ms) — anti-enumeração (FR65/UX-DR).
function randomInt(min: number, max: number): number {
	const buf = new Uint32Array(1);
	crypto.getRandomValues(buf);
	return min + (buf[0]! % (max - min + 1));
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function jitter(): Promise<void> {
	await sleep(randomInt(50, 250));
}

export const authRoutes = new Hono<{
	Bindings: Env;
	Variables: AuthVariables;
}>();

authRoutes.post(
	"/signup",
	rateLimitMiddleware({
		bucket: "signup",
		getKey: (c) =>
			c.req.header("cf-connecting-ip") ??
			c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
			"unknown",
		limit: 3,
		window: 3600,
	}),
	zValidator("json", signupInputSchema),
	async (c) => {
		const input = c.req.valid("json");
		const db = getDB(c.env);
		const auth = createAuthService({
			db,
			jwtSecret: c.env.AUTH_JWT_SECRET,
			adminEmail: c.env.ADMIN_EMAIL,
		});

		try {
			const result = await auth.signup({
				email: input.email,
				password: input.password,
				displayName: input.displayName,
				termsAccepted: input.termsAccepted,
			});

			setAuthCookies(c, {
				accessToken: result.accessToken,
				refreshToken: result.refreshToken,
			});

			await jitter();
			return c.json(
				{
					user: {
						id: result.user.id,
						email: result.user.email,
						displayName: result.user.displayName,
					},
				},
				201,
			);
		} catch (err) {
			// Microcopy humana (UX-DR20): vence segurança estrita aqui pelo trade-off de
			// fricção; NFR56 (descartável) + rate limit (NFR13) mitigam abuse massivo.
			if (err instanceof EmailAlreadyExistsError) {
				await jitter();
				return c.json({ error: "EMAIL_EXISTS" }, 200);
			}
			if (err instanceof DisposableEmailError) {
				await jitter();
				return c.json({ error: "DISPOSABLE_EMAIL" }, 200);
			}
			throw err;
		}
	},
);

// ============================================================================
// POST /login — Story 2.2.
// ============================================================================
// Rate limit 5/15min/IP com escalation progressiva 15min → 1h → 24h (NFR13);
// valores em SEGUNDOS (a DO converte pra ms). Erro genérico anti-enumeração:
// mesma resposta 401 INVALID_CREDENTIALS pra email desconhecido E senha errada.
// Jitter mascara o delta de timing entre "user existe + verifyPassword (~244ms)"
// e "user não existe (~5ms)".
authRoutes.post(
	"/login",
	rateLimitMiddleware({
		bucket: "login",
		getKey: (c) =>
			c.req.header("cf-connecting-ip") ??
			c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
			"unknown",
		limit: 5,
		window: 900, // 15min
		escalation: [900, 3600, 86_400], // 15min → 1h → 24h
	}),
	zValidator("json", loginInputSchema),
	async (c) => {
		const input = c.req.valid("json");
		const db = getDB(c.env);
		const auth = createAuthService({
			db,
			jwtSecret: c.env.AUTH_JWT_SECRET,
			adminEmail: c.env.ADMIN_EMAIL,
		});

		try {
			const result = await auth.login(input.email, input.password);

			setAuthCookies(c, {
				accessToken: result.accessToken,
				refreshToken: result.refreshToken,
			});

			await jitter();
			return c.json(
				{
					user: {
						id: result.user.id,
						email: result.user.email,
						displayName: result.user.displayName,
					},
				},
				200,
			);
		} catch (err) {
			if (err instanceof InvalidCredentialsError) {
				await jitter();
				return c.json({ error: "INVALID_CREDENTIALS" }, 401);
			}
			throw err;
		}
	},
);

// ============================================================================
// POST /reset — Story 2.4 (solicitar reset).
// ============================================================================
// Anti-enumeração ESTRITA (FR65): resposta 200 idêntica pra email cadastrado e não.
// Rate limit 3/hora por EMAIL (NFR13) — getKey async lê o body (Hono cacheia o
// JSON parseado, então o zValidator downstream ainda consegue lê-lo). Jitter em
// TODAS as branches pra timing constante (defesa contra timing attack).
authRoutes.post(
	"/reset",
	rateLimitMiddleware({
		bucket: "reset",
		getKey: async (c) => {
			const body = (await c.req.json().catch(() => ({}))) as { email?: unknown };
			return typeof body.email === "string" ? body.email.trim().toLowerCase() : "unknown";
		},
		limit: 3,
		window: 3600,
	}),
	zValidator("json", resetRequestSchema),
	async (c) => {
		const input = c.req.valid("json");
		const db = getDB(c.env);
		const auth = createAuthService({
			db,
			jwtSecret: c.env.AUTH_JWT_SECRET,
			adminEmail: c.env.ADMIN_EMAIL,
			mailer: createMailer(c.env),
			appBaseUrl: getAllowedOrigins(c.env)[0],
		});

		await auth.requestPasswordReset(input.email);

		// Jitter mascara o delta entre branch "user existe" (token + email) e "não existe".
		await jitter();
		return c.json(
			{
				message:
					"Se este email estiver cadastrado, você receberá um link em até 5 minutos.",
			},
			200,
		);
	},
);

// ============================================================================
// POST /reset-confirm — Story 2.5 (confirmar reset).
// ============================================================================
// Token válido + nova senha → atualiza hash, single-use, revoga todas as sessões.
// Token inválido/expirado/usado → 400 INVALID_RESET_TOKEN ("link expirado ou inválido").
// Limpa cookies de auth por garantia (sessões já foram revogadas no service).
authRoutes.post(
	"/reset-confirm",
	zValidator("json", resetConfirmSchema),
	async (c) => {
		const input = c.req.valid("json");
		const db = getDB(c.env);
		const auth = createAuthService({
			db,
			jwtSecret: c.env.AUTH_JWT_SECRET,
			adminEmail: c.env.ADMIN_EMAIL,
			mailer: createMailer(c.env),
		});

		try {
			await auth.confirmPasswordReset(input.token, input.password);
			clearAuthCookies(c);
			return c.json({ ok: true }, 200);
		} catch (err) {
			if (err instanceof InvalidResetTokenError) {
				return c.json({ error: "INVALID_RESET_TOKEN" }, 400);
			}
			throw err;
		}
	},
);

// ============================================================================
// POST /logout — Story 2.3.
// ============================================================================
// Autenticado (authMiddleware seta c.get('user')). Revoga TODAS as sessões
// ativas do usuário (multi-device kill — NFR62) e limpa os cookies do cliente.
authRoutes.post("/logout", authMiddleware(), async (c) => {
	const db = getDB(c.env);
	const auth = createAuthService({
		db,
		jwtSecret: c.env.AUTH_JWT_SECRET,
		adminEmail: c.env.ADMIN_EMAIL,
	});

	await auth.logoutAllForUser(c.get("user").id);
	clearAuthCookies(c);

	return c.json({ ok: true }, 200);
});

// Rota protegida de diagnóstico (AC-7). Devolve o usuário autenticado pelo
// authMiddleware (access válido ou rotação de refresh).
authRoutes.get("/_auth-test", authMiddleware(), (c) => {
	return c.json({ user: c.get("user") });
});

// ============================================================================
// GET /me — Story 2.7. Usuário autenticado corrente (front hidrata sessão).
// ============================================================================
authRoutes.get("/me", authMiddleware(), (c) => {
	return c.json({ user: c.get("user") });
});

// ============================================================================
// MFA TOTP (Stories 2.7 setup / 2.8 verify + replay protection).
// ============================================================================
// Guard admin-only: setup/confirm/verify só pra role admin → 403 caso contrário.
// status e /me não exigem admin (qualquer autenticado consulta o próprio estado).
function requireAdmin(
	c: Context<{ Bindings: Env; Variables: AuthVariables }>,
): Response | null {
	if (c.get("user").role !== "admin") {
		return c.json(
			{
				type: "https://instanta.jbnado.dev/errors/forbidden",
				title: "Acesso negado",
				status: 403,
				detail: "Apenas administradores configuram MFA.",
				instance: c.req.path,
			},
			403,
		);
	}
	return null;
}

// GET /mfa/status — { configured, verified } pra sessão atual (qualquer autenticado).
authRoutes.get("/mfa/status", authMiddleware(), async (c) => {
	const mfa = createMfaService({
		db: getDB(c.env),
		encryptionKey: c.env.MFA_ENCRYPTION_KEY,
	});
	const status = await mfa.getStatus(c.get("user").id, c.get("sessionId"));
	return c.json(status, 200);
});

// POST /mfa/setup — admin: gera secret TOTP + URI otpauth pro QR. Pendente até confirmar.
authRoutes.post("/mfa/setup", authMiddleware(), async (c) => {
	const denied = requireAdmin(c);
	if (denied) return denied;

	const user = c.get("user");
	const mfa = createMfaService({
		db: getDB(c.env),
		encryptionKey: c.env.MFA_ENCRYPTION_KEY,
	});
	// Label da conta no app authenticator = email do admin.
	const result = await mfa.beginSetup(user.id, user.email);
	return c.json({ otpauthUri: result.otpauthUri, secret: result.secret }, 200);
});

// POST /mfa/confirm — admin: confirma o setup com o 1º código → recovery codes (uma vez).
authRoutes.post(
	"/mfa/confirm",
	authMiddleware(),
	zValidator("json", mfaCodeSchema),
	async (c) => {
		const denied = requireAdmin(c);
		if (denied) return denied;

		const mfa = createMfaService({
			db: getDB(c.env),
			encryptionKey: c.env.MFA_ENCRYPTION_KEY,
		});
		try {
			const { recoveryCodes } = await mfa.confirmSetup(
				c.get("user").id,
				c.req.valid("json").code,
			);
			return c.json({ recoveryCodes }, 200);
		} catch (err) {
			if (err instanceof InvalidMfaCodeError || err instanceof MfaNotConfiguredError) {
				return c.json({ error: "MFA_INVALID_CODE" }, 400);
			}
			throw err;
		}
	},
);

// POST /mfa/verify — admin: valida o 2º fator no login. Replay → MFA_REPLAY.
authRoutes.post(
	"/mfa/verify",
	authMiddleware(),
	zValidator("json", mfaCodeSchema),
	async (c) => {
		const denied = requireAdmin(c);
		if (denied) return denied;

		const mfa = createMfaService({
			db: getDB(c.env),
			encryptionKey: c.env.MFA_ENCRYPTION_KEY,
		});
		try {
			await mfa.verify(c.get("user").id, c.req.valid("json").code, c.get("sessionId"));
			return c.json({ ok: true }, 200);
		} catch (err) {
			if (err instanceof MfaReplayError) {
				return c.json({ error: "MFA_REPLAY" }, 400);
			}
			if (err instanceof InvalidMfaCodeError || err instanceof MfaNotConfiguredError) {
				return c.json({ error: "MFA_INVALID_CODE" }, 400);
			}
			throw err;
		}
	},
);
