import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { scheduled } from "../../src/server/scheduled";

function makeController(cron: string): ScheduledController {
	return { cron, scheduledTime: Date.now(), noRetry: () => {} };
}
function makeCtx(): ExecutionContext {
	return { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as ExecutionContext;
}

describe("d1-monitor cron (Story 1.12 / B-001)", () => {
	it("scheduled completa sem throw mesmo quando D1 bloqueia PRAGMA", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		await expect(
			scheduled(makeController("0 6 * * 1"), env, makeCtx()),
		).resolves.toBeUndefined();

		const logs = logSpy.mock.calls.map((c) => c[0] as string);
		const warns = warnSpy.mock.calls.map((c) => c[0] as string);

		// `started` e `completed` sempre rodam.
		expect(logs.some((l) => l.includes("cron.d1-monitor.started"))).toBe(true);
		expect(logs.some((l) => l.includes("cron.d1-monitor.completed"))).toBe(true);

		// D1 em test env (workerd) bloqueia PRAGMA → pragma-blocked warn aparece.
		// Quando CF habilitar PRAGMA em runtime, este expect deve ser invertido
		// (size aparece em vez de pragma-blocked).
		expect(warns.some((l) => l.includes("cron.d1-monitor.pragma-blocked"))).toBe(true);
		expect(warns.every((l) => !l.includes("threshold-exceeded"))).toBe(true);

		logSpy.mockRestore();
		warnSpy.mockRestore();
	});

	it("sem RESEND_API_KEY, alerta é skipped (apenas warn log)", async () => {
		expect(env.RESEND_API_KEY).toBeFalsy();
		await expect(
			scheduled(makeController("0 6 * * 1"), env, makeCtx()),
		).resolves.toBeUndefined();
	});
});
