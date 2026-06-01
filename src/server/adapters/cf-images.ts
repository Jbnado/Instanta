/**
 * Adapter de Cloudflare Images (Epic 6, Story 6.7 — ADD-6).
 *
 * O cliente faz upload DIRETO pro CF Images via uma URL assinada que o Worker emite
 * (`createSignedUploadURL`), poupando bandwidth do Worker. As variants (thumb/feed/
 * telao/original-zip) são servidas nativamente via https://imagedelivery.net.
 *
 * ── MODO STUB (atual) ───────────────────────────────────────────────────────────
 * O serviço CF Images AINDA NÃO está provisionado (sem binding/secret). Enquanto
 * `CF_IMAGES_API_TOKEN` + `CF_IMAGES_ACCOUNT_ID` não existirem, este adapter roda em
 * STUB: gera um imageId aleatório (crypto), devolve uma upload URL fake e o delete é
 * um no-op logado. Isso deixa todo o pipeline (validação, cap atomic, insert em
 * event_photos, rotas) buildar e testar sem CF Images vivo.
 *
 * ── TODO Epic 6 / ops: impl real env-gated ──────────────────────────────────────
 * Quando os secrets existirem, trocar o corpo do `if (stub)` pelas chamadas reais à
 * CF API mantendo ESTA interface (handlers/service dependem dela, não da CF API):
 *   - createSignedUploadURL → POST https://api.cloudflare.com/client/v4/accounts/
 *       {CF_IMAGES_ACCOUNT_ID}/images/v2/direct_upload  (Bearer CF_IMAGES_API_TOKEN)
 *       → devolve { result: { id, uploadURL } }.
 *   - delete → DELETE .../images/v1/{imageId}  (Bearer CF_IMAGES_API_TOKEN).
 * O `deliveryUrl` já é a URL pública real (depende só do account hash), então não muda.
 */
import { logger } from "../lib/logger";

/** Variants de delivery do CF Images (ADD-6). `original-zip` é a origem pro export. */
export type CfImageVariant = "thumb" | "feed" | "telao" | "original-zip";

export interface CreateSignedUploadResult {
	/** URL assinada onde o cliente faz POST direto do arquivo. */
	uploadUrl: string;
	/** Id pré-alocado da imagem — vira `event_photos.cf_image_id` no confirm. */
	imageId: string;
}

export interface CfImages {
	/** Emite URL assinada + id pré-alocado pro upload direto (Story 6.7). */
	createSignedUploadURL(): Promise<CreateSignedUploadResult>;
	/** Remove uma imagem (cleanup de órfã quando o confirm falha; delete na Story 6.11). */
	delete(imageId: string): Promise<void>;
	/** Monta a URL pública de delivery de uma variant (https://imagedelivery.net/...). */
	deliveryUrl(imageId: string, variant: CfImageVariant): string;
}

/** Env mínimo lido pelo adapter — todos opcionais (ausentes = modo STUB). */
export interface CfImagesEnv {
	CF_IMAGES_ACCOUNT_ID?: string;
	CF_IMAGES_API_TOKEN?: string;
	CF_IMAGES_ACCOUNT_HASH?: string;
}

// Placeholder usado na delivery URL quando o account hash ainda não foi provisionado.
// Em prod com o serviço vivo, CF_IMAGES_ACCOUNT_HASH sempre estará presente.
const STUB_ACCOUNT_HASH = "stub-account-hash";

export function createCfImages(env: CfImagesEnv): CfImages {
	// Impl real só liga quando AMBOS os secrets de escrita existem. Account hash sozinho
	// (delivery) não basta pra criar/deletar imagens.
	const stub = !env.CF_IMAGES_API_TOKEN || !env.CF_IMAGES_ACCOUNT_ID;
	const accountHash = env.CF_IMAGES_ACCOUNT_HASH ?? STUB_ACCOUNT_HASH;

	return {
		async createSignedUploadURL(): Promise<CreateSignedUploadResult> {
			if (stub) {
				// STUB: id aleatório + URL fake. O cliente "envia" pra cá no fluxo de dev/teste.
				const imageId = crypto.randomUUID();
				return {
					imageId,
					uploadUrl: `https://upload.imagedelivery.net/stub/${imageId}`,
				};
			}
			// TODO Epic 6 / ops: POST direct_upload na CF API (ver header do arquivo).
			throw new Error("createSignedUploadURL real ainda não implementado");
		},

		async delete(imageId: string): Promise<void> {
			if (stub) {
				// STUB: no-op logado (cleanup de órfã quando o confirm estoura o cap).
				logger.event("cf_images.delete.stub", { imageId });
				return;
			}
			// TODO Epic 6 / ops: DELETE images/v1/{imageId} na CF API.
			throw new Error("delete real ainda não implementado");
		},

		deliveryUrl(imageId: string, variant: CfImageVariant): string {
			// URL pública real — depende só do account hash (não dos secrets de escrita).
			return `https://imagedelivery.net/${accountHash}/${imageId}/${variant}`;
		},
	};
}
