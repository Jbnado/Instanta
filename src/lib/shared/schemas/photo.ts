import { z } from "zod";

/**
 * Schemas de upload de foto (Epic 6, Stories 6.5-6.7).
 *
 * Fonte única consumida pelo cliente (captura/upload) e pelo handler Hono
 * (@hono/zod-validator). O fluxo tem DUAS chamadas ao Worker:
 *
 * 1. `POST /api/events/:slug/upload-url` (uploadRequestSchema): o cliente manda
 *    metadata + uma amostra base64 do CABEÇALHO do arquivo (primeiros ~64 bytes).
 *    O Worker valida magic bytes via `file-type` (Story 6.5) ANTES de emitir a URL
 *    assinada — como o upload vai direto pro CF Images, o Worker nunca vê os bytes
 *    completos, então a validação acontece no request, não num fetch pós-upload.
 *
 * 2. `POST /api/events/:slug/photos` (confirmUploadSchema): depois do upload direto
 *    pro CF Images, o cliente confirma com o `imageId` pré-alocado + o tamanho real.
 *    O Worker reserva o cap atomicamente (Story 6.6) e insere a row em event_photos.
 */

// Tetos de validação server-side (Story 6.5, NFR57).
// 20MB pré-compressão: arquivo bruto vindo da câmera/galeria.
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
// Dimensão máxima por lado: barreira anti decompression bomb.
export const MAX_IMAGE_DIMENSION = 12_000;

/**
 * Request de URL de upload assinada. `headerSample` é o cabeçalho do arquivo em
 * base64 (poucos bytes — só o suficiente pro file-type reconhecer o formato). O
 * número exato de bytes não é fixado aqui (o cliente manda ~64); só limitamos o
 * teto pra evitar payload inflado, já que NÃO é o arquivo inteiro.
 */
export const uploadRequestSchema = z.object({
	// base64 do cabeçalho do arquivo. min(1) garante que algo veio; o teto evita
	// que o cliente mande o arquivo inteiro disfarçado de "amostra".
	headerSample: z
		.string()
		.min(1, { message: "Amostra do cabeçalho ausente." })
		.max(4096, { message: "Amostra do cabeçalho grande demais." }),
	// Tamanho declarado do arquivo (validado de novo no confirm com o valor real).
	sizeBytes: z
		.number()
		.int()
		.positive({ message: "Tamanho inválido." })
		.max(MAX_UPLOAD_BYTES, { message: "Arquivo maior que 20MB." }),
	width: z
		.number()
		.int()
		.positive({ message: "Largura inválida." })
		.max(MAX_IMAGE_DIMENSION, { message: "Imagem larga demais." }),
	height: z
		.number()
		.int()
		.positive({ message: "Altura inválida." })
		.max(MAX_IMAGE_DIMENSION, { message: "Imagem alta demais." }),
});

export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;

/**
 * Confirmação pós-upload. O `imageId` é o id pré-alocado devolvido pelo passo 1;
 * o `sizeBytes` é o tamanho REAL do arquivo enviado (base do contador de cap).
 */
export const confirmUploadSchema = z.object({
	imageId: z.string().min(1, { message: "imageId ausente." }),
	sizeBytes: z
		.number()
		.int()
		.positive({ message: "Tamanho inválido." })
		.max(MAX_UPLOAD_BYTES, { message: "Arquivo maior que 20MB." }),
});

export type ConfirmUploadInput = z.infer<typeof confirmUploadSchema>;

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
