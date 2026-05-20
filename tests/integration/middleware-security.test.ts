import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// Garante que os bindings de teste injetados pelo pool-workers refletem o
// env do worker — `ENVIRONMENT` vem do wrangler.jsonc (vars), `ALLOWED_ORIGINS`
// idem. Esses 5 testes cobrem os ACs da Story 1.6.
const ORIGIN_ALLOWED = "https://instanta.jbnado.dev";
const ORIGIN_EVIL = "https://evil.example";

describe("security middleware", () => {
	it("adiciona todos os headers de segurança em GET /api/health", async () => {
		const res = await SELF.fetch(`https://${env.ALLOWED_ORIGINS!.split(",")[0]?.replace("https://", "")}/api/health`);
		expect(res.status).toBe(200);

		const csp = res.headers.get("content-security-policy");
		expect(csp).toBeTruthy();
		expect(csp).toContain("default-src 'self'");
		expect(csp).toContain("frame-ancestors 'none'");
		expect(csp).toMatch(/'nonce-[A-Za-z0-9+/=_-]+'/);

		expect(res.headers.get("x-frame-options")).toBe("DENY");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		expect(res.headers.get("referrer-policy")).toBe(
			"strict-origin-when-cross-origin",
		);
		expect(res.headers.get("permissions-policy")).toContain("camera=(self)");
		expect(res.headers.get("strict-transport-security")).toContain(
			"max-age=31536000",
		);
		expect(res.headers.get("strict-transport-security")).toContain("preload");
	});

	it("gera nonce diferente em cada request", async () => {
		const [r1, r2] = await Promise.all([
			SELF.fetch("https://instanta.test/api/health"),
			SELF.fetch("https://instanta.test/api/health"),
		]);
		const noncePattern = /'nonce-([A-Za-z0-9+/=_-]+)'/;
		const m1 = r1.headers.get("content-security-policy")?.match(noncePattern);
		const m2 = r2.headers.get("content-security-policy")?.match(noncePattern);
		expect(m1?.[1]).toBeTruthy();
		expect(m2?.[1]).toBeTruthy();
		expect(m1?.[1]).not.toBe(m2?.[1]);
	});

	it("em ENVIRONMENT != development, CSP style-src não tem 'unsafe-inline'", async () => {
		// vitest.workers.config.ts não seta ENVIRONMENT=development, então env
		// herda do wrangler.jsonc (production).
		const res = await SELF.fetch("https://instanta.test/api/health");
		const csp = res.headers.get("content-security-policy") ?? "";
		// Extrai a diretiva style-src
		const styleSrc = csp.split(";").find((d) => d.trim().startsWith("style-src"));
		expect(styleSrc).toBeTruthy();
		expect(styleSrc).not.toContain("unsafe-inline");
	});

	it("CORS responde Access-Control-Allow-Origin pra Origin allowlisted", async () => {
		const res = await SELF.fetch("https://instanta.test/api/health", {
			method: "OPTIONS",
			headers: {
				Origin: ORIGIN_ALLOWED,
				"Access-Control-Request-Method": "GET",
			},
		});
		expect(res.headers.get("access-control-allow-origin")).toBe(
			ORIGIN_ALLOWED,
		);
		expect(res.headers.get("access-control-allow-credentials")).toBe("true");
	});

	it("rejeita POST de Origin não-allowlisted com 403", async () => {
		const res = await SELF.fetch("https://instanta.test/api/health", {
			method: "POST",
			headers: { Origin: ORIGIN_EVIL, "Content-Type": "application/json" },
			body: "{}",
		});
		expect(res.status).toBe(403);
		const body = (await res.json()) as { type: string };
		expect(body.type).toContain("origin-not-allowed");
	});

	it("CSRF: POST de form sem Origin é rejeitado com 403 (hono/csrf)", async () => {
		// hono/csrf cobre **form submissions** (Content-Type x-www-form-urlencoded /
		// multipart / text/plain) sem Origin/sec-fetch-site válido. Mutations JSON
		// são cobertas pelo assertOriginMiddleware + SameSite cookies (NFR11, story
		// futura de auth). Veja Design Notes da Story 1.6 pra ratio.
		const res = await SELF.fetch("https://instanta.test/api/health", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: "foo=bar",
		});
		expect(res.status).toBe(403);
	});
});
