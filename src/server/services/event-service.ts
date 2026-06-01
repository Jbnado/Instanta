/**
 * Event service — Story 3.1 (criar evento).
 *
 * Serviço puro: não importa hono, c.env ou middleware. Recebe deps via factory pra
 * teste isolado. Toda a lógica de criação (limite de eventos ativos, geração de slug,
 * hash da senha do evento, inserts de evento + missões) vive aqui — o handler HTTP
 * (`routes/events.ts`) fica fino.
 *
 * Convenções (espelha auth-service):
 * - Erros tipados; a rota traduz pra HTTP code + microcopy.
 * - Clock injetável (`now`) pra testes determinísticos.
 * - Inserts numa transação (atomicidade evento + missões).
 */
import { and, eq, ne } from "drizzle-orm";

import type { DB } from "../db/client";
import { eventMissions, events } from "../db/schema";
import { hashPassword } from "../lib/password";
import { presetLabelById } from "../../lib/shared/mission-presets";
import type { CreateEventInput } from "../../lib/shared/schemas/event";

// ============================================================================
// Constantes
// ============================================================================

// NFR58: no máximo 3 eventos não-Encerrados por anfitrião ao mesmo tempo.
const MAX_ACTIVE_EVENTS = 3;
// Teto default de armazenamento por evento (Story 3.1) — 10GB em bytes.
const DEFAULT_CAP_BYTES = 10_737_418_240;
// Tamanho do slug em chars base62 (~6 bits/char → ~60 bits de entropia em 10 chars).
// Unguessable e NÃO derivado do nome (R-019).
const SLUG_LENGTH = 10;
// Tentativas de geração de slug antes de desistir — colisão é astronomicamente rara.
const SLUG_MAX_RETRIES = 5;

const BASE62 =
	"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

// ============================================================================
// Tipos
// ============================================================================

export interface CreateEventArgs {
	hostUserId: string;
	input: CreateEventInput;
}

export interface CreateEventResult {
	id: string;
	slug: string;
	name: string;
	status: "Inativo" | "Ativo" | "Encerrado";
	colorAccent: string;
}

export interface EventServiceDeps {
	db: DB;
	/** Clock injetável para testes determinísticos. */
	now?: () => Date;
}

export interface EventService {
	createEvent(args: CreateEventArgs): Promise<CreateEventResult>;
}

// ============================================================================
// Erros tipados — handlers de rota traduzem pra HTTP code + microcopy.
// ============================================================================

/**
 * Anfitrião já tem MAX_ACTIVE_EVENTS eventos não-Encerrados (NFR58). A rota traduz
 * pra 403 { error: "ACTIVE_LIMIT_REACHED" }.
 */
export class ActiveEventLimitError extends Error {
	readonly code = "ACTIVE_LIMIT_REACHED";
	constructor() {
		super("Limite de 3 eventos ativos atingido");
	}
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Gera um slug base62 aleatório e unguessable via crypto.getRandomValues (R-019).
 * NÃO derivado do nome do evento — entropia pura pra impedir enumeração de eventos.
 */
function generateSlug(): string {
	const bytes = new Uint8Array(SLUG_LENGTH);
	crypto.getRandomValues(bytes);
	let slug = "";
	for (let i = 0; i < SLUG_LENGTH; i++) {
		slug += BASE62[bytes[i]! % BASE62.length];
	}
	return slug;
}

// ============================================================================
// Factory
// ============================================================================

export function createEventService(deps: EventServiceDeps): EventService {
	const { db, now = () => new Date() } = deps;

	/**
	 * Tenta gerar um slug único, refazendo em caso de colisão (improvável). Verifica
	 * contra a unique index `idx_events_slug` consultando antes do insert.
	 */
	async function generateUniqueSlug(): Promise<string> {
		for (let attempt = 0; attempt < SLUG_MAX_RETRIES; attempt++) {
			const slug = generateSlug();
			const existing = await db
				.select({ id: events.id })
				.from(events)
				.where(eq(events.slug, slug));
			if (existing.length === 0) return slug;
		}
		throw new Error("Falha ao gerar slug único após múltiplas tentativas");
	}

	async function createEvent(args: CreateEventArgs): Promise<CreateEventResult> {
		const { hostUserId, input } = args;

		// 1. Checa limite de eventos não-Encerrados (NFR58).
		const activeRows = await db
			.select({ id: events.id })
			.from(events)
			.where(
				and(eq(events.hostUserId, hostUserId), ne(events.status, "Encerrado")),
			);
		if (activeRows.length >= MAX_ACTIVE_EVENTS) {
			throw new ActiveEventLimitError();
		}

		// 2. Slug aleatório unguessable (R-019).
		const slug = await generateUniqueSlug();

		// 3. Hash da senha do evento (argon2id compartilhado).
		const passwordHash = await hashPassword(input.password);

		const eventId = crypto.randomUUID();
		const createdAt = now();

		// 4. Monta as linhas de missões: presets (label resolvido pelo id, isPreset true)
		//    + customs (label = texto já trimado pelo Zod, isPreset false).
		const presetIds = input.presetMissionIds ?? [];
		const customMissions = input.customMissions ?? [];
		const missionRows = [
			...presetIds.map((id) => ({
				id: crypto.randomUUID(),
				eventId,
				// presetLabelById pode em tese retornar undefined; o Zod já garante que o id
				// pertence a MISSION_PRESET_IDS, então o fallback nunca dispara na prática.
				label: presetLabelById(id) ?? id,
				isPreset: true,
				createdAt,
			})),
			...customMissions.map((label) => ({
				id: crypto.randomUUID(),
				eventId,
				label,
				isPreset: false,
				createdAt,
			})),
		];

		// 5. Insere evento + missões atomicamente via db.batch (transação D1).
		const insertEvent = db.insert(events).values({
			id: eventId,
			slug,
			name: input.name,
			passwordHash,
			colorAccent: input.colorAccent,
			description: input.description ?? null,
			eventDate: input.eventDate,
			status: "Inativo", // FR10: evento nasce inativo, sem QR/link.
			hostUserId,
			bytesUsed: 0,
			cap: DEFAULT_CAP_BYTES,
			createdAt,
		});

		if (missionRows.length > 0) {
			await db.batch([insertEvent, db.insert(eventMissions).values(missionRows)]);
		} else {
			await db.batch([insertEvent]);
		}

		return {
			id: eventId,
			slug,
			name: input.name,
			status: "Inativo",
			colorAccent: input.colorAccent,
		};
	}

	return { createEvent };
}
