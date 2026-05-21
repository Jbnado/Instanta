import type { Context, MiddlewareHandler } from "hono";

interface RateLimitOptions {
	bucket: string;
	getKey: (c: Context<{ Bindings: Env }>) => string;
	limit: number;
	window: number; // seconds
	escalation?: number[]; // seconds; cresce a cada violação se presente
}

interface CheckResult {
	allowed: boolean;
	retryAfter: number;
	count: number;
}

// Consome a classe RateLimiter via fetch RPC ao DO. idFromName garante 1 DO
// por (bucket, key) — estado isolado, escalability natural.
export function rateLimitMiddleware(
	opts: RateLimitOptions,
): MiddlewareHandler<{ Bindings: Env }> {
	return async (c, next) => {
		// `RATE_LIMITER` é opcional na tipagem (env.preview não declara DO bindings).
		// Em rotas reais, ausência é erro de config — explicita aqui pra debug fácil.
		if (!c.env.RATE_LIMITER) {
			throw new Error(
				"Binding `RATE_LIMITER` ausente neste env (provavelmente preview). Rate limit não pode ser aplicado.",
			);
		}
		const key = opts.getKey(c);
		const id = c.env.RATE_LIMITER.idFromName(`${opts.bucket}:${key}`);
		const stub = c.env.RATE_LIMITER.get(id);

		const res = await stub.fetch("https://rate-limiter/check", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				bucket: opts.bucket,
				key,
				limit: opts.limit,
				window: opts.window,
				escalation: opts.escalation,
			}),
		});
		const data = (await res.json()) as CheckResult;

		if (!data.allowed) {
			return c.json(
				{
					type: "https://instanta.jbnado.dev/errors/rate-limit-exceeded",
					title: "Limite de requisições atingido",
					status: 429,
					detail: `Bucket "${opts.bucket}" excedido. Tente novamente em ${data.retryAfter} segundos.`,
					instance: c.req.path,
					retryAfter: data.retryAfter,
				},
				429,
				{ "Retry-After": data.retryAfter.toString() },
			);
		}

		return next();
	};
}
