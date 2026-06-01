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

import { signupInputSchema } from "../../lib/shared/schemas/auth";
import { getDB } from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { rateLimitMiddleware } from "../middleware/rate-limit";
import { setAuthCookies, type AuthUser } from "../lib/auth-cookies";
import {
	createAuthService,
	DisposableEmailError,
	EmailAlreadyExistsError,
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

// Rota protegida de diagnóstico (AC-7). Devolve o usuário autenticado pelo
// authMiddleware (access válido ou rotação de refresh).
authRoutes.get("/_auth-test", authMiddleware(), (c) => {
	return c.json({ user: c.get("user") });
});
