/**
 * Photo service — Epic 6 (Stories 6.5 / 6.6 / server-side da 6.7).
 *
 * Serviço puro (não importa hono/c.env/middleware); deps via factory pra teste isolado.
 * Cobre o lado servidor do pipeline de upload com upload DIRETO pro Cloudflare Images:
 *
 *  - requestUpload (6.5 + 6.7): carrega o evento Ativo, autoriza o uploader, valida
 *    magic bytes + tamanho + dimensões a partir de uma amostra do cabeçalho enviada
 *    pelo cliente (o Worker nunca vê o arquivo inteiro), e emite a URL assinada.
 *  - confirmUpload (6.6 + 6.7): reserva o cap atomicamente (compare-and-swap, R-001) e
 *    insere a row em event_photos na MESMA transação (db.batch). Cleanup de órfã se falhar.
 *
 * Convenções (espelha event-service/auth-service):
 *  - Erros tipados; a rota traduz pra HTTP code + microcopy.
 *  - Clock injetável (`now`) pra testes determinísticos.
 */
import { fileTypeFromBuffer } from "file-type";
import { and, eq, sql } from "drizzle-orm";

import type { DB } from "../db/client";
import { eventPhotos, events } from "../db/schema";
import type { CfImages } from "../adapters/cf-images";
import {
	MAX_IMAGE_DIMENSION,
	MAX_UPLOAD_BYTES,
} from "../../lib/shared/schemas/photo";
import {
	EventNotFoundError,
	InvalidEventStateError,
} from "./event-service";

// ============================================================================
// Constantes
// ============================================================================

// Mime types aceitos (Story 6.5, NFR57). SVG/GIF/polyglots → rejeitados (não estão aqui).
// HEIC/HEIF cobrem fotos de iPhone; jpeg/png cobrem o resto.
const ALLOWED_MIMES = new Set([
	"image/jpeg",
	"image/png",
	"image/heic",
	"image/heif",
]);

// ============================================================================
// Tipos
// ============================================================================

export interface RequestUploadArgs {
	eventSlug: string;
	/** Usuário autenticado que está enviando (host por enquanto — ver authorize). */
	uploaderUserId: string;
	/** Amostra do CABEÇALHO do arquivo (~64 bytes) pra detecção de magic bytes. */
	headerSample: Uint8Array;
	/** Tamanho declarado do arquivo (validado de novo no confirm). */
	sizeBytes: number;
	width: number;
	height: number;
}

export interface RequestUploadResult {
	uploadUrl: string;
	imageId: string;
}

export interface ConfirmUploadArgs {
	eventSlug: string;
	uploaderUserId: string;
	/** Id pré-alocado devolvido pelo requestUpload. */
	imageId: string;
	/** Tamanho REAL do arquivo enviado (base do contador de cap). */
	sizeBytes: number;
}

export interface ConfirmUploadResult {
	id: string;
	cfImageId: string;
	createdAt: Date;
}

export interface PhotoServiceDeps {
	db: DB;
	images: CfImages;
	/** Clock injetável para testes determinísticos. */
	now?: () => Date;
}

export interface PhotoService {
	requestUpload(args: RequestUploadArgs): Promise<RequestUploadResult>;
	confirmUpload(args: ConfirmUploadArgs): Promise<ConfirmUploadResult>;
}

// ============================================================================
// Erros tipados — handlers de rota traduzem pra HTTP code + microcopy.
// (EventNotFoundError / InvalidEventStateError são reusados do event-service.)
// ============================================================================

/**
 * Arquivo reprovado na validação server-side (Story 6.5): magic bytes não são de
 * imagem permitida (SVG/GIF/polyglot/texto), tamanho > 20MB, ou dimensão > 12k px
 * (decompression bomb). A rota traduz pra 415 { error: "INVALID_IMAGE" }.
 */
export class InvalidImageError extends Error {
	readonly code = "INVALID_IMAGE";
	constructor(message = "Arquivo de imagem inválido") {
		super(message);
	}
}

/**
 * O upload estouraria o cap de armazenamento do evento (Story 6.6, R-001), ou o
 * evento deixou de estar Ativo durante a corrida. A rota traduz pra 409
 * { error: "CAP_EXCEEDED" } → UI exibe lead capture modal (FR71).
 */
export class StorageCapExceededError extends Error {
	readonly code = "CAP_EXCEEDED";
	constructor() {
		super("Cap de armazenamento do evento atingido");
	}
}

// ============================================================================
// Factory
// ============================================================================

