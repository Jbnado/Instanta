import type { MiddlewareHandler } from "hono";
import { csrf } from "hono/csrf";

import { getAllowedOrigins } from "./cors";

// Double-submit cookie pattern via hono/csrf. Aplica só em /api/* (assets HTML/CSS/JS
// servidos por Workers Assets não passam por aqui). Allowlist herdada de cors.ts
// pra evitar drift entre as 2 listas.
export function csrfMiddleware(): MiddlewareHandler<{ Bindings: Env }> {
	return async (c, next) => {
		const allowlist = getAllowedOrigins(c.env);
		const handler = csrf({ origin: allowlist });
		return handler(c, next);
	};
}
