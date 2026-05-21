import { SELF } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { logger } from "../../src/server/lib/logger";
import { isSentryInitialized } from "../../src/server/lib/sentry";

// Em test env, ENVIRONMENT != "production" (herda do wrangler.jsonc, override
// pelo pool-workers seria preciso explicitar). SENTRY_DSN ausente. Sentry deve
// ficar como no-op — Worker funciona normalmente, logger.error não joga.
describe("sentry no-op em test env", () => {
	it("Worker responde 200 com Sentry wrapper em no-op", async () => {
		const res = await SELF.fetch("https://instanta.test/api/health");
		expect(res.status).toBe(200);
	});

	it("logger.error não joga e isSentryInitialized é false", () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(() => {
			logger.error({ event: "test.error" }, new Error("boom"));
		}).not.toThrow();
		expect(errSpy).toHaveBeenCalled();
		expect(isSentryInitialized()).toBe(false);
		errSpy.mockRestore();
	});
});