export function createPhotoService(deps: PhotoServiceDeps): PhotoService {
	const { db, images, now = () => new Date() } = deps;

	/**
	 * Carrega o evento pelo slug e exige que esteja Ativo + que o uploader possa enviar.
	 *
	 * Autorização (por enquanto): o uploader autorizado é o HOST do evento Ativo. A
	 * Epic 5 (acesso de convidado) ainda não existe, então não há sessões escopadas a
	 * evento/convidado pra validar.
	 * TODO Epic 5: convidados com sessão válida escopada ao evento também são uploaders
	 * autorizados — expandir a checagem aqui (host OU convidado-com-sessão-válida).
	 */
	async function loadActiveEventForUploader(
		eventSlug: string,
		uploaderUserId: string,
	): Promise<typeof events.$inferSelect> {
		const [row] = await db.select().from(events).where(eq(events.slug, eventSlug));
		// Não existe → 404 (R-019: não revela existência).
		if (!row) throw new EventNotFoundError();
		// Autorização: só o host pode enviar hoje. Não-dono → 404 (não revela posse).
		if (row.hostUserId !== uploaderUserId) throw new EventNotFoundError();
		// Estado: só evento Ativo aceita upload (Inativo/Encerrado → 400 INVALID_STATE).
		if (row.status !== "Ativo") throw new InvalidEventStateError();
		return row;
	}

	// ------------------------------------------------------------------------
	// Story 6.5 + 6.7 — validar + emitir URL assinada de upload direto.
	// ------------------------------------------------------------------------
	async function requestUpload(
		args: RequestUploadArgs,
	): Promise<RequestUploadResult> {
		const { eventSlug, uploaderUserId, headerSample, sizeBytes, width, height } =
			args;

		// 1. Evento Ativo + uploader autorizado (host por enquanto).
		const event = await loadActiveEventForUploader(eventSlug, uploaderUserId);

		// 2. Tamanho pré-compressão (Story 6.5). > 20MB → rejeita.
		if (sizeBytes > MAX_UPLOAD_BYTES) {
			throw new InvalidImageError("Arquivo maior que o limite de 20MB.");
		}

		// 3. Dimensões (Story 6.5) — decompression bomb prevention. > 12k px → rejeita.
		if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
			throw new InvalidImageError("Imagem com dimensões grandes demais.");
		}

		// 4. Magic bytes (Story 6.5, NFR57): file-type lê a amostra do cabeçalho. Só
		//    JPEG/PNG/HEIC passam; SVG/GIF/texto/polyglot → InvalidImageError. Como o
		//    upload vai DIRETO pro CF Images, validamos no request (o Worker nunca vê
		//    os bytes completos), não num fetch pós-upload.
		const detected = await fileTypeFromBuffer(headerSample);
		if (!detected || !ALLOWED_MIMES.has(detected.mime)) {
			throw new InvalidImageError("Formato de imagem não suportado.");
		}

		// 5. Soft pre-check de cap (a reserva firme acontece no confirm com o tamanho
		//    real; aqui é só um 409 antecipado pra economizar a viagem do upload).
		if (event.bytesUsed + sizeBytes > event.cap) {
			throw new StorageCapExceededError();
		}

		// 6. Emite a URL assinada + id pré-alocado (Story 6.7, ADD-6).
		return images.createSignedUploadURL();
	}

	// ------------------------------------------------------------------------
	// Story 6.6 + 6.7 — confirmar: cap atomic (CAS) + insert event_photos.
	// ------------------------------------------------------------------------
	async function confirmUpload(
		args: ConfirmUploadArgs,
	): Promise<ConfirmUploadResult> {
		const { eventSlug, uploaderUserId, imageId, sizeBytes } = args;

		// Revalida tamanho real (defesa em profundidade — o cliente manda o size do confirm).
		if (sizeBytes <= 0 || sizeBytes > MAX_UPLOAD_BYTES) {
			throw new InvalidImageError("Tamanho de arquivo inválido.");
		}

		// Evento Ativo + uploader autorizado. (Carrega só pra obter o id + checar posse/estado;
		// a reserva de cap NÃO usa esse bytesUsed lido — usa o CAS atômico abaixo.)
		const event = await loadActiveEventForUploader(eventSlug, uploaderUserId);

		const photoId = crypto.randomUUID();
		const createdAt = now();

		// ── Story 6.6 (R-001): compare-and-swap atômico do cap ──────────────────
		// UPDATE ... WHERE status='Ativo' AND bytes_used + :size <= cap. Em uploads
		// concorrentes (Promise.all), o SQLite serializa os writes: só os que ainda
		// cabem incrementam (meta.changes = 1); os que estourariam afetam 0 linhas. Isso
		// garante que bytes_used NUNCA passe do cap, sem lock explícito no app.
		const capStmt = db
			.update(events)
			.set({ bytesUsed: sql`${events.bytesUsed} + ${sizeBytes}` })
			.where(
				and(
					eq(events.id, event.id),
					eq(events.status, "Ativo"),
					sql`${events.bytesUsed} + ${sizeBytes} <= ${events.cap}`,
				),
			);

		// Insert da foto na MESMA transação (db.batch) que a reserva de cap (Story 6.7).
		// TODO Epic 10 (gamificação, ADD-25): incrementar user_event_history.photos_uploaded
		// += 1 e users.total_instantes += 1 nesta MESMA batch. Os counters de gamificação
		// chegam na Epic 10; por ora só cap + a row da foto.
		const insertStmt = db.insert(eventPhotos).values({
			id: photoId,
			eventId: event.id,
			uploaderUserId,
			cfImageId: imageId,
			sizeBytes,
			telaoVisible: true, // default: foto entra visível no telão (toggle vem depois).
			createdAt,
		});

		// O CAS PRECISA rodar antes do insert e seu resultado ser inspecionado. db.batch
		// roda numa transação implícita; lemos meta.changes do 1º statement (o UPDATE).
		const [capResult] = await db.batch([capStmt, insertStmt]);

		// D1 expõe `meta.changes` (linhas afetadas) no run result do drizzle-d1.
		const changes =
			(capResult as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0;

		if (changes === 0) {
			// CAS falhou: caberia estourar o cap (ou evento saiu de Ativo). O insert da foto
			// foi feito na mesma batch — precisamos desfazer pra não deixar a row órfã.
			// (db.batch do D1 não é all-or-nothing por padrão, então limpamos manualmente.)
			await db.delete(eventPhotos).where(eq(eventPhotos.id, photoId));
			// Cleanup best-effort da imagem órfã no CF Images (não deixa lixo no provedor).
			await images.delete(imageId).catch(() => {
				// Falha no cleanup do provedor não deve mascarar o 409 — engolimos.
			});
			throw new StorageCapExceededError();
		}

		return { id: photoId, cfImageId: imageId, createdAt };
	}

	return { requestUpload, confirmUpload };
}
