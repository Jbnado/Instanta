import { logger } from "./logger";

// Wrapper Cloudflare Workers Analytics Engine. Resiliente: sem binding (preview,
// test sem analytics_engine_datasets, env mal-configurada), faz no-op + warn.
//
// Convenção (CF limits):
//   - `indexes`: 1 string queryable (default: usa o `name`).
//   - `doubles`: até 20 números (latência, contagem, bytes).
//   - `blobs`: até 20 strings, max 5120 bytes total (event_id, user_id hashado).
//
// **NFR25**: NUNCA passar email/senha/conteúdo de foto em texto plano como blob.
// Caller hasha (sha256.slice(0, 16)) IDs sensíveis antes de chamar.

interface TrackEventInput {
	name: string;
	indexes?: string[];
	doubles?: number[];
	blobs?: string[];
}

interface TrackEventResult {
	skipped?: boolean;
	error?: string;
}

export function trackEvent(env: Env, input: TrackEventInput): TrackEventResult {
	if (!env.ANALYTICS) {
		logger.warn({ event: "analytics.skipped.no-binding", name: input.name });
		return { skipped: true };
	}
	try {
		env.ANALYTICS.writeDataPoint({
			indexes: input.indexes ?? [input.name],
			doubles: input.doubles ?? [],
			blobs: input.blobs ?? [],
		});
		return {};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		logger.error({ event: "analytics.failed", name: input.name, err: msg });
		return { error: msg };
	}
}
