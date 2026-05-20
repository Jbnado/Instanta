import { Hono } from "hono";

import {
	assertOriginMiddleware,
	corsMiddleware,
	csrfMiddleware,
	secureHeadersMiddleware,
} from "./middleware";

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

export default app;
