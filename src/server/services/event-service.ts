/**
 * Event service — Story 3.1 (criar evento).
 *
 * Serviço puro: não importa hono, c.env ou middleware. Recebe deps via factory pra
 * teste isolado. Toda a lógica de criação (limite de eventos ativos, geração de slug,
 * inserts de evento + missões) vive aqui — o handler HTTP (`routes/events.ts`) fica fino.
 *
 * Convenções (espelha auth-service):
 * - Erros tipados; a rota traduz pra HTTP code + microcopy.
 * - Clock injetável (`now`) pra testes determinísticos.
 * - Inserts numa transação (atomicidade evento + missões).
 */
import { and, asc, eq, lt, ne, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { DB } from "../db/client";
import { eventMissions, events, users } from "../db/schema";
import { presetLabelById } from "../../lib/shared/mission-presets";
import type {
	CreateEventInput,
	EventDetail,
	EventPublic,
	UpdateEventInput,
} from "../../lib/shared/schemas/event";

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

/** Item da lista de eventos do anfitrião (Story 3.3) — campos do feed de eventos. */
export interface EventListItem {
	id: string;
	slug: string;
	name: string;
	status: "Inativo" | "Ativo" | "Encerrado";
	colorAccent: string;
	eventDate: string; // ISO
	description: string | null;
}

/**
 * Resultado de activateEvent (Story 3.4). O serviço só flipa o status e devolve o
 * detalhe + o id do host; o envio do email crítico (FR9/FR67) fica na ROTA, que
 * resolve o email do host e chama o mailer — mantém o serviço puro-ish (sem mailer dep).
 */
export interface ActivateEventResult {
	detail: EventDetail;
	hostUserId: string;
}

/** Item da fila de ativação do painel admin (Story 3.4). Inclui info do host + #missões. */
export interface PendingEventForAdmin {
	id: string;
	slug: string;
	name: string;
	eventDate: string; // ISO
	hostUserId: string;
	hostEmail: string;
	hostName: string | null;
	missionsCount: number;
}

export interface EventServiceDeps {
	db: DB;
	/** Clock injetável para testes determinísticos. */
	now?: () => Date;
}

export interface EventService {
	createEvent(args: CreateEventArgs): Promise<CreateEventResult>;
	/** Lista os eventos do anfitrião ordenados por data (Story 3.3). */
	listEventsForHost(hostUserId: string): Promise<EventListItem[]>;
	/**
	 * Carrega um evento + suas missões pelo slug, SE pertencer ao anfitrião.
	 * Retorna `null` quando o evento não existe OU não é do anfitrião — a rota
	 * mapeia null → 404 sem revelar a existência/posse (R-019). Story 3.2.
	 */
	getEventForHost(slug: string, hostUserId: string): Promise<EventDetail | null>;
	/**
	 * Atualização parcial de evento (Story 3.2, FR13). Lança EventNotFoundError se o
	 * slug não existe ou não é do anfitrião. Substitui o conjunto de missões quando
	 * `presetMissionIds`/`customMissions` presentes. Retorna o EventDetail atualizado.
	 */
	updateEvent(
		slug: string,
		hostUserId: string,
		input: UpdateEventInput,
	): Promise<EventDetail>;
	/**
	 * Ativa um evento (Story 3.4, FR53) — operação ADMIN (sem checagem de posse: a
	 * ativação é prerrogativa do admin, não do dono). Transição PERMITIDA: Inativo→Ativo.
	 * Slug inexistente → EventNotFoundError; status ≠ Inativo → InvalidEventStateError.
	 * Não envia email aqui (a rota faz, com o email do host) — devolve detail + hostUserId.
	 */
	activateEvent(slug: string): Promise<ActivateEventResult>;
	/**
	 * Encerra um evento do anfitrião (Story 3.5, FR14). Transição PERMITIDA: Ativo→Encerrado.
	 * Não existe OU não é dono → EventNotFoundError (404, R-019); status ≠ Ativo →
	 * InvalidEventStateError. Seta endedAt=now.
	 */
	closeEvent(slug: string, hostUserId: string): Promise<EventDetail>;
	/**
	 * Auto-encerra eventos cuja data já passou e ainda estão Ativo (Story 3.5, FR15).
	 * Rodado por cron. Idempotente: só toca status Ativo, então 2ª passada fecha 0.
	 * Retorna a quantidade de eventos encerrados.
	 */
	autoCloseExpiredEvents(): Promise<number>;
	/**
	 * Gate de existência pro convidado (Story 3.4, R-019). Retorna os dados públicos
	 * mínimos SOMENTE se o evento está Ativo; caso contrário (Inativo/Encerrado/inexistente)
	 * retorna null — a rota mapeia null → 404 sem revelar que o evento existe.
	 */
	getPublicEvent(slug: string): Promise<EventPublic | null>;
	/**
	 * Lista eventos pendentes de ativação (status Inativo) pro painel admin (Story 3.4).
	 * Faz join com users pra trazer email/nome do host + conta as missões; ordena por data.
	 */
	listPendingEventsForAdmin(): Promise<PendingEventForAdmin[]>;
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

/**
 * Evento não existe OU não pertence ao anfitrião que pediu (Story 3.2). A rota
 * traduz pra 404 { error: "NOT_FOUND" } — NÃO 403 — pra não revelar posse (R-019).
 */
export class EventNotFoundError extends Error {
	readonly code = "NOT_FOUND";
	constructor() {
		super("Evento não encontrado");
	}
}

/**
 * Transição de status inválida na state machine de evento (Story 3.4/3.5): ativar um
 * evento que não está Inativo, ou encerrar um que não está Ativo. A rota traduz pra
 * 400 { error: "INVALID_STATE" }.
 */
export class InvalidEventStateError extends Error {
	readonly code = "INVALID_STATE";
	constructor() {
		super("Transição de status do evento inválida");
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

		// 2. Slug aleatório unguessable (R-019) — é o próprio segredo de acesso ao evento.
		const slug = await generateUniqueSlug();

		const eventId = crypto.randomUUID();
		const createdAt = now();

		// 3. Monta as linhas de missões: presets (label resolvido pelo id, isPreset true)
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

		// 4. Insere evento + missões atomicamente via db.batch (transação D1).
		const insertEvent = db.insert(events).values({
			id: eventId,
			slug,
			name: input.name,
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

	// ------------------------------------------------------------------------
	// Story 3.3 — listar eventos do anfitrião.
	// ------------------------------------------------------------------------
	async function listEventsForHost(hostUserId: string): Promise<EventListItem[]> {
		// Só os eventos cujo dono é o usuário autenticado, ordenados por data do evento.
		// O agrupamento por status fica a cargo do frontend (Story 3.3).
		const rows = await db
			.select({
				id: events.id,
				slug: events.slug,
				name: events.name,
				status: events.status,
				colorAccent: events.colorAccent,
				eventDate: events.eventDate,
				description: events.description,
			})
			.from(events)
			.where(eq(events.hostUserId, hostUserId))
			.orderBy(asc(events.eventDate));

		return rows.map((r) => ({
			id: r.id,
			slug: r.slug,
			name: r.name,
			status: r.status,
			colorAccent: r.colorAccent,
			eventDate: r.eventDate.toISOString(),
			description: r.description,
		}));
	}

	// ------------------------------------------------------------------------
	// Story 3.2 — carregar evento + missões pro host editar.
	// ------------------------------------------------------------------------

	/** Carrega missões do evento no shape do eventDetailSchema. */
	async function loadMissions(
		eventId: string,
	): Promise<EventDetail["missions"]> {
		const rows = await db
			.select({
				id: eventMissions.id,
				label: eventMissions.label,
				isPreset: eventMissions.isPreset,
			})
			.from(eventMissions)
			.where(eq(eventMissions.eventId, eventId));
		return rows;
	}

	/**
	 * Carrega o evento pelo slug exigindo posse (hostUserId). Retorna a row ou null.
	 * Base compartilhada por getEventForHost e updateEvent — checa posse na query
	 * (and slug + hostUserId) pra não vazar existência de eventos de terceiros.
	 */
	async function loadOwnedEvent(slug: string, hostUserId: string) {
		const [row] = await db
			.select()
			.from(events)
			.where(and(eq(events.slug, slug), eq(events.hostUserId, hostUserId)));
		return row ?? null;
	}

	/** Monta o EventDetail a partir de uma row de evento + suas missões. */
	function toEventDetail(
		row: typeof events.$inferSelect,
		missions: EventDetail["missions"],
	): EventDetail {
		return {
			id: row.id,
			slug: row.slug,
			name: row.name,
			status: row.status,
			colorAccent: row.colorAccent,
			eventDate: row.eventDate.toISOString(),
			description: row.description,
			missions,
		};
	}

	async function getEventForHost(
		slug: string,
		hostUserId: string,
	): Promise<EventDetail | null> {
		const row = await loadOwnedEvent(slug, hostUserId);
		if (!row) return null; // não existe OU não é dono → null (rota → 404, R-019).
		const missions = await loadMissions(row.id);
		return toEventDetail(row, missions);
	}

	// ------------------------------------------------------------------------
	// Story 3.2 — editar evento (update parcial + rotação de senha + missões).
	// ------------------------------------------------------------------------
	async function updateEvent(
		slug: string,
		hostUserId: string,
		input: UpdateEventInput,
	): Promise<EventDetail> {
		const row = await loadOwnedEvent(slug, hostUserId);
		// 404, não 403: não revelamos se o evento existe pra outro dono (R-019).
		if (!row) throw new EventNotFoundError();

		const eventId = row.id;
		const updatedAt = now();

		// 1. Monta o patch parcial do evento. Só inclui campos enviados.
		const eventPatch: Partial<typeof events.$inferInsert> = {};
		if (input.name !== undefined) eventPatch.name = input.name;
		if (input.eventDate !== undefined) eventPatch.eventDate = input.eventDate;
		if (input.description !== undefined)
			eventPatch.description = input.description ?? null;
		if (input.colorAccent !== undefined) eventPatch.colorAccent = input.colorAccent;

		// 2. Decide se o conjunto de missões será substituído (qualquer um dos dois
		//    arrays presente dispara o replace completo — Story 3.2).
		const replaceMissions =
			input.presetMissionIds !== undefined || input.customMissions !== undefined;

		// Statements da transação D1 (atomicidade update + replace de missões).
		// drizzle tipa cada item do batch via generics distintos por statement; aqui
		// misturamos update/delete/insert, então usamos o tipo amplo BatchItem<"sqlite">.
		type Stmt = BatchItem<"sqlite">;
		const statements: Stmt[] = [];

		// Sempre atualiza pelo menos um campo: o updateEventSchema garante ≥1 chave, mas
		// se vierem APENAS missões o patch fica vazio — nesse caso não emitimos update.
		if (Object.keys(eventPatch).length > 0) {
			statements.push(db.update(events).set(eventPatch).where(eq(events.id, eventId)));
		}

		if (replaceMissions) {
			const presetIds = input.presetMissionIds ?? [];
			const customMissions = input.customMissions ?? [];
			const missionRows = [
				...presetIds.map((id) => ({
					id: crypto.randomUUID(),
					eventId,
					label: presetLabelById(id) ?? id,
					isPreset: true,
					createdAt: updatedAt,
				})),
				...customMissions.map((label) => ({
					id: crypto.randomUUID(),
					eventId,
					label,
					isPreset: false,
					createdAt: updatedAt,
				})),
			];

			// Apaga as missões atuais e re-insere o novo conjunto.
			statements.push(db.delete(eventMissions).where(eq(eventMissions.eventId, eventId)));
			if (missionRows.length > 0) {
				statements.push(db.insert(eventMissions).values(missionRows));
			}
		}

		// db.batch exige ≥1 statement; o refine do schema garante que sempre há algo.
		if (statements.length > 0) {
			// db.batch espera um tuple não-vazio [first, ...rest]; nosso array é dinâmico
			// (montado condicionalmente), então afirmamos a forma de tuple aqui.
			await db.batch(statements as [Stmt, ...Stmt[]]);
		}

		// 3. Recarrega estado final (evento + missões) pra devolver o EventDetail.
		const [fresh] = await db.select().from(events).where(eq(events.id, eventId));
		const missions = await loadMissions(eventId);
		return toEventDetail(fresh!, missions);
	}

	// ------------------------------------------------------------------------
	// Story 3.4 — ativar evento (admin): Inativo → Ativo.
	// ------------------------------------------------------------------------
	async function activateEvent(slug: string): Promise<ActivateEventResult> {
		// Ativação é op de admin → sem filtro por hostUserId (carrega só pelo slug).
		const [row] = await db.select().from(events).where(eq(events.slug, slug));
		if (!row) throw new EventNotFoundError();
		// State machine: só Inativo→Ativo é permitido (FR53).
		if (row.status !== "Inativo") throw new InvalidEventStateError();

		await db.update(events).set({ status: "Ativo" }).where(eq(events.id, row.id));

		const missions = await loadMissions(row.id);
		const detail = toEventDetail({ ...row, status: "Ativo" }, missions);
		return { detail, hostUserId: row.hostUserId };
	}

	// ------------------------------------------------------------------------
	// Story 3.5 — encerrar evento (host): Ativo → Encerrado.
	// ------------------------------------------------------------------------
	async function closeEvent(slug: string, hostUserId: string): Promise<EventDetail> {
		const row = await loadOwnedEvent(slug, hostUserId);
		// 404 (não 403): não revela existência/posse a terceiros (R-019).
		if (!row) throw new EventNotFoundError();
		// State machine: só Ativo→Encerrado é permitido (FR14).
		if (row.status !== "Ativo") throw new InvalidEventStateError();

		const endedAt = now();
		await db
			.update(events)
			.set({ status: "Encerrado", endedAt })
			.where(eq(events.id, row.id));

		const missions = await loadMissions(row.id);
		return toEventDetail({ ...row, status: "Encerrado", endedAt }, missions);
	}

	// ------------------------------------------------------------------------
	// Story 3.5 — auto-encerrar eventos vencidos (cron, FR15). Idempotente.
	// ------------------------------------------------------------------------
	async function autoCloseExpiredEvents(): Promise<number> {
		const cutoff = now();
		// Só toca status Ativo com eventDate no passado → 2ª passada fecha 0 (idempotente).
		const result = await db
			.update(events)
			.set({ status: "Encerrado", endedAt: cutoff })
			.where(and(eq(events.status, "Ativo"), lt(events.eventDate, cutoff)));
		// D1 expõe `meta.changes` (linhas afetadas) via o run result do drizzle-d1.
		const changes = (result as unknown as { meta?: { changes?: number } }).meta?.changes;
		return changes ?? 0;
	}

	// ------------------------------------------------------------------------
	// Story 3.4 — gate de existência público (convidado). Só Ativo retorna dados.
	// ------------------------------------------------------------------------
	async function getPublicEvent(slug: string): Promise<EventPublic | null> {
		const [row] = await db
			.select({
				id: events.id,
				slug: events.slug,
				name: events.name,
				status: events.status,
				colorAccent: events.colorAccent,
			})
			.from(events)
			.where(eq(events.slug, slug));
		// Inativo/Encerrado/inexistente → null (rota → 404, R-019). Só Ativo "existe".
		if (!row || row.status !== "Ativo") return null;
		return row;
	}

	// ------------------------------------------------------------------------
	// Story 3.4 — fila de ativação do painel admin (eventos Inativo + info host).
	// ------------------------------------------------------------------------
	async function listPendingEventsForAdmin(): Promise<PendingEventForAdmin[]> {
		const rows = await db
			.select({
				id: events.id,
				slug: events.slug,
				name: events.name,
				eventDate: events.eventDate,
				hostUserId: events.hostUserId,
				hostEmail: users.email,
				hostName: users.displayName,
				// Conta as missões do evento via subquery correlacionada (sem GROUP BY).
				missionsCount: sql<number>`(
					SELECT COUNT(*) FROM ${eventMissions}
					WHERE ${eventMissions.eventId} = ${events.id}
				)`,
			})
			.from(events)
			.innerJoin(users, eq(users.id, events.hostUserId))
			.where(eq(events.status, "Inativo"))
			.orderBy(asc(events.eventDate));

		return rows.map((r) => ({
			id: r.id,
			slug: r.slug,
			name: r.name,
			eventDate: r.eventDate.toISOString(),
			hostUserId: r.hostUserId,
			hostEmail: r.hostEmail,
			hostName: r.hostName,
			missionsCount: Number(r.missionsCount),
		}));
	}

	return {
		createEvent,
		listEventsForHost,
		getEventForHost,
		updateEvent,
		activateEvent,
		closeEvent,
		autoCloseExpiredEvents,
		getPublicEvent,
		listPendingEventsForAdmin,
	};
}
