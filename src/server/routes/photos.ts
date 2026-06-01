/**
 * Rotas de upload de foto — Epic 6 (Stories 6.5 / 6.6 / 6.7).
 *
 * Montadas em `/api/events`, então os paths finais são:
 *   - POST /api/events/:slug/upload-url → emite URL assinada de upload direto (6.7),
 *     após validar magic bytes + tamanho + dimensões (6.5).
 *   - POST /api/events/:slug/photos     → confirma o upload: reserva o cap (6.6, R-001)
 *     + insere a row em event_photos na mesma transação.
 *
 * Ambas exigem authMiddleware. O uploader autorizado HOJE é o host do evento Ativo;
 * a Epic 5 (convidados) expande isso no service (ver photo-service.loadActiveEventForUploader).
 *
 * authMiddleware roda ANTES do rate limit pra que `getKey` chaveie por user.id.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";

import {
	confirmUploadSchema,
	uploadRequestSchema,
} from "../../lib/shared/schemas/photo";
import { createCfImages } from "../adapters/cf-images";
import { getDB } from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { rateLimitMiddleware } from "../middleware/rate-limit";
import { type AuthUser } from "../lib/auth-cookies";
import {
	EventNotFoundError,
	InvalidEventStateError,
} from "../services/event-service";
import {
	InvalidImageError,
	StorageCapExceededError,
	createPhotoService,
} from "../services/photo-service";

type PhotoVariables = { user: AuthUser; sessionId: string };

export const photoRoutes = new Hono<{
	Bindings: Env;
	Variables: PhotoVariables;
}>();

/** Decodifica base64 → Uint8Array (a amostra do cabeçalho vem base64 do cliente). */
function base64ToBytes(b64: string): Uint8Array {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

/** Traduz os erros tipados do service → HTTP code + { error } (espelha routes/events). */
function mapPhotoError(c: Context, err: unknown): Response {
	if (err instanceof InvalidImageError) {
		return c.json({ error: "INVALID_IMAGE" }, 415);
	}
	if (err instanceof StorageCapExceededError) {
		return c.json({ error: "CAP_EXCEEDED" }, 409);
	}
	if (err instanceof EventNotFoundError) {
		return c.json({ error: "NOT_FOUND" }, 404);
	}
	if (err instanceof InvalidEventStateError) {
		return c.json({ error: "INVALID_STATE" }, 400);
	}
	throw err;
}

// ============================================================================
// POST /:slug/upload-url — validar + emitir URL assinada (Stories 6.5 + 6.7).
// ============================================================================
// authMiddleware primeiro (seta c.get('user')) → rate limit por user.id (bucket
// 'photo-upload', 100/h generoso) → validação Zod → service. Magic bytes/size/dims
// validados no service ANTES de emitir a URL (o Worker não vê o arquivo inteiro).
photoRoutes.post(
	"/:slug/upload-url",
	authMiddleware(),
	rateLimitMiddleware({
		bucket: "photo-upload",
		// authMiddleware já setou 'user'. O `c` do getKey tem o contexto estreito do
		// rate-limit middleware (sem PhotoVariables), então fazemos cast pro contexto
		// rico pra ler 'user'. Chaveia o bucket por usuário.
		getKey: (c) =>
			(c as unknown as Context<{ Bindings: Env; Variables: PhotoVariables }>).get(
				"user",
			).id,
		limit: 100,
		window: 3600, // 1h
	}),
	zValidator("json", uploadRequestSchema),
	async (c) => {
		const input = c.req.valid("json");
		const db = getDB(c.env);
		const images = createCfImages(c.env);
		const service = createPhotoService({ db, images });

		try {
			const result = await service.requestUpload({
				eventSlug: c.req.param("slug"),
				uploaderUserId: c.get("user").id,
				headerSample: base64ToBytes(input.headerSample),
				sizeBytes: input.sizeBytes,
				width: input.width,
				height: input.height,
			});
			return c.json(result, 200);
		} catch (err) {
			return mapPhotoError(c, err);
		}
	},
);

// ============================================================================
// POST /:slug/photos — confirmar upload (Stories 6.6 + 6.7).
// ============================================================================
// Reserva o cap atomicamente (CAS, R-001) + insere event_photos na mesma tx.
// Cap estouraria → 409 CAP_EXCEEDED (+ cleanup da imagem órfã no CF Images).
photoRoutes.post(
	"/:slug/photos",
	authMiddleware(),
	zValidator("json", confirmUploadSchema),
	async (c) => {
		const input = c.req.valid("json");
		const db = getDB(c.env);
		const images = createCfImages(c.env);
		const service = createPhotoService({ db, images });

		try {
			const photo = await service.confirmUpload({
				eventSlug: c.req.param("slug"),
				uploaderUserId: c.get("user").id,
				imageId: input.imageId,
				sizeBytes: input.sizeBytes,
			});
			return c.json(
				{
					photo: {
						id: photo.id,
						cfImageId: photo.cfImageId,
						createdAt: photo.createdAt.toISOString(),
					},
				},
				201,
			);
		} catch (err) {
			return mapPhotoError(c, err);
		}
	},
);
