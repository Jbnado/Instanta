/**
 * Mailer stub — Story 2.4/2.5.
 *
 * Interface mínima pra que o envio real (Resend, FR4) entre no Epic 4 (Story 4.12)
 * trocando só a impl — handlers e auth-service dependem desta interface, não do Resend.
 *
 * Em não-produção logamos a URL completa de reset (token incluso) pra teste local.
 * Em produção NUNCA logamos token/hash (NFR25): a branch real fica como TODO Epic 4.
 */
import { logger } from "../lib/logger";

export interface SendPasswordResetArgs {
	to: string;
	resetUrl: string;
}

export interface Mailer {
	sendPasswordReset(args: SendPasswordResetArgs): Promise<void>;
}

export function createMailer(env: { ENVIRONMENT?: string }): Mailer {
	const isProd = env.ENVIRONMENT === "production";

	return {
		async sendPasswordReset({ to, resetUrl }: SendPasswordResetArgs): Promise<void> {
			if (isProd) {
				// TODO Epic 4 (Story 4.12): enviar email transacional real via Resend
				// (reusar `sendEmail` de ../lib/email com template de reset). NUNCA logar
				// a resetUrl/token em prod (NFR25) — só metadados não-sensíveis.
				logger.event("auth.reset.email.queued", { to });
				return;
			}
			// Dev/preview: log da URL completa (com token) pra copiar e testar o fluxo.
			logger.event("auth.reset.email.dev", { to, resetUrl });
		},
	};
}
