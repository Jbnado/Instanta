/**
 * Rotas de foto — Epic 6 (Stories 6.5 / 6.6 / 6.7), pivot CF Images → R2.
 *
 * Montadas em `/api/events`, então os paths finais são:
 *   - POST /api/events/:slug/photos            → upload ATRAVÉS do Worker pro R2:
 *     valida magic bytes nos bytes reais (6.5), reserva o cap (6.6, R-001) + insere
 *     event_photos, grava no R2 (6.7). O corpo é a imagem comprimida; width/height
 *     vêm nos query params.
 *   - GET  /api/events/:slug/photos/:id/file   → serve o objeto do R2 (R2 não é público)
 *     com Content-Type + cache imutável.
 *
 * POST exige authMiddleware (host do evento Ativo hoje; Epic 5 expande no service).
 * GET de serving é público (feed/telão consomem) — não exige auth.
 *
 * authMiddleware roda ANTES do rate limit pra que `getKey` chaveie por user.id.
 */
import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";

import {
	ALLOWED_UPLOAD_MIMES,
	MAX_UPLOAD_BYTES,
	uploadPhotoQuerySchema,
} from "../../lib/shared/schemas/photo";
import { createStorage } from "../adapters/r2-storage";
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

const ALLOWED_MIME_SET = new Set<string>(ALLOWED_UPLOAD_MIMES);

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
// POST /:slug/photos — upload através do Worker pro R2 (Stories 6.5 + 6.6 + 6.7).
// ============================================================================
// authMiddleware primeiro (seta c.get('user')) → rate limit por user.id (bucket
// 'photo-upload', 100/h generoso) → handler lê os bytes do corpo + width/height da
// query → service valida (magic bytes/size/dims), reserva o cap atômico e grava no R2.
photoRoutes.post(
	"/:slug/photos",
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
	zValidator("query", uploadPhotoQuerySchema),
	async (c) => {
		const { width, height } = c.req.valid("query");

		// Gateia o Content-Type antes de ler o corpo inteiro (a validação de verdade é
		// magic bytes no service). Sem header válido → 415.
		const contentType = (c.req.header("content-type") ?? "").split(";")[0]?.trim();
		if (!contentType || !ALLOWED_MIME_SET.has(contentType)) {
			return c.json({ error: "INVALID_IMAGE" }, 415);
		}

		const buf = await c.req.arrayBuffer();
		const bytes = new Uint8Array(buf);

		// Guard de tamanho antes de tocar no service/R2 (defesa em profundidade — o
		// service revalida; aqui evita trabalho com payload obviamente grande).
		if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) {
			return c.json({ error: "INVALID_IMAGE" }, 415);
		}

		const db = getDB(c.env);
		const storage = createStorage(c.env);
		const service = createPhotoService({ db, storage });

		try {
			const photo = await service.uploadPhoto({
				eventSlug: c.req.param("slug"),
				uploaderUserId: c.get("user").id,
				bytes,
				width,
				height,
			});
			return c.json(
				{
					photo: {
						id: photo.id,
						storageKey: photo.storageKey,
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

// ============================================================================
// GET /:slug/photos/:photoId/file — serve o objeto do R2 (R2 não é público).
// ============================================================================
// Sem authMiddleware: feed/telão consomem publicamente. O service garante que a foto
// pertence ao evento do slug (anti-IDOR). Cache imutável: a key é única por upload, o
// conteúdo nunca muda, então pode cachear forte na CDN/browser.
photoRoutes.get("/:slug/photos/:photoId/file", async (c) => {
	const db = getDB(c.env);
	const storage = createStorage(c.env);
	const service = createPhotoService({ db, storage });

	const obj = await service.getPhotoFile({
		eventSlug: c.req.param("slug"),
		photoId: c.req.param("photoId"),
	});

	if (!obj) return c.json({ error: "NOT_FOUND" }, 404);

	return new Response(obj.body, {
		status: 200,
		headers: {
			"content-type": obj.contentType,
			"content-length": String(obj.size),
			"cache-control": "public, max-age=31536000, immutable",
		},
	});
});
