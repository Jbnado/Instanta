import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

// Allowlist única compartilhada por cors, assertOrigin e csrf.
// CSV em `env.ALLOWED_ORIGINS` (CSV simples — sem dependência de secret manager).
export function getAllowedOrigins(env: { ALLOWED_ORIGINS?: string }): string[] {
	const raw = env.ALLOWED_ORIGINS?.trim();
	if (!raw) return ["http://localhost:5173"];
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

export function corsMiddleware(): MiddlewareHandler<{ Bindings: Env }> {
	return async (c, next) => {
		const allowlist = getAllowedOrigins(c.env);
		const handler = cors({
			origin: (origin) => (allowlist.includes(origin) ? origin : null),
			credentials: true,
			allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
			allowHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
			exposeHeaders: ["Content-Type"],
			maxAge: 86_400,
		});
		return handler(c, next);
	};
}

// Rejeita explicitamente requests mutáveis com Origin não-allowlisted antes
// do CSRF check — mensagem 403 RFC 7807 ajuda debug, vs hono/csrf que retorna
// 403 genérico só pelo cookie token. Same-origin (sem Origin header) passa.
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function assertOriginMiddleware(): MiddlewareHandler<{ Bindings: Env }> {
	return async (c, next) => {
		if (!MUTATION_METHODS.has(c.req.method)) return next();
		const origin = c.req.header("Origin");
		if (!origin) return next();
		const allowlist = getAllowedOrigins(c.env);
		if (allowlist.includes(origin)) return next();
		return c.json(
			{
				type: "https://instanta.jbnado.dev/errors/origin-not-allowed",
				title: "Origem não permitida",
				status: 403,
				detail: `Origin ${origin} não está na allowlist.`,
				instance: c.req.path,
			},
			403,
		);
	};
}
