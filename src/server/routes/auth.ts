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
import { Hono } from "hono";

import { loginInputSchema, signupInputSchema } from "../../lib/shared/schemas/auth";
import { getDB } from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { rateLimitMiddleware } from "../middleware/rate-limit";
import { clearAuthCookies, setAuthCookies, type AuthUser } from "../lib/auth-cookies";
import {
	createAuthService,
	DisposableEmailError,
	EmailAlreadyExistsError,
	InvalidCredentialsError,
} from "../services/auth-service";

type AuthVariables = { user: AuthUser };

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
