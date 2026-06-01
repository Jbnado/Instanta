import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { scheduled } from "../../src/server/scheduled";

// `ScheduledController` é a interface real do Workers; build mock mínimo.
function makeController(cron: string): ScheduledController {
	return {
		cron,
		scheduledTime: Date.now(),
		noRetry: () => {},
	};
}

// `ExecutionContext` precisa só de waitUntil/passThroughOnException; mock.
function makeCtx(): ExecutionContext {
	return {
		waitUntil: () => {},
		passThroughOnException: () => {},
		props: {},
	} as ExecutionContext;
}

describe("scheduled", () => {
	it("auto-clean-d30 (0 3 * * *) completa sem erro", async () => {
		await expect(
			scheduled(makeController("0 3 * * *"), env, makeCtx()),
		).resolves.toBeUndefined();
	});

	it("audit-log-purge (0 4 * * 7) completa sem erro", async () => {
		await expect(
			scheduled(makeController("0 4 * * 7"), env, makeCtx()),
		).resolves.toBeUndefined();
	});

	it("backup-d1 (0 5 * * *) completa sem erro", async () => {
		await expect(
			scheduled(makeController("0 5 * * *"), env, makeCtx()),
		).resolves.toBeUndefined();
	});

	it("alert-monitor (*/15 * * * *) completa sem erro", async () => {
		await expect(
			scheduled(makeController("*/15 * * * *"), env, makeCtx()),
		).resolves.toBeUndefined();
	});

	it("cron desconhecido emite warn e não joga", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		await expect(
			scheduled(makeController("0 6 * * *"), env, makeCtx()),
		).resolves.toBeUndefined();
		expect(warnSpy).toHaveBeenCalled();
		const logLine = warnSpy.mock.calls[0]?.[0];
		expect(typeof logLine).toBe("string");
		expect(logLine).toContain("cron.unknown");
		warnSpy.mockRestore();
	});

	it("handler started/completed emite logs estruturados", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await scheduled(makeController("0 3 * * *"), env, makeCtx());
		const logs = logSpy.mock.calls.map((c) => c[0] as string);
		expect(logs.some((l) => l.includes("cron.auto-clean-d30.started"))).toBe(true);
		expect(logs.some((l) => l.includes("cron.auto-clean-d30.completed"))).toBe(true);
		logSpy.mockRestore();
	});
});
