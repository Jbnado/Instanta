// Secrets que `wrangler types` (cf-typegen) não captura — vivem em `.dev.vars`
// (dev) ou via `wrangler secret put` (prod). Estende `Cloudflare.Env` global pra
// que `env.<NAME>` apareça tipado em todo o Worker.
declare global {
	namespace Cloudflare {
		interface Env {
			SENTRY_DSN?: string;
			RESEND_API_KEY?: string;
			// Secret HS256 pro JWT de access token (Story 2.1).
			// Em dev local fica em .dev.vars; em prod via `wrangler secret put AUTH_JWT_SECRET`.
			AUTH_JWT_SECRET: string;
			// Chave AES-GCM (32 bytes em base64) que cifra o secret TOTP do MFA (Story 2.7/2.8).
			// SEPARADA do JWT secret (NFR45). Dev local em .dev.vars; prod via
			// `wrangler secret put MFA_ENCRYPTION_KEY`.
			MFA_ENCRYPTION_KEY: string;
			// Storage de fotos no R2 (Epic 6 — pivot CF Images → R2 free tier). Binding
			// declarado em wrangler.jsonc; `wrangler types` (cf-typegen) também o capta,
			// mas declaramos aqui pra que o tipo exista mesmo sem rodar o typegen e pros
			// testes (miniflare cria um R2 efêmero pra esse binding).
			PHOTOS: R2Bucket;
		}
	}
}

export {};
