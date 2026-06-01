/**
 * Storage adapter de Cloudflare R2 (Epic 6 — pivot do stub de CF Images → R2).
 *
 * Decisão de produto: tudo no free tier. R2 dá 10GB grátis + egress ZERO, o que
 * casa com o cap default de 10GB do evento (events.cap) e com o telão/feed servindo
 * muitas imagens sem custo de banda. CF Images cobraria por imagem armazenada/servida.
 *
 * ── Fluxo (upload através do Worker, não presigned) ──────────────────────────────
 * O cliente comprime/redimensiona a foto e faz POST dos BYTES pro Worker. O Worker:
 *   1. valida magic bytes nos bytes REAIS (file-type) — não numa amostra de header;
 *   2. reserva o cap atomicamente (CAS, R-001) + insere event_photos na mesma batch;
 *   3. `PHOTOS.put(key, bytes)` no R2.
 * Isso simplifica vs signed-URL e roda no Workers Free (sem cobrança de bandwidth;
 * requests contam mas ok pro MVP).
 *
 * ── Servir imagens ───────────────────────────────────────────────────────────────
 * R2 NÃO é público. O Worker serve via `GET /api/events/:slug/photos/:photoId/file`
 * que faz `PHOTOS.get(key)` e devolve o stream com Content-Type + cache imutável.
 *
 * ── Key scheme ───────────────────────────────────────────────────────────────────
 * `events/<eventId>/<imageId>` — namespaced por evento pra facilitar listagem/cleanup
 * (auto-clean D+30 pode varrer o prefixo `events/<eventId>/`). A key é guardada em
 * `event_photos.cf_image_id` (nome de coluna mantido pra evitar migration; semântica
 * agora é "storage key do R2", não mais id do CF Images).
 *
 * Interface deliberadamente fina (put/get/delete/keyFor) — o photo-service depende
 * DESTA interface, não da API do R2, então é fácil fakear em teste.
 */

/** Resultado de um GET no R2 (corpo + content-type pra rota de serving). */
export interface StorageObject {
	body: ReadableStream;
	contentType: string;
	size: number;
}

export interface Storage {
	/** Grava os bytes da foto no R2 sob a key dada. */
	put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
	/** Lê um objeto do R2 (null se não existe) — usado pela rota de serving. */
	get(key: string): Promise<StorageObject | null>;
	/** Remove um objeto (cleanup de órfã quando o cap estoura; delete na Story 6.11). */
	delete(key: string): Promise<void>;
	/** Monta a storage key determinística pra uma foto. */
	keyFor(eventId: string, imageId: string): string;
}

/** Env mínimo lido pelo adapter — só o binding R2. */
export interface StorageEnv {
	PHOTOS: R2Bucket;
}

export function createStorage(env: StorageEnv): Storage {
	const bucket = env.PHOTOS;

	return {
		keyFor(eventId: string, imageId: string): string {
			return `events/${eventId}/${imageId}`;
		},

		async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
			await bucket.put(key, bytes, {
				httpMetadata: { contentType },
			});
		},

		async get(key: string): Promise<StorageObject | null> {
			const obj = await bucket.get(key);
			if (!obj) return null;
			return {
				body: obj.body,
				contentType: obj.httpMetadata?.contentType ?? "application/octet-stream",
				size: obj.size,
			};
		},

		async delete(key: string): Promise<void> {
			await bucket.delete(key);
		},
	};
}
