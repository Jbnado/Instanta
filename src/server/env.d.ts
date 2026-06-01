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
			// Cloudflare Images (Epic 6, Stories 6.5-6.7) — opcionais porque o serviço
			// ainda NÃO está provisionado: o adapter roda em modo STUB enquanto faltarem.
			// Quando os três existirem (account id + token de API + hash de delivery), o
			// adapter ativa a impl real (createSignedUploadURL/delete via CF API). Prod via
			// `wrangler secret put CF_IMAGES_API_TOKEN`; account id/hash podem ir em vars.
			CF_IMAGES_ACCOUNT_ID?: string;
			CF_IMAGES_API_TOKEN?: string;
			CF_IMAGES_ACCOUNT_HASH?: string;
		}
	}
}

export {};
