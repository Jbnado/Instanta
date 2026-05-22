import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { trackEvent } from "../../src/server/lib/analytics";
import { logger } from "../../src/server/lib/logger";

describe("analytics + logger.event", () => {
	it("logger.event emite JSON com level=event", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		logger.event("photo.uploaded", { eventId: "evt-1", durationMs: 1234 });
		const line = spy.mock.calls[0]?.[0] as string;
		expect(line).toBeTruthy();
		const parsed = JSON.parse(line);
		expect(parsed.level).toBe("event");
		expect(parsed.event).toBe("photo.uploaded");
		expect(parsed.eventId).toBe("evt-1");
		expect(parsed.durationMs).toBe(1234);
		spy.mockRestore();
	});

	it("trackEvent com binding presente não joga", () => {
		expect(env.ANALYTICS).toBeTruthy();
		const result = trackEvent(env, {
			name: "test.event",
			doubles: [42],
			blobs: ["test-blob"],
		});
		expect(result.error).toBeUndefined();
		expect(result.skipped).toBeUndefined();
	});

	it("trackEvent sem binding (env override) retorna skipped", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		// Override env.ANALYTICS via cast — não persiste fora do test.
		const envWithoutAnalytics = { ...env, ANALYTICS: undefined } as unknown as Env;
		const result = trackEvent(envWithoutAnalytics, { name: "test.event" });
		expect(result.skipped).toBe(true);
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});
