import { logger } from "./logger";

// Wrapper Resend HTTP API. Sem SDK pra economizar bundle no Worker edge.
// Resiliente: se RESEND_API_KEY ausente, loga warn e retorna { skipped: true }
// — handlers que dependem (cron alerts, email transacional) seguem sem throw.

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SENDER = "noreply@instanta.jbnado.dev";

interface SendEmailInput {
	to: string;
	subject: string;
	html: string;
	text?: string;
}

interface SendEmailResult {
	id?: string;
	skipped?: boolean;
	error?: string;
}

export async function sendEmail(env: Env, input: SendEmailInput): Promise<SendEmailResult> {
	const key = env.RESEND_API_KEY;
	if (!key) {
		logger.warn({ event: "email.skipped.no-key", to: input.to, subject: input.subject });
		return { skipped: true };
	}
	try {
		const res = await fetch(RESEND_ENDPOINT, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${key}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				from: SENDER,
				to: input.to,
				subject: input.subject,
				html: input.html,
				...(input.text ? { text: input.text } : {}),
			}),
		});
		if (!res.ok) {
			const errBody = await res.text().catch(() => "<no-body>");
			logger.error({
				event: "email.failed",
				status: res.status,
				to: input.to,
				subject: input.subject,
				body: errBody.slice(0, 200),
			});
			return { error: `HTTP ${res.status}` };
		}
		const data = (await res.json()) as { id?: string };
		logger.info({ event: "email.sent", id: data.id, to: input.to, subject: input.subject });
		return { id: data.id };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		logger.error({ event: "email.threw", error: msg, to: input.to, subject: input.subject });
		return { error: msg };
	}
}

// Helper pra alertas administrativos. Envia plaintext + html wrapper trivial
// pro `env.ADMIN_EMAIL`. Sem template engine (over-engineering pro MVP).
export async function sendAdminAlert(
	env: Env,
	{ subject, body }: { subject: string; body: string },
): Promise<SendEmailResult> {
	const to = env.ADMIN_EMAIL;
	if (!to) {
		logger.warn({ event: "email.skipped.no-admin", subject });
		return { skipped: true };
	}
	const html = `<pre style="font: 14px/1.4 ui-monospace, monospace; white-space: pre-wrap;">${escapeHtml(body)}</pre>`;
	return sendEmail(env, { to, subject, html, text: body });
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
