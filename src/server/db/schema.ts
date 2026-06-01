/**
 * Schema base D1 — Story 1.2.
 *
 * Convenções (architecture.md §Database Schema):
 * - tabelas snake_case plural, colunas snake_case, IDs UUID v7 (text time-sortable).
 * - timestamps `integer({ mode: "timestamp" })` (unix seconds UTC).
 * - FKs `<entity>_id`, sem ON DELETE CASCADE — deletes via service (auto-clean D+30, LGPD).
 * - aliases TS camelCase via `text("snake_case")`.
 * - índices só onde há query frequente; cada índice custa write throughput.
 */
import { sql } from "drizzle-orm";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { uuidv7 } from "../../lib/uuid";

// ============================================================================
// Users & Auth (permanentes)
// ============================================================================

export const users = sqliteTable(
	"users",
	{
		id: text("id").primaryKey().$defaultFn(uuidv7),
		email: text("email").notNull(),
		passwordHash: text("password_hash").notNull(),
		displayName: text("display_name"),
		totalInstantes: integer("total_instantes").notNull().default(0),
		currentLevel: integer("current_level").notNull().default(1),
		// LGPD: nullable pra suportar despersonalização (direito ao esquecimento) —
		// usuário pode ter tido a coluna zerada sem perder o aceite histórico.
		// Populado no signup (Story 2.1) com timestamp do momento do aceite do T&C.
		termsAcceptedAt: integer("terms_accepted_at", { mode: "timestamp" }),
		deletedAt: integer("deleted_at", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
	},
	(t) => [uniqueIndex("idx_users_email").on(t.email)],
);

export const sessions = sqliteTable(
	"sessions",
	{
		id: text("id").primaryKey().$defaultFn(uuidv7),
		userId: text("user_id")
			.notNull()
			.references(() => users.id),
		refreshTokenHash: text("refresh_token_hash").notNull(),
		ip: text("ip"),
		userAgent: text("user_agent"),
		lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
		revokedAt: integer("revoked_at", { mode: "timestamp" }),
		// Lineage de rotação (R-002, Story 2.6): id da sessão sucessora, preenchido
		// quando esta sessão é rotacionada. Permite distinguir race benigno
		// (sessão tem replacedBy + revogada há poucos segundos) de reuse real.
		replacedBy: text("replaced_by"),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
	},
	(t) => [index("idx_sessions_user_id").on(t.userId)],
);

// Tokens de reset de senha (Story 2.4/2.5). Espelha o estilo de `sessions`:
// guardamos só o SHA-256 hex do token (NFR43, single-use ≤30min, ≥128 bits).
// O plaintext só vai no link do email — nunca é persistido nem logado em prod.
export const passwordResetTokens = sqliteTable(
	"password_reset_tokens",
	{
		id: text("id").primaryKey().$defaultFn(uuidv7),
		userId: text("user_id")
			.notNull()
			.references(() => users.id),
		// SHA-256 hex do token plaintext (como sessions.refreshTokenHash).
		tokenHash: text("token_hash").notNull(),
		// Expiração ≤30min após criação (NFR43). Após isso o token é inválido.
		expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
		// Marca single-use: preenchido no confirm; token usado nunca mais vale.
		usedAt: integer("used_at", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
	},
	(t) => [index("idx_password_reset_tokens_token_hash").on(t.tokenHash)],
);

export const userMfaSecrets = sqliteTable("user_mfa_secrets", {
	userId: text("user_id")
		.primaryKey()
		.references(() => users.id),
	secretEncrypted: text("secret_encrypted").notNull(),
	createdAt: integer("created_at", { mode: "timestamp" })
		.notNull()
		.default(sql`(unixepoch())`),
});

// ============================================================================
// Events (permanentes)
// ============================================================================

export const events = sqliteTable(
	"events",
	{
		id: text("id").primaryKey().$defaultFn(uuidv7),
		slug: text("slug").notNull(),
		name: text("name").notNull(),
		passwordHash: text("password_hash").notNull(),
		colorAccent: text("color_accent").notNull(),
		status: text("status", {
			enum: ["Inativo", "Ativo", "Encerrado"],
		}).notNull(),
		hostUserId: text("host_user_id")
			.notNull()
			.references(() => users.id),
		bytesUsed: integer("bytes_used").notNull().default(0),
		// v2 telão: timestamp em que o evento entra em modo público; pré-modelado pra evitar migration futura.
		scheduledVisibility: integer("scheduled_visibility", { mode: "timestamp" }),
		endedAt: integer("ended_at", { mode: "timestamp" }),
		photosPurgedAt: integer("photos_purged_at", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
	},
	(t) => [
		uniqueIndex("idx_events_slug").on(t.slug),
		index("idx_events_host_user_id").on(t.hostUserId),
		index("idx_events_status").on(t.status),
	],
);

export const eventMissions = sqliteTable(
	"event_missions",
	{
		id: text("id").primaryKey().$defaultFn(uuidv7),
		eventId: text("event_id")
			.notNull()
			.references(() => events.id),
		label: text("label").notNull(),
		isPreset: integer("is_preset", { mode: "boolean" }).notNull().default(false),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
	},
	(t) => [index("idx_event_missions_event_id").on(t.eventId)],
);

export const eventBans = sqliteTable(
	"event_bans",
	{
		id: text("id").primaryKey().$defaultFn(uuidv7),
		eventId: text("event_id")
			.notNull()
			.references(() => events.id),
		userId: text("user_id")
			.notNull()
			.references(() => users.id),
		bannedByUserId: text("banned_by_user_id")
			.notNull()
			.references(() => users.id),
		revertedAt: integer("reverted_at", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
	},
	(t) => [
		index("idx_event_bans_event_id").on(t.eventId),
		index("idx_event_bans_user_id").on(t.userId),
	],
);

// ============================================================================
// Photos & Interactions (efêmeras — apagadas em D+30)
// ============================================================================

export const eventPhotos = sqliteTable(
	"event_photos",
	{
		id: text("id").primaryKey().$defaultFn(uuidv7),
		eventId: text("event_id")
			.notNull()
			.references(() => events.id),
		uploaderUserId: text("uploader_user_id")
			.notNull()
			.references(() => users.id),
		cfImageId: text("cf_image_id").notNull(),
		telaoVisible: integer("telao_visible", { mode: "boolean" })
			.notNull()
			.default(true),
		hiddenAt: integer("hidden_at", { mode: "timestamp" }),
		hiddenBy: text("hidden_by").references(() => users.id),
		reportsCount: integer("reports_count").notNull().default(0),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
	},
	(t) => [
		index("idx_event_photos_event_id").on(t.eventId),
		index("idx_event_photos_uploader_user_id").on(t.uploaderUserId),
		index("idx_event_photos_created_at").on(t.createdAt),
	],
);

export const reactions = sqliteTable(
	"reactions",
	{
		id: text("id").primaryKey().$defaultFn(uuidv7),
		photoId: text("photo_id")
			.notNull()
			.references(() => eventPhotos.id),
		userId: text("user_id")
			.notNull()
			.references(() => users.id),
		// emoji ou identificador da reação. Set restrito é validado em zod no service.
		type: text("type").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
	},
	(t) => [
		index("idx_reactions_photo_id").on(t.photoId),
		index("idx_reactions_user_id").on(t.userId),
	],
);

export const reports = sqliteTable(
	"reports",
	{
		id: text("id").primaryKey().$defaultFn(uuidv7),
		photoId: text("photo_id")
			.notNull()
			.references(() => eventPhotos.id),
		reporterUserId: text("reporter_user_id")
			.notNull()
			.references(() => users.id),
		// IP hashado para anti-Sybil sem reter PII em texto plano.
		ipHash: text("ip_hash").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
	},
	(t) => [index("idx_reports_photo_id").on(t.photoId)],
);

// ============================================================================
// History & Audit (permanentes — sobrevivem ao D+30)
// ============================================================================

// Counter aggregate (FR45-46). Incrementado na mesma tx SQLite que UPLOAD/REACTION/MISSION.
// host_user_id é nullable para suportar despersonalização cross-user (NFR23).
export const userEventHistory = sqliteTable(
	"user_event_history",
	{
		id: text("id").primaryKey().$defaultFn(uuidv7),
		userId: text("user_id")
			.notNull()
			.references(() => users.id),
		eventId: text("event_id")
			.notNull()
			.references(() => events.id),
		eventNameSnapshot: text("event_name_snapshot").notNull(),
		eventDateSnapshot: integer("event_date_snapshot", {
			mode: "timestamp",
		}).notNull(),
		hostUserId: text("host_user_id").references(() => users.id),
		photosUploaded: integer("photos_uploaded").notNull().default(0),
		reactionsReceived: integer("reactions_received").notNull().default(0),
		missionsCompleted: integer("missions_completed").notNull().default(0),
		instantesEarned: integer("instantes_earned").notNull().default(0),
		joinedAt: integer("joined_at", { mode: "timestamp" }).notNull(),
	},
	(t) => [
		index("idx_user_event_history_user_id").on(t.userId),
		index("idx_user_event_history_event_id").on(t.eventId),
	],
);

export const auditLog = sqliteTable(
	"audit_log",
	{
		id: text("id").primaryKey().$defaultFn(uuidv7),
		eventType: text("event_type").notNull(),
		// actor pode ser sistema (cron) → nullable.
		actorUserId: text("actor_user_id").references(() => users.id),
		targetId: text("target_id"),
		ip: text("ip"),
		userAgent: text("user_agent"),
		payloadJson: text("payload_json"),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
	},
	(t) => [
		index("idx_audit_log_event_type").on(t.eventType),
		index("idx_audit_log_created_at").on(t.createdAt),
	],
);

// ============================================================================
// Lead capture (FR71)
// ============================================================================

export const leadCaptures = sqliteTable(
	"lead_captures",
	{
		id: text("id").primaryKey().$defaultFn(uuidv7),
		email: text("email").notNull(),
		// origem opcional: lead pode vir de modal pós-cap 100% (com event) ou de landing page.
		sourceEventId: text("source_event_id").references(() => events.id),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
	},
	(t) => [index("idx_lead_captures_source_event_id").on(t.sourceEventId)],
);
