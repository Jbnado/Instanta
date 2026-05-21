import { captureException, isSentryInitialized } from "./sentry";

// Logger estruturado. Emite JSON via console pra capturar em Workers Logs.
// `error()` opcionalmente integra com Sentry quando o wrapper inicializou (prod + DSN).
// Sem PII em texto plano (NFR25) é responsabilidade do caller — logger só serializa.

type LogPayload = Record<string, unknown> & { event: string };

function emit(level: "info" | "warn" | "error", payload: LogPayload): void {
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
};
