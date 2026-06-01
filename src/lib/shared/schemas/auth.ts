import { z } from "zod";

/**
 * Schemas de auth — fonte única de validação consumida por:
 * - `react-hook-form` no frontend via `zodResolver`
 * - `@hono/zod-validator` no backend via `zValidator('json', schema)`
 *
 * Mudou aqui, mudou nos dois lados. É o ponto da pasta `src/lib/shared/`.
 */

// Senha minimamente segura: ≥8 chars + (≥1 letra E ≥1 número) OU comprimento ≥12.
// Sem requirement de símbolo (UX hostile, OWASP 2024 recomenda comprimento sobre complexidade).
const STRONG_PASSWORD = /^(?=.*[A-Za-z])(?=.*\d).{8,}$|^.{12,}$/;

export const signupInputSchema = z.object({
	email: z
		.string()
		.trim()
		.toLowerCase()
		.email({ message: "Email inválido." })
		.max(254, { message: "Email muito longo." }),
	password: z
		.string()
		.min(8, { message: "A senha precisa ter pelo menos 8 caracteres." })
		.max(128, { message: "A senha está longa demais." })
		.regex(STRONG_PASSWORD, {
			message:
				"Use letras + números (mínimo 8 chars) ou uma senha longa (12+ chars).",
		}),
	displayName: z
		.string()
		.trim()
		.min(1, { message: "Diz aí como te chamamos." })
		.max(50, { message: "Nome muito longo (máx 50 caracteres)." }),
	termsAccepted: z.literal(true, {
		message: "Você precisa aceitar os Termos pra criar conta.",
	}),
});

export type SignupInput = z.infer<typeof signupInputSchema>;

// Login NÃO valida força de senha — isso é trabalho do signup. Aqui só exige
// email válido e senha não-vazia; quem decide se as credenciais batem é o server.
export const loginInputSchema = z.object({
	email: z
		.string()
		.trim()
		.toLowerCase()
		.email({ message: "Email inválido." })
		.max(254, { message: "Email muito longo." }),
	password: z.string().min(1, { message: "Informe sua senha." }),
});

export type LoginInput = z.infer<typeof loginInputSchema>;

// Solicitar reset (Story 2.4): só o email. A resposta do server é IDÊNTICA pra
// email cadastrado vs não (anti-enumeração estrita, FR65) — diferente do signup.
export const resetRequestSchema = z.object({
	email: z
		.string()
		.trim()
		.toLowerCase()
		.email({ message: "Email inválido." })
		.max(254, { message: "Email muito longo." }),
});

export type ResetRequestInput = z.infer<typeof resetRequestSchema>;

// Confirmar reset (Story 2.5): token (da query string do link) + nova senha,
// mesmas regras de força do signup.
export const resetConfirmSchema = z.object({
	token: z.string().min(1, { message: "Token ausente." }),
	password: z
		.string()
		.min(8, { message: "A senha precisa ter pelo menos 8 caracteres." })
		.max(128, { message: "A senha está longa demais." })
		.regex(STRONG_PASSWORD, {
			message:
				"Use letras + números (mínimo 8 chars) ou uma senha longa (12+ chars).",
		}),
});

export type ResetConfirmInput = z.infer<typeof resetConfirmSchema>;

export const userPublicSchema = z.object({
	id: z.string(),
	email: z.string(),
	displayName: z.string().nullable(),
});

export type UserPublic = z.infer<typeof userPublicSchema>;

export const signupResponseSchema = z.object({
	user: userPublicSchema,
});

export type SignupResponse = z.infer<typeof signupResponseSchema>;

/**
 * Códigos de erro retornados em response.error (HTTP 200/400/429).
 * Cliente usa pra mapear pra microcopy contextual e setError no campo certo.
 */
export const AUTH_ERROR_CODES = {
	EMAIL_EXISTS: "EMAIL_EXISTS",
	DISPOSABLE_EMAIL: "DISPOSABLE_EMAIL",
	INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
	INVALID_RESET_TOKEN: "INVALID_RESET_TOKEN",
	RATE_LIMITED: "RATE_LIMITED",
	VALIDATION: "VALIDATION",
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];
