import { DurableObject } from "cloudflare:workers";

// 1 DO instance por (bucket, key) — idFromName(`${bucket}:${key}`).
// State em SQLite (1 linha em `state`). Janela fixa: reset quando
// now - window_start >= window. Suporta bloqueio progressivo via `escalation`.
//
// API: POST /check com body JSON { bucket, key, limit, window, escalation? }
//       → { allowed, retryAfter, count }

interface CheckBody {
	bucket: string;
	key: string;
	limit: number;
	window: number;
	escalation?: number[];
}

interface CheckResult {
	allowed: boolean;
	retryAfter: number;
	count: number;
}

export class RateLimiter extends DurableObject<Env> {
	private initialized = false;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	private init() {
		if (this.initialized) return;
		this.ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS state (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				window_start INTEGER NOT NULL DEFAULT 0,
				count INTEGER NOT NULL DEFAULT 0,
				blocked_until INTEGER NOT NULL DEFAULT 0,
				escalation_level INTEGER NOT NULL DEFAULT 0
			)`,
		);
		this.ctx.storage.sql.exec(
			"INSERT OR IGNORE INTO state (id, window_start, count, blocked_until, escalation_level) VALUES (1, 0, 0, 0, 0)",
		);
		this.initialized = true;
	}

	private check(body: CheckBody): CheckResult {
		this.init();
		const now = Date.now();
		const windowMs = body.window * 1000;

		const row = this.ctx.storage.sql
			.exec<{
				window_start: number;
				count: number;
				blocked_until: number;
				escalation_level: number;
			}>("SELECT window_start, count, blocked_until, escalation_level FROM state WHERE id = 1")
			.one();

		// Já bloqueado?
		if (row.blocked_until > now) {
			return {
				allowed: false,
				retryAfter: Math.ceil((row.blocked_until - now) / 1000),
				count: row.count,
			};
		}

		// Window expirou — reset counter. Escalation level cai apenas se passamos
		// 2x do último período de bloqueio sem violação (cooldown).
		let windowStart = row.window_start;
		let count = row.count;
		let escalationLevel = row.escalation_level;

		if (now - windowStart >= windowMs) {
			// Cooldown da escalation: se passou tempo suficiente desde o último
			// blocked_until, decai o level. blocked_until 0 quando nunca bloqueado.
			if (body.escalation && row.blocked_until > 0) {
				const lastBlockStep = body.escalation[Math.max(0, escalationLevel - 1)] ?? 0;
				if (now - row.blocked_until >= lastBlockStep * 1000 * 2) {
					escalationLevel = 0;
				}
			}
			windowStart = now;
			count = 0;
		}

		count += 1;

		if (count > body.limit) {
			// Excedeu: bloqueia. Com escalation, usa step atual e avança o nível.
			let blockMs: number;
			if (body.escalation && body.escalation.length > 0) {
				const step = body.escalation[Math.min(escalationLevel, body.escalation.length - 1)];
				blockMs = step * 1000;
				escalationLevel = Math.min(escalationLevel + 1, body.escalation.length - 1);
			} else {
				// Sem escalation: bloqueia até o fim da janela atual.
				blockMs = windowMs - (now - windowStart);
			}
			const blockedUntil = now + blockMs;
			this.ctx.storage.sql.exec(
				"UPDATE state SET window_start = ?, count = ?, blocked_until = ?, escalation_level = ? WHERE id = 1",
				windowStart,
				count,
				blockedUntil,
				escalationLevel,
			);
			return {
				allowed: false,
				retryAfter: Math.ceil(blockMs / 1000),
				count,
			};
		}

		this.ctx.storage.sql.exec(
			"UPDATE state SET window_start = ?, count = ?, escalation_level = ? WHERE id = 1",
			windowStart,
			count,
			escalationLevel,
		);
		return { allowed: true, retryAfter: 0, count };
	}

	override async fetch(req: Request): Promise<Response> {
		const url = new URL(req.url);
		if (req.method !== "POST" || url.pathname !== "/check") {
			return new Response("Not Found", { status: 404 });
		}
		const body = (await req.json()) as CheckBody;
		const result = this.check(body);
		return Response.json(result);
	}
}
