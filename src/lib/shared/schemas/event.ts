import { z } from "zod";

import { ACCENT_HEXES, DEFAULT_ACCENT_HEX } from "../event-palette";
import { MISSION_PRESET_IDS } from "../mission-presets";

/**
 * Schema de criação de evento (Story 3.1, FR7/FR8/FR59/FR60).
 * Fonte única consumida pelo form (react-hook-form) e pelo handler Hono
 * (@hono/zod-validator). Evento nasce em status "Inativo" — ver event-service.
 */

const MAX_CUSTOM_MISSIONS = 10;

export const createEventSchema = z.object({
	name: z
		.string()
		.trim()
		.min(1, { message: "Dá um nome pro evento." })
		.max(80, { message: "Nome muito longo (máx 80)." }),
	// Form envia ISO string; coerce pra Date. Aceita data futura ou passada.
	eventDate: z.coerce.date({ message: "Informe uma data válida." }),
	description: z
		.string()
		.trim()
		.max(500, { message: "Descrição muito longa (máx 500)." })
		.optional(),
	// Senha do evento: código compartilhado entre convidados — regra leve (≠ senha
	// pessoal do signup). Só não-trivial.
	password: z
		.string()
		.min(4, { message: "A senha do evento precisa de pelo menos 4 caracteres." })
		.max(64, { message: "Senha do evento longa demais (máx 64)." }),
	colorAccent: z.enum(ACCENT_HEXES).default(DEFAULT_ACCENT_HEX),
	presetMissionIds: z.array(z.enum(MISSION_PRESET_IDS)).default([]),
	customMissions: z
		.array(
			z
				.string()
				.trim()
				.min(1, { message: "Missão vazia." })
				.max(80, { message: "Missão muito longa (máx 80)." }),
		)
		.max(MAX_CUSTOM_MISSIONS, {
			message: `Máximo de ${MAX_CUSTOM_MISSIONS} missões personalizadas.`,
		})
		.default([]),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;

/**
 * Edição de evento (Story 3.2, FR13). Update parcial — todos os campos opcionais.
 * Quando `presetMissionIds`/`customMissions` vêm, o conjunto de missões é SUBSTITUÍDO.
 * Quando `password` vem, o backend rotaciona o hash + revoga sessões de convidado
 * baseadas na senha antiga (hook de revogação chega de fato na Epic 5).
 */
export const updateEventSchema = z
	.object({
		name: z.string().trim().min(1).max(80).optional(),
		eventDate: z.coerce.date().optional(),
		description: z.string().trim().max(500).optional(),
		password: z.string().min(4).max(64).optional(),
		colorAccent: z.enum(ACCENT_HEXES).optional(),
		presetMissionIds: z.array(z.enum(MISSION_PRESET_IDS)).optional(),
		customMissions: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
	})
	.refine((v) => Object.keys(v).length > 0, {
		message: "Nada pra atualizar.",
	});

export type UpdateEventInput = z.infer<typeof updateEventSchema>;

/** Detalhe do evento pro host editar (inclui missões). */
export const eventDetailSchema = z.object({
	id: z.string(),
	slug: z.string(),
	name: z.string(),
	status: z.enum(["Inativo", "Ativo", "Encerrado"]),
	colorAccent: z.string(),
	eventDate: z.string(), // ISO
	description: z.string().nullable(),
	missions: z.array(z.object({ id: z.string(), label: z.string(), isPreset: z.boolean() })),
});

export type EventDetail = z.infer<typeof eventDetailSchema>;

export const eventPublicSchema = z.object({
	id: z.string(),
	slug: z.string(),
	name: z.string(),
	status: z.enum(["Inativo", "Ativo", "Encerrado"]),
	colorAccent: z.string(),
});

export type EventPublic = z.infer<typeof eventPublicSchema>;

/** Códigos de erro de evento retornados em response.error. */
export const EVENT_ERROR_CODES = {
	ACTIVE_LIMIT_REACHED: "ACTIVE_LIMIT_REACHED",
	RATE_LIMITED: "RATE_LIMITED",
	VALIDATION: "VALIDATION",
	NOT_FOUND: "NOT_FOUND",
	FORBIDDEN: "FORBIDDEN",
	// Transição de status inválida (ex: encerrar evento que não está Ativo;
	// ativar evento que não está Inativo). Story 3.4/3.5 state machine.
	INVALID_STATE: "INVALID_STATE",
} as const;

export type EventErrorCode =
	(typeof EVENT_ERROR_CODES)[keyof typeof EVENT_ERROR_CODES];
