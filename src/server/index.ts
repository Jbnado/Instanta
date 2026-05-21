import { Hono } from "hono";

import {
	assertOriginMiddleware,
	corsMiddleware,
	csrfMiddleware,
	rateLimitMiddleware,
	secureHeadersMiddleware,
} from "./middleware";

// Re-export do Durable Object pra o Wrangler enxergar a classe pelo entry.
export { RateLimiter } from "./durable-objects/rate-limiter";

const app = new Hono<{ Bindings: Env }>();

// Ordem do stack importa:
// 1. secure-headers — aplica CSP/HSTS/etc. em TODA response (inclusive errors).
// 2. cors — preflight + Origin matching (assets também passam pra ter ACAO se necessário).
// 3. assertOrigin — bloqueia mutations de Origin externa antes de chegar no CSRF.
// 4. csrf — só /api/* (double-submit cookie); HTML/CSS/JS servidos por Workers Assets passam direto.
app.use("*", secureHeadersMiddleware());
app.use("*", corsMiddleware());
app.use("/api/*", assertOriginMiddleware());
app.use("/api/*", csrfMiddleware());

app.get("/api/", (c) => c.json({ name: "Cloudflare" }));
app.get("/api/health", (c) => c.json({ status: "ok" }));

// Rotas de debug pro Rate Limiter — prefixo `_` indica diagnóstico interno.
// Mantidas em prod pra debugar sem rebuild (remover via story se virar surface ruim).
app.get(
	"/api/_rl-test",
	rateLimitMiddleware({
		bucket: "test",
		getKey: () => "fixed-key",
		limit: 3,
		window: 60,
	}),
	(c) => c.json({ ok: true }),
);

app.get(
	"/api/_rl-test-escalation",
	rateLimitMiddleware({
		bucket: "test-esc",
		getKey: () => "fixed-key",
		limit: 1,
		window: 5,
		escalation: [10, 30, 60],
	}),
	(c) => c.json({ ok: true }),
);

export default app;
