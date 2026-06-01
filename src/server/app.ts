import { Hono } from "hono";

import {
	assertOriginMiddleware,
	corsMiddleware,
	csrfMiddleware,
	rateLimitMiddleware,
	secureHeadersMiddleware,
} from "./middleware";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { eventRoutes } from "./routes/events";
import { photoRoutes } from "./routes/photos";

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

// Auth (Story 2.1): signup + rota protegida de diagnóstico. Montado antes das
// rotas de debug. Middleware `auth.ts` NÃO é global — só onde a rota pede.
app.route("/api/auth", authRoutes);

// Events (Story 3.1): criar evento. authMiddleware + rate limit por usuário aplicados
// dentro do módulo de rota (não global).
app.route("/api/events", eventRoutes);

// Photos (Epic 6, Stories 6.5-6.7): upload-url + confirm. Montado no MESMO prefixo
// `/api/events` → paths /api/events/:slug/upload-url e /api/events/:slug/photos.
// authMiddleware + rate limit aplicados dentro do módulo de rota (não global).
app.route("/api/events", photoRoutes);

// Admin (Story 3.4): fila de ativação + ativar evento. authMiddleware + guard admin
// aplicados dentro do módulo de rota (não global).
app.route("/api/admin", adminRoutes);

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
