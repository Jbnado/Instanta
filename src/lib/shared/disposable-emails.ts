/**
 * Blocklist de domínios de email descartável — anti-Sybil, anti-evasão de banimento (NFR56).
 *
 * Critério de inclusão: provedor tem reputação pública como descartável, sem MX próprio,
 * permite signup sem verificação. Lista é hand-curated — não puxar de fonte upstream
 * automaticamente (risco de falso positivo derrubando usuários reais).
 *
 * Atualizar quando alerta operacional NFR61 detectar spike (>10/hora). Documentar
 * o domínio adicionado no PR, com link pra evidência.
 *
 * Fontes consultadas (manualmente, não auto-sync):
 * - https://github.com/disposable-email-domains/disposable-email-domains
 * - https://github.com/wesbos/burner-email-providers
 *
 * Comparação `.toLowerCase()`: domínio inserido em lowercase; chamador normaliza antes.
 */
export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
	// Top 50 + descartáveis brasileiros — cobertura suficiente pro MVP.
	"mailinator.com",
	"mailinator.net",
	"mailinator.org",
	"guerrillamail.com",
	"guerrillamail.net",
	"guerrillamail.org",
	"guerrillamail.biz",
	"guerrillamail.de",
	"sharklasers.com",
	"grr.la",
	"10minutemail.com",
	"10minutemail.net",
	"10minutemail.org",
	"20minutemail.com",
	"30minutemail.com",
	"tempmail.com",
	"temp-mail.com",
	"temp-mail.org",
	"tempmail.net",
	"tempmail.io",
	"tempmailaddress.com",
	"throwawaymail.com",
	"trashmail.com",
	"trashmail.net",
	"trashmail.de",
	"trashmail.io",
	"trashmail.ws",
	"yopmail.com",
	"yopmail.net",
	"yopmail.fr",
	"maildrop.cc",
	"mailcatch.com",
	"dispostable.com",
	"fakeinbox.com",
	"getnada.com",
	"getairmail.com",
	"emailondeck.com",
	"mail-temporaire.fr",
	"mintemail.com",
	"mohmal.com",
	"mytemp.email",
	"nada.email",
	"sneakemail.com",
	"spam4.me",
	"spambox.us",
	"spamgourmet.com",
	"spamspot.com",
	"tempinbox.com",
	"throwam.com",
	"discard.email",
	"discardmail.com",
	"einrot.com",
	"emailnetz.de",
	"fake-mail.net",
	"fakemail.fr",
	"inboxbear.com",
	"jetable.org",
	"mailnesia.com",
	"mt2014.com",
	"my10minutemail.com",
	"now.mefound.com",
	"thankyou2010.com",
	"trbvm.com",
	"wegwerf-email.de",
	"wegwerfmail.de",
	"yepmail.net",
]);

/**
 * Retorna true se o email pertence a um domínio descartável conhecido.
 * Aceita email já validado (RFC). Não valida formato — só extrai o domínio.
 */
export function isDisposableEmail(email: string): boolean {
	const at = email.lastIndexOf("@");
	if (at === -1) return false;
	const domain = email.slice(at + 1).toLowerCase().trim();
	return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}
