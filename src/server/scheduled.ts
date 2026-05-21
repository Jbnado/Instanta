import { logger } from "./lib/logger";

// Story 1.8 scaffold: cada handler é no-op com logging started/completed.
// Stories de feature (4.x photo pipeline, 1.12 D1 monitoring, etc.) substituem
// o no-op pela implementação real, mantendo a estrutura `scheduled.ts` única.

async function autoCleanD30(_env: Env, _ctx: ExecutionContext): Promise<void> {
	logger.info({ event: "cron.auto-clean-d30.started" });
	// TODO Story 4.x (photo pipeline): SELECT photos WHERE event.ended_at < now-30d
	// → CF Images delete + DELETE row; fail-secure se >50% falhar (NFR21/27).
	logger.info({ event: "cron.auto-clean-d30.completed" });
}

async function auditLogPurge(_env: Env, _ctx: ExecutionContext): Promise<void> {
	logger.info({ event: "cron.audit-log-purge.started" });
	// TODO Story moderation: DELETE audit_log WHERE created_at < now - 12 months (NFR46).
	logger.info({ event: "cron.audit-log-purge.completed" });
}

async function backupD1(_env: Env, _ctx: ExecutionContext): Promise<void> {
	logger.info({ event: "cron.backup-d1.started" });
	// TODO Story 1.12+: wrangler d1 export → R2 (NFR29 backup diário, retenção 7 dias).
	logger.info({ event: "cron.backup-d1.completed" });
}

async function alertMonitor(_env: Env, _ctx: ExecutionContext): Promise<void> {
	logger.info({ event: "cron.alert-monitor.started" });
	// TODO Story 1.12: spike detection auth failures + cap + D1 ≥7GB + auto-clean failures.
	logger.info({ event: "cron.alert-monitor.completed" });
}

const CRON_TO_HANDLER: Record<string, (env: Env, ctx: ExecutionContext) => Promise<void>> = {
	"0 3 * * *": autoCleanD30,
	"0 4 * * 0": auditLogPurge,
	"0 5 * * *": backupD1,
	"*/15 * * * *": alertMonitor,
};

export async function scheduled(
	controller: ScheduledController,
	env: Env,
	ctx: ExecutionContext,
): Promise<void> {
	const handler = CRON_TO_HANDLER[controller.cron];
	if (!handler) {
		logger.warn({
			event: "cron.unknown",
			cron: controller.cron,
			scheduledTime: controller.scheduledTime,
		});
		return;
	}
	await handler(env, ctx);
}
