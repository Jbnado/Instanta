import { captureException, isSentryInitialized } from "./sentry";

// Logger estruturado. Emite JSON via console pra capturar em Workers Logs.
// `error()` opcionalmente integra com Sentry quando o wrapper inicializou (prod + DSN).
// `event()` é semantically distinto: eventos de domínio (NFR25 + FR74), separados
// de níveis técnicos (info/warn/error).
//
// Sem PII em texto plano (NFR25) é responsabilidade do caller — logger só serializa.

type LogPayload = Record<string, unknown> & { event: string };
type Level = "info" | "warn" | "error" | "event";

function emit(level: Level, payload: LogPayload): void {
	const line = JSON.stringify({ level, ts: new Date().toISOString(), ...payload });
	if (level === "error") console.error(line);
	else if (level === "warn") console.warn(line);
	else console.log(line);
}

export const logger = {
	info: (payload: LogPayload) => emit("info", payload),
	warn: (payload: LogPayload) => emit("warn", payload),
	error: (payload: LogPayload, err?: Error) => {
		emit("error", payload);
		if (isSentryInitialized()) {
			captureException(err ?? new Error(payload.event), payload);
		}
	},
	// Eventos de domínio (business). Distintos de info/warn/error (técnicos).
	// Stories de feature consomem: `logger.event("photo.uploaded", { eventId, durationMs })`.
	event: (name: string, payload?: Record<string, unknown>) =>
		emit("event", { event: name, ...(payload ?? {}) }),
};
