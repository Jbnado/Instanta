/**
 * Middleware de auth — Story 2.1.
 *
 * Lê o cookie `instanta_access` (JWT HS256), valida via authService.verifyAccessToken.
 * - Access válido → busca user por `sid`/`sub`, `c.set('user', user)`, segue.
 * - Access expirado/inválido → tenta `instanta_refresh` cookie → `rotateRefresh`
 *   single-use → seta novos cookies → `c.set('user', user)` → segue.
 * - Sem cookies ou falha fatal → 401 RFC 7807 (sem redirect; o front decide via router).
 *
 * NÃO é montado globalmente nesta story — só em rotas que precisarem (ex.: `/api/_auth-test`).
 * Stories futuras (Epics 3+) montam em rotas autenticadas reais.
 */
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

import { createAuthService, type AuthService } from "../services/auth-service";
import { getDB } from "../db/client";
import {
	clearAuthCookies,
	setAuthCookies,
	type AuthUser,
} from "../lib/auth-cookies";

// `c.get('user')` fica tipado nas rotas protegidas via este Variables.
// `sessionId` (sid do JWT, ou id da sessão recém-rotacionada) é exposto pras rotas
// de MFA (Story 2.7/2.8), que precisam marcar/consultar a sessão como MFA-satisfeita.
type AuthVariables = { user: AuthUser; sessionId: string };

function unauthorized(c: Parameters<MiddlewareHandler>[0]) {
	return c.json(
		{
			type: "https://instanta.jbnado.dev/errors/unauthorized",
			title: "Não autenticado",
			status: 401,
			detail: "Sessão ausente, expirada ou inválida.",
			instance: c.req.path,
		},
		401,
	);
}

export function authMiddleware(): MiddlewareHandler<{
	Bindings: Env;
	Variables: AuthVariables;
}> {
	return async (c, next) => {
		const db = getDB(c.env);
		const auth: AuthService = createAuthService({
			db,
			jwtSecret: c.env.AUTH_JWT_SECRET,
			adminEmail: c.env.ADMIN_EMAIL,
		});

		const accessToken = getCookie(c, "instanta_access");

		// 1. Tenta validar o access token (caminho rápido — sem I/O exceto fetch do user).
		if (accessToken) {
			try {
				const payload = await auth.verifyAccessToken(accessToken);
				const user = await auth.getUserById(payload.sub);
				if (user) {
					c.set("user", user);
					c.set("sessionId", payload.sid);
					return next();
				}
				// Token válido mas user sumiu (deletado) → trata como não autenticado.
				return unauthorized(c);
			} catch {
				// Expirado ou assinatura inválida → cai pro fluxo de refresh abaixo.
			}
		}

		// 2. Access ausente/expirado → tenta rotacionar via refresh single-use.
		const refreshToken = getCookie(c, "instanta_refresh");
		if (!refreshToken) {
			return unauthorized(c);
		}

		try {
			const rotated = await auth.rotateRefresh(refreshToken);
			setAuthCookies(c, {
				accessToken: rotated.accessToken,
				refreshToken: rotated.refreshToken,
			});
			c.set("user", rotated.user);
			c.set("sessionId", rotated.sessionId);
			return next();
		} catch {
			// Todos os modos de falha da rotação resultam em 401 + limpeza de cookies do
			// cliente (R-002, Story 2.6):
			// - SessionRevokedError: reuse/roubo real — o service já matou a família.
			// - ConcurrentRotationError: race benigno de 2 abas — a sessão nova do vencedor
			//   permanece viva; só ESTE request (o perdedor) falha e tem os cookies limpos.
			// - InactivityTimeoutError (NFR62) / SessionNotFoundError: sessão inválida.
			clearAuthCookies(c);
			return unauthorized(c);
		}
	};
}
