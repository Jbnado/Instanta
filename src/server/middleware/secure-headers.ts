import type { MiddlewareHandler } from "hono";
import { NONCE, secureHeaders } from "hono/secure-headers";

// CSP env-aware: dev relaxa style-src pra Vite HMR (`<style>` inline).
// Prod/preview força style-src 'self'. Outras diretivas idênticas.
// Nonce per-request via NONCE sentinela (Hono substitui automaticamente).
//
// Se React `style={{ }}` quebrar em prod, adicionar `styleSrcAttr: ["'unsafe-inline'"]`
// como exceção granular (cobre style="" attr mas não <style> blocks).
export function secureHeadersMiddleware(): MiddlewareHandler<{ Bindings: Env }> {
	return async (c, next) => {
		// `Cloudflare.Env.ENVIRONMENT` é gerada por cf-typegen e só lista os valores
		// declarados em wrangler.jsonc ("production" + "preview"). Em dev local o
		// .dev.vars seta "development" — cast pra string evita o narrow do TS.
		const isDev = (c.env.ENVIRONMENT as string) === "development";
		const styleSrc = isDev ? ["'self'", "'unsafe-inline'"] : ["'self'"];

		const handler = secureHeaders({
			contentSecurityPolicy: {
				defaultSrc: ["'self'"],
				scriptSrc: ["'self'", NONCE],
				styleSrc,
				imgSrc: ["'self'", "https://imagedelivery.net", "data:"],
				fontSrc: ["'self'", "data:"],
				connectSrc: ["'self'"],
				frameAncestors: ["'none'"],
				baseUri: ["'self'"],
				formAction: ["'self'"],
			},
			xFrameOptions: "DENY",
			xContentTypeOptions: "nosniff",
			referrerPolicy: "strict-origin-when-cross-origin",
			permissionsPolicy: {
				geolocation: [],
				camera: ["self"],
				microphone: [],
				payment: [],
			},
			strictTransportSecurity:
				"max-age=31536000; includeSubDomains; preload",
		});
		return handler(c, next);
	};
}
