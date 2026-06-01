/**
 * Rotas admin de evento — Stories 3.4 (ativação) + painel admin.
 *
 * Montado em `/api/admin`. TODAS as rotas exigem authMiddleware + role admin
 * (guard `requireAdmin`, espelha o helper de routes/auth.ts → 403 RFC 7807 se não-admin).
 *
 * `GET /events`: fila de eventos pendentes de ativação (status Inativo) com info do host.
 * `POST /events/:slug/activate`: transita Inativo→Ativo, gera link de convite e dispara
 *   o email crítico ao anfitrião (FR9/FR67). O serviço flipa o status; aqui resolvemos o
 *   email do host + montamos o inviteUrl + chamamos o mailer (handler fino).
 */
import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";

import { getDB } from "../db/client";
import { users } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { getAllowedOrigins } from "../middleware/cors";
import { type AuthUser } from "../lib/auth-cookies";
import { createMailer } from "../services/mailer";
import {
	EventNotFoundError,
	InvalidEventStateError,
	createEventService,
} from "../services/event-service";

type AdminVariables = { user: AuthUser; sessionId: string };

export const adminRoutes = new Hono<{
	Bindings: Env;
	Variables: AdminVariables;
}>();

// Guard admin-only: só role admin passa; caso contrário 403 RFC 7807 (mirror de
// routes/auth.ts requireAdmin). O role é derivado de ADMIN_EMAIL (auth-service).
function requireAdmin(
	c: Context<{ Bindings: Env; Variables: AdminVariables }>,
): Response | null {
	if (c.get("user").role !== "admin") {
		return c.json(
			{
				type: "https://instanta.jbnado.dev/errors/forbidden",
				title: "Acesso negado",
				status: 403,
				detail: "Apenas administradores acessam o painel admin.",
				instance: c.req.path,
			},
			403,
		);
	}
	return null;
}

// ============================================================================
// GET /events — fila de ativação (eventos Inativo) pro painel admin (Story 3.4).
// ============================================================================
adminRoutes.get("/events", authMiddleware(), async (c) => {
	const denied = requireAdmin(c);
	if (denied) return denied;

	const db = getDB(c.env);
	const service = createEventService({ db });
	const events = await service.listPendingEventsForAdmin();
	return c.json({ events });
});

// ============================================================================
// POST /events/:slug/activate — ativar evento (Story 3.4, FR53).
// ============================================================================
// Inativo→Ativo no serviço; aqui resolvemos email do host, montamos o inviteUrl
// (base = 1º allowed origin, como o fluxo de reset) e disparamos o email crítico
// (FR9/FR67). Inexistente → 404 NOT_FOUND; status ≠ Inativo → 400 INVALID_STATE.
adminRoutes.post("/events/:slug/activate", authMiddleware(), async (c) => {
	const denied = requireAdmin(c);
	if (denied) return denied;

	const db = getDB(c.env);
	const service = createEventService({ db });
	const slug = c.req.param("slug");

	try {
		const { detail, hostUserId } = await service.activateEvent(slug);

		// Resolve o email do host pra notificar (FR9/FR67). Base do link = 1º allowed
		// origin (mesma derivação do fluxo de reset de senha).
		const [host] = await db
			.select({ email: users.email })
			.from(users)
			.where(eq(users.id, hostUserId));
		if (host) {
			const appBaseUrl = getAllowedOrigins(c.env)[0];
			const inviteUrl = `${appBaseUrl}/event/${detail.slug}`;
			await createMailer(c.env).sendEventActivated({
				to: host.email,
				eventName: detail.name,
				inviteUrl,
			});
		}

		return c.json({ event: detail });
	} catch (err) {
		if (err instanceof EventNotFoundError) {
			return c.json({ error: "NOT_FOUND" }, 404);
		}
		if (err instanceof InvalidEventStateError) {
			return c.json({ error: "INVALID_STATE" }, 400);
		}
		throw err;
	}
});
