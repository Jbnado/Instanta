import * as Sentry from "@sentry/cloudflare";

// Sentry só inicializa em produção com DSN presente. Em dev/preview/test,
// `withSentry` retorna o entry sem wrap — zero overhead.
//
// `Sentry.captureException` é resolvida lazy quando logger.error precisa;
// se o SDK não foi inicializado (dev), `Sentry.captureException` é no-op.

let initialized = false;

export function isSentryInitialized(): boolean {
	return initialized;
}

export function captureException(err: unknown, extra?: Record<string, unknown>): void {
	if (!initialized) return;
	try {
		Sentry.captureException(err, { extra });
	} catch {
		// Nunca propagar erro do Sentry ao caller.
	}
}

type Handler = ExportedHandler<Env>;

// Envelopa `entry` com Sentry quando env condições batem. Marcação `initialized`
// roda na primeira request — SDK SDK lê `env` em runtime.
export function withSentry<T extends Handler>(entry: T): T {
	return Sentry.withSentry(
		(env: Env) => {
			const dsn = env.SENTRY_DSN;
			const isProd = (env.ENVIRONMENT as string) === "production";
			if (!isProd || !dsn) {
				// Retornar opts vazias desativa init nesta request.
				// Marcamos initialized = false explicitamente pro logger.
				initialized = false;
				return { dsn: "" };
			}
			initialized = true;
			return {
				dsn,
				environment: env.ENVIRONMENT,
				release: env.CF_VERSION_METADATA?.id ?? "unknown",
				// 100% errors, 0 traces (free tier não comporta traces em MVP).
				sampleRate: 1,
				tracesSampleRate: 0,
			};
		},
		entry,
	) as T;
}
