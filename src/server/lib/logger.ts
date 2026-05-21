// Logger estruturado. Emite JSON via console pra capturar em Workers Logs.
// Sem PII em texto plano (NFR25) é responsabilidade do caller — logger só serializa.
// Será expandido na Story 1.9 (Sentry integration para errors críticos).

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
	error: (payload: LogPayload) => emit("error", payload),
};
