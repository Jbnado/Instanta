import { getDB } from "./db/client";
import { sendAdminAlert } from "./lib/email";
import { logger } from "./lib/logger";
import { createEventService } from "./services/event-service";

// Story 1.8 scaffold: cada handler é no-op com logging started/completed.
// Story 1.12 implementou d1Monitor (real). Demais stories de feature
// (4.x photo pipeline, moderation, backup) substituem o no-op no devido tempo.

const D1_ALERT_THRESHOLD_BYTES = 7 * 1024 * 1024 * 1024; // 7 GB — 70% do hard cap 10 GB.

async function autoCleanD30(env: Env, _ctx: ExecutionContext): Promise<void> {
	logger.info({ event: "cron.auto-clean-d30.started" });

	// Story 3.5 (FR15): auto-encerra eventos cuja data já passou e ainda estão Ativo.
	// Roda no cron diário (`0 3 * * *`) — idempotente (só toca status Ativo). Precede
	// o auto-clean de fotos pq o D+30 conta a partir de ended_at, que esta passada seta.
	if (env.DB) {
		const service = createEventService({ db: getDB(env) });
		const closed = await service.autoCloseExpiredEvents();
		logger.info({ event: "cron.auto-clean-d30.events-closed", count: closed });
	} else {
		logger.warn({ event: "cron.auto-clean-d30.skipped.no-db" });
	}

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
	// TODO Story dedicada: wrangler d1 export → R2 (NFR29 backup diário, retenção 7 dias).
	logger.info({ event: "cron.backup-d1.completed" });
}

async function alertMonitor(_env: Env, _ctx: ExecutionContext): Promise<void> {
	logger.info({ event: "cron.alert-monitor.started" });
	// TODO Stories futuras: spike detection auth failures + cap + auto-clean failures.
	// D1 size foi pro d1-monitor (semanal); aqui ficam métricas 15min.
	logger.info({ event: "cron.alert-monitor.completed" });
}

// Story 1.12 (B-001): check semanal de tamanho D1 via SQLite pragmas. Se >=7 GB,
// envia email admin via Resend pra avaliar migração pra Neon+Hyperdrive
// (veja docs/adr/0003-d1-vs-neon.md + runbook § D1 GB monitoring).
async function d1Monitor(env: Env, _ctx: ExecutionContext): Promise<void> {
	logger.info({ event: "cron.d1-monitor.started" });
	if (!env.DB) {
		logger.warn({ event: "cron.d1-monitor.skipped.no-db" });
		return;
	}
	// D1 runtime bloqueia PRAGMA (SQLITE_AUTH). Tentamos mesmo assim — se um dia
	// CF habilitar, alerta passa a funcionar nativamente. Catch silencia, e
	// log warn aponta pra runbook (Bernardo pode trocar pra CF REST API com token).
	let bytes = 0;
	try {
		const pageCount = await env.DB.prepare("PRAGMA page_count").first<{ page_count: number }>();
		const pageSize = await env.DB.prepare("PRAGMA page_size").first<{ page_size: number }>();
		bytes = (pageCount?.page_count ?? 0) * (pageSize?.page_size ?? 0);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		logger.warn({
			event: "cron.d1-monitor.pragma-blocked",
			error: msg,
			hint: "D1 runtime bloqueia PRAGMA. Use CF REST API + CF_API_TOKEN (runbook § D1 GB monitoring) quando virar dor.",
		});
		logger.info({ event: "cron.d1-monitor.completed" });
		return;
	}

	const gb = bytes / (1024 * 1024 * 1024);
	logger.info({ event: "cron.d1-monitor.size", bytes, gb: Number(gb.toFixed(3)) });

	if (bytes >= D1_ALERT_THRESHOLD_BYTES) {
		const subject = `[Instanta] D1 ≥ 7 GB (${gb.toFixed(2)} GB)`;
		const body = [
			`D1 atingiu ${gb.toFixed(2)} GB de uso (threshold 7 GB / hard cap 10 GB).`,
			"",
			"Opções de ação documentadas em docs/runbook.md § D1 GB monitoring:",
			"  1. Acelerar auto-clean D+30 (reduzir janela ou rodar manualmente).",
			"  2. Migrar audit_log primeiro pra Neon (hot table específica).",
			"  3. Migrar TUDO pra Neon+Hyperdrive (ADR 0003).",
			"",
			"Threshold rodado semanalmente (cron `0 6 * * 1`).",
		].join("\n");
		logger.warn({ event: "cron.d1-monitor.threshold-exceeded", bytes, gb });
		await sendAdminAlert(env, { subject, body });
	}
	logger.info({ event: "cron.d1-monitor.completed" });
}

const CRON_TO_HANDLER: Record<string, (env: Env, ctx: ExecutionContext) => Promise<void>> = {
	"0 3 * * *": autoCleanD30,
	"0 4 * * 7": auditLogPurge, // domingo; CF cron usa 1-7 (domingo=7), não 0
	"0 5 * * *": backupD1,
	"0 6 * * 1": d1Monitor,
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
