/**
 * Photo service — Epic 6 (Stories 6.5 / 6.6 / 6.7), pivot CF Images → R2.
 *
 * Serviço puro (não importa hono/c.env/middleware); deps via factory pra teste isolado.
 * Cobre o lado servidor do pipeline de upload com upload ATRAVÉS do Worker pro R2:
 *
 *  - uploadPhoto (6.5 + 6.6 + 6.7): recebe os BYTES reais da foto (o cliente comprime
 *    antes). Carrega o evento Ativo, autoriza o uploader, valida magic bytes + tamanho
 *    + dimensões nos bytes REAIS, reserva o cap atomicamente (compare-and-swap, R-001)
 *    e insere a row em event_photos na MESMA transação (db.batch), e grava no R2. Se o
 *    cap estoura na corrida, desfaz a row e remove o objeto órfão do R2.
 *  - getPhotoFile (serving): resolve a storage key pela foto e lê o objeto do R2 pra
 *    rota `GET /:slug/photos/:photoId/file` servir o stream.
 *
 * Convenções (espelha event-service/auth-service):
 *  - Erros tipados; a rota traduz pra HTTP code + microcopy.
 *  - Clock injetável (`now`) pra testes determinísticos.
 *
 * Nota sobre dimensões: como o upload agora passa pelos bytes completos, o cliente
 * ainda informa width/height (não decodificamos a imagem no Worker — workerd não tem
 * canvas/decoder nativo barato). A barreira anti decompression-bomb continua sendo o
 * teto declarado + o teto de bytes; é defesa em profundidade, não decode real.
 */
import { fileTypeFromBuffer } from "file-type";
import { and, eq, sql } from "drizzle-orm";

import type { DB } from "../db/client";
import { eventPhotos, events } from "../db/schema";
import type { Storage, StorageObject } from "../adapters/r2-storage";
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

export interface UploadPhotoArgs {
	eventSlug: string;
	/** Usuário autenticado que está enviando (host por enquanto — ver authorize). */
	uploaderUserId: string;
	/** Bytes REAIS da foto (já comprimida pelo cliente). */
	bytes: Uint8Array;
	/** Dimensões declaradas pelo cliente (decompression-bomb guard). */
	width: number;
	height: number;
}

export interface UploadPhotoResult {
	id: string;
	/** Storage key no R2 (guardada em event_photos.cf_image_id). */
	storageKey: string;
	createdAt: Date;
}

export interface GetPhotoFileArgs {
	eventSlug: string;
	photoId: string;
}

export interface PhotoServiceDeps {
	db: DB;
	storage: Storage;
	/** Clock injetável para testes determinísticos. */
	now?: () => Date;
}

export interface PhotoService {
	uploadPhoto(args: UploadPhotoArgs): Promise<UploadPhotoResult>;
	getPhotoFile(args: GetPhotoFileArgs): Promise<StorageObject | null>;
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
	const { db, storage, now = () => new Date() } = deps;

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
	// Stories 6.5 + 6.6 + 6.7 — validar bytes reais + cap atomic (CAS) + put R2.
	// ------------------------------------------------------------------------
	async function uploadPhoto(args: UploadPhotoArgs): Promise<UploadPhotoResult> {
		const { eventSlug, uploaderUserId, bytes, width, height } = args;
		const sizeBytes = bytes.byteLength;

		// 1. Evento Ativo + uploader autorizado (host por enquanto).
		const event = await loadActiveEventForUploader(eventSlug, uploaderUserId);

		// 2. Tamanho real (Story 6.5). 0 ou > 20MB → rejeita.
		if (sizeBytes <= 0 || sizeBytes > MAX_UPLOAD_BYTES) {
			throw new InvalidImageError("Arquivo maior que o limite de 20MB.");
		}

		// 3. Dimensões (Story 6.5) — decompression bomb prevention. > 12k px → rejeita.
		if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
			throw new InvalidImageError("Imagem com dimensões grandes demais.");
		}

		// 4. Magic bytes (Story 6.5, NFR57): file-type lê os bytes REAIS (não uma amostra
		//    de header — o upload passa pelo Worker agora). Só JPEG/PNG/HEIC passam;
		//    SVG/GIF/texto/polyglot → InvalidImageError.
		const detected = await fileTypeFromBuffer(bytes);
		if (!detected || !ALLOWED_MIMES.has(detected.mime)) {
			throw new InvalidImageError("Formato de imagem não suportado.");
		}

		const photoId = crypto.randomUUID();
		const storageKey = storage.keyFor(event.id, photoId);
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
		// cf_image_id guarda a storage key do R2 (coluna mantida pra evitar migration).
		// TODO Epic 10 (gamificação, ADD-25): incrementar user_event_history.photos_uploaded
		// += 1 e users.total_instantes += 1 nesta MESMA batch. Os counters de gamificação
		// chegam na Epic 10; por ora só cap + a row da foto.
		const insertStmt = db.insert(eventPhotos).values({
			id: photoId,
			eventId: event.id,
			uploaderUserId,
			cfImageId: storageKey,
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
			throw new StorageCapExceededError();
		}

		// Cap reservado + row persistida → grava os bytes no R2. Se o put falhar aqui,
		// a row e o cap já estão reservados; o auto-clean/serving lida com a ausência do
		// objeto (o GET devolve 404). put depois do commit evita gravar lixo quando o cap
		// estoura (caminho comum em corrida), ao custo de uma janela curta de row sem objeto.
		await storage.put(storageKey, bytes, detected.mime);

		return { id: photoId, storageKey, createdAt };
	}

	// ------------------------------------------------------------------------
	// Serving — resolve a foto do evento + lê o objeto do R2.
	// ------------------------------------------------------------------------
	async function getPhotoFile(
		args: GetPhotoFileArgs,
	): Promise<StorageObject | null> {
		const { eventSlug, photoId } = args;

		// Resolve a foto garantindo que pertence ao evento do slug (evita IDOR
		// cross-event). Não exige host: serving é público pro feed/telão (R-019 não
		// se aplica a um photoId concreto já listado).
		const [row] = await db
			.select({ cfImageId: eventPhotos.cfImageId, eventSlug: events.slug })
			.from(eventPhotos)
			.innerJoin(events, eq(eventPhotos.eventId, events.id))
			.where(and(eq(eventPhotos.id, photoId), eq(events.slug, eventSlug)));

		if (!row) return null;
		return storage.get(row.cfImageId);
	}

	return { uploadPhoto, getPhotoFile };
}
