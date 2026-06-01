/**
 * Rotas de evento — Story 3.1 (criar evento).
 *
 * `POST /` (montado em `/api/events`): autenticado (authMiddleware) + rate limit
 * 5/dia/usuário (NFR13) + validação Zod (createEventSchema) → chama o event-service
 * → 201 { event }. Handler fino: limite de eventos ativos, slug e hash vivem no service.
 *
 * authMiddleware roda ANTES do rate limit pra que `getKey` chaveie por user.id.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";

import {
	createEventSchema,
	updateEventSchema,
} from "../../lib/shared/schemas/event";
import { getDB } from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { rateLimitMiddleware } from "../middleware/rate-limit";
import { type AuthUser } from "../lib/auth-cookies";
import {
	ActiveEventLimitError,
	EventNotFoundError,
	InvalidEventStateError,
	createEventService,
} from "../services/event-service";

type EventVariables = { user: AuthUser; sessionId: string };

export const eventRoutes = new Hono<{
	Bindings: Env;
	Variables: EventVariables;
}>();

// ============================================================================
// POST / — criar evento (Story 3.1).
// ============================================================================
// authMiddleware primeiro (seta c.get('user')) → rate limit por user.id (5/dia,
// NFR13) → validação Zod → service. Evento nasce "Inativo", slug random, cap 10GB.
eventRoutes.post(
	"/",
	authMiddleware(),
	rateLimitMiddleware({
		bucket: "event-create",
		// authMiddleware já rodou e setou 'user'. O `c` do getKey tem o tipo de contexto
		// estreito do rate-limit middleware (não carrega EventVariables), então fazemos
		// cast pro contexto rico pra ler 'user'. Chaveia o bucket por usuário.
		getKey: (c) =>
			(c as unknown as Context<{ Bindings: Env; Variables: EventVariables }>).get(
				"user",
			).id,
		limit: 5,
		window: 86_400, // 24h
	}),
	zValidator("json", createEventSchema),
	async (c) => {
		const input = c.req.valid("json");
		const db = getDB(c.env);
		const service = createEventService({ db });

		try {
			const event = await service.createEvent({
				hostUserId: c.get("user").id,
				input,
			});
			return c.json({ event }, 201);
		} catch (err) {
			if (err instanceof ActiveEventLimitError) {
				return c.json({ error: "ACTIVE_LIMIT_REACHED" }, 403);
			}
			throw err;
		}
	},
);

// ============================================================================
// GET / — listar eventos do anfitrião (Story 3.3).
// ============================================================================
// Só os eventos do usuário autenticado, ordenados por data. O frontend agrupa por
// status. Read host-only, baixa frequência → sem rate limit dedicado.
eventRoutes.get("/", authMiddleware(), async (c) => {
	const db = getDB(c.env);
	const service = createEventService({ db });
	const events = await service.listEventsForHost(c.get("user").id);
	return c.json({ events });
});

// ============================================================================
// GET /:slug — detalhe do evento pro host editar (Story 3.2).
// ============================================================================
// Inclui missões. Não existe OU não é dono → 404 NOT_FOUND (não 403 — R-019).
eventRoutes.get("/:slug", authMiddleware(), async (c) => {
	const db = getDB(c.env);
	const service = createEventService({ db });
	const event = await service.getEventForHost(
		c.req.param("slug"),
		c.get("user").id,
	);
	if (!event) return c.json({ error: "NOT_FOUND" }, 404);
	return c.json({ event });
});

// ============================================================================
// PATCH /:slug — editar evento (Story 3.2, FR13).
// ============================================================================
// Update parcial via updateEventSchema. Rotaciona senha + substitui missões quando
// presentes. Não existe OU não é dono → 404 NOT_FOUND (R-019).
eventRoutes.patch(
	"/:slug",
	authMiddleware(),
	zValidator("json", updateEventSchema),
	async (c) => {
		const input = c.req.valid("json");
		const db = getDB(c.env);
		const service = createEventService({ db });
		try {
			const event = await service.updateEvent(
				c.req.param("slug"),
				c.get("user").id,
				input,
			);
			return c.json({ event });
		} catch (err) {
			if (err instanceof EventNotFoundError) {
				return c.json({ error: "NOT_FOUND" }, 404);
			}
			throw err;
		}
	},
);

// ============================================================================
// POST /:slug/close — encerrar evento (Story 3.5, FR14).
// ============================================================================
// Host-only (authMiddleware). State machine: só Ativo→Encerrado. Não existe/não é
// dono → 404 NOT_FOUND (R-019); status ≠ Ativo → 400 INVALID_STATE.
eventRoutes.post("/:slug/close", authMiddleware(), async (c) => {
	const db = getDB(c.env);
	const service = createEventService({ db });
	try {
		const event = await service.closeEvent(c.req.param("slug"), c.get("user").id);
		return c.json({ event });
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

// ============================================================================
// GET /:slug/public — gate de existência do convidado (Story 3.4, R-019).
// ============================================================================
// SEM authMiddleware: convidado não está logado. Só evento Ativo retorna 200;
// Inativo/Encerrado/inexistente → 404 NOT_FOUND (não revela que existe). A Epic 5
// expande o fluxo real de convidado a partir daqui.
eventRoutes.get("/:slug/public", async (c) => {
	const db = getDB(c.env);
	const service = createEventService({ db });
	const event = await service.getPublicEvent(c.req.param("slug"));
	if (!event) return c.json({ error: "NOT_FOUND" }, 404);
	return c.json({ event });
});

// ============================================================================
// POST /:slug/join — convidado entra no evento (Story 5.1/5.3, FR17).
// ============================================================================
// authMiddleware: o convidado precisa estar autenticado pra participar (reusa a
// mesma conta cross-role do signup, Story 2.1). Membership é IMPLÍCITA — registrada
// em user_event_history pelo service. Evento não-Ativo/inexistente OU usuário banido
// → 404 NOT_FOUND genérico (R-019: não revela existência nem ban). Sucesso → 200
// { event, firstJoin } pra a landing hidratar a tela de "dentro do evento".
eventRoutes.post("/:slug/join", authMiddleware(), async (c) => {
	const db = getDB(c.env);
	const service = createEventService({ db });
	try {
		const result = await service.joinEvent(
			c.req.param("slug"),
			c.get("user").id,
		);
		return c.json(result);
	} catch (err) {
		if (err instanceof EventNotFoundError) {
			return c.json({ error: "NOT_FOUND" }, 404);
		}
		throw err;
	}
});
