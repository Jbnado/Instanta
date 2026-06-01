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

import { createEventSchema } from "../../lib/shared/schemas/event";
import { getDB } from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { rateLimitMiddleware } from "../middleware/rate-limit";
import { type AuthUser } from "../lib/auth-cookies";
import {
	ActiveEventLimitError,
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
