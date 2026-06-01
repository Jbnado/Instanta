/**
 * Cookies de auth — Story 2.1.
 *
 * Centraliza nome, path, maxAge e flags dos cookies `instanta_access` e
 * `instanta_refresh` pra que rota (signup) e middleware (rotação) não divirjam.
 *
 * Flags: httpOnly + SameSite=Lax sempre; Secure só em produção (dev local em
 * `http://localhost:5173` não pode setar Secure ou o browser descarta o cookie).
 */
import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";

export type AuthUser = {
	id: string;
	email: string;
	displayName: string | null;
	role: "user" | "admin";
};

export const ACCESS_COOKIE = "instanta_access";
export const REFRESH_COOKIE = "instanta_refresh";

const ACCESS_MAX_AGE = 900; // 15min
const REFRESH_MAX_AGE = 2_592_000; // 30 dias
// Refresh restrito a /api/auth: reduz surface (só enviado nesse prefixo).
const REFRESH_PATH = "/api/auth";

// `Context` (sem generic) = Context<any> — aceita qualquer shape de Variables.
// Hono é invariante no env por causa de `c.set`/`c.get`, então tipar estreito
// (`Context<{ Bindings: Env }>`) recusa contextos que carregam Variables (middleware
// de auth, rota com zValidator). Helpers compartilhados usam o tipo largo.
function isProd(c: Context): boolean {
	return (c.env as Env).ENVIRONMENT === "production";
}

export function setAuthCookies(
	c: Context,
	tokens: { accessToken: string; refreshToken: string },
): void {
	const secure = isProd(c);
	setCookie(c, ACCESS_COOKIE, tokens.accessToken, {
		httpOnly: true,
		secure,
		sameSite: "Lax",
		path: "/",
		maxAge: ACCESS_MAX_AGE,
	});
	setCookie(c, REFRESH_COOKIE, tokens.refreshToken, {
		httpOnly: true,
		secure,
		sameSite: "Lax",
		path: REFRESH_PATH,
		maxAge: REFRESH_MAX_AGE,
	});
}

export function clearAuthCookies(c: Context): void {
	deleteCookie(c, ACCESS_COOKIE, { path: "/" });
	deleteCookie(c, REFRESH_COOKIE, { path: REFRESH_PATH });
}
