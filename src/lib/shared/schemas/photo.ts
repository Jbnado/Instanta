import { z } from "zod";

/**
 * Schemas de upload de foto (Epic 6, Stories 6.5-6.7) — pivot CF Images → R2.
 *
 * Fonte única consumida pelo cliente (captura/upload) e pelo handler Hono. O fluxo
 * agora é UMA chamada com upload ATRAVÉS do Worker pro R2 (free tier, egress zero),
 * não mais o stub de signed-URL direto pro CF Images:
 *
 * `POST /api/events/:slug/photos` (uploadPhotoQuerySchema nos query params): o cliente
 *    comprime/redimensiona a foto e manda os BYTES no corpo (Content-Type da imagem),
 *    com `width`/`height` nos query params. O Worker valida magic bytes via `file-type`
 *    nos bytes REAIS (Story 6.5), reserva o cap atomicamente (Story 6.6, R-001), insere
 *    a row em event_photos e grava o objeto no R2 (`PHOTOS.put`).
 *
 * As imagens são servidas pelo Worker (R2 não é público) via
 * `GET /api/events/:slug/photos/:photoId/file`.
 */

// Tetos de validação server-side (Story 6.5, NFR57).
// 20MB pós-compressão (limite do corpo aceito pelo Worker).
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
// Dimensão máxima por lado: barreira anti decompression bomb.
export const MAX_IMAGE_DIMENSION = 12_000;

// Mime types aceitos no corpo do upload (espelha ALLOWED_MIMES do photo-service).
// A validação de verdade é magic bytes nos bytes reais; isto só gateia o Content-Type.
export const ALLOWED_UPLOAD_MIMES = [
	"image/jpeg",
	"image/png",
	"image/heic",
	"image/heif",
] as const;

/**
 * Query params do upload. As dimensões vêm do cliente (o Worker não decodifica a
 * imagem — só valida magic bytes + tamanho dos bytes). `coerce` porque query params
 * chegam como string.
 */
export const uploadPhotoQuerySchema = z.object({
	width: z.coerce
		.number()
		.int()
		.positive({ message: "Largura inválida." })
		.max(MAX_IMAGE_DIMENSION, { message: "Imagem larga demais." }),
	height: z.coerce
		.number()
		.int()
		.positive({ message: "Altura inválida." })
		.max(MAX_IMAGE_DIMENSION, { message: "Imagem alta demais." }),
});

export type UploadPhotoQuery = z.infer<typeof uploadPhotoQuerySchema>;

/** Códigos de erro de foto retornados em response.error (mapeados pra HTTP na rota). */
export const PHOTO_ERROR_CODES = {
	// Magic bytes / tamanho / dimensões reprovados (Story 6.5) → 415.
	INVALID_IMAGE: "INVALID_IMAGE",
	// Cap de armazenamento estouraria (Story 6.6, R-001) → 409.
	CAP_EXCEEDED: "CAP_EXCEEDED",
	// Evento não existe ou não pertence ao uploader → 404.
	NOT_FOUND: "NOT_FOUND",
	// Evento não está Ativo (não aceita upload) → 400.
	INVALID_STATE: "INVALID_STATE",
	RATE_LIMITED: "RATE_LIMITED",
	VALIDATION: "VALIDATION",
} as const;

export type PhotoErrorCode =
	(typeof PHOTO_ERROR_CODES)[keyof typeof PHOTO_ERROR_CODES];
