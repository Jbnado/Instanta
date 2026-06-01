import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy } from "lucide-react";

import { EditEventForm } from "@/components/feature/event/edit-event-form";
import { CloseEventButton } from "@/components/feature/event/close-event-button";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { EventDetail } from "@/lib/shared/schemas/event";

/**
 * Painel do anfitrião pra um evento (Story 3.2, FR13). Rota auth-gated (espelha
 * `/event/create`). O loader busca GET /api/events/:slug; em 404 sinaliza
 * "não encontrado" sem revelar se o evento existe e não é seu, ou não existe.
 *
 * Stories 3.4/3.5: o painel agora é uma state machine pelo `event.status`:
 *  - Inativo   → "Aguardando ativação" (sem QR/link) + edição liberada.
 *  - Ativo     → link de convite + QR Code + botão "Encerrar evento" + edição.
 *  - Encerrado → estado de leitura (sem QR/link, sem edição).
 */

interface MeResponse {
	user: {
		id: string;
		email: string;
		displayName: string | null;
		role: string;
	};
}

interface EventDetailResponse {
	event: EventDetail;
}

type LoaderData =
	| { found: true; event: EventDetail }
	| { found: false; event: null };

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
	day: "2-digit",
	month: "long",
	year: "numeric",
});

function formatEventDate(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return dateFormatter.format(date);
}

export const Route = createFileRoute("/event/$slug/host")({
	beforeLoad: async () => {
		let meRes: Response;
		try {
			meRes = await fetch("/api/auth/me", { credentials: "include" });
		} catch {
			throw redirect({ to: "/auth/login" });
		}

		if (meRes.status === 401 || !meRes.ok) {
			throw redirect({ to: "/auth/login" });
		}

		await meRes.json().catch(() => null as MeResponse | null);
	},
	loader: async ({ params }): Promise<LoaderData> => {
		const res = await fetch(`/api/events/${params.slug}`, {
			credentials: "include",
		});
		if (!res.ok) {
			// 404 (ou qualquer falha): trata como não encontrado — não vazamos detalhe.
			return { found: false, event: null };
		}
		const body = (await res.json().catch(() => null)) as
			| EventDetailResponse
			| null;
		if (!body?.event) {
			return { found: false, event: null };
		}
		return { found: true, event: body.event };
	},
	component: EventHostPage,
});

function EventHostPage() {
	const data = Route.useLoaderData();

	if (!data.found) {
		return (
			<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-3 px-6 py-10 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">
					Evento não encontrado
				</h1>
				<p className="text-sm text-muted-foreground">
					Esse evento não existe ou não é seu.
				</p>
			</main>
		);
	}

	return <EventHostPanel initialEvent={data.event} />;
}

/**
 * Painel propriamente dito. Mantém o evento em estado local pra refletir
 * mutações sem refetch: o EditEventForm devolve o evento salvo (onSaved) e o
 * CloseEventButton devolve o evento encerrado (onClosed) → trocamos o status na
 * hora e a state machine re-renderiza o painel certo.
 */
function EventHostPanel({ initialEvent }: { initialEvent: EventDetail }) {
	const [event, setEvent] = useState<EventDetail>(initialEvent);

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-6 py-10">
			<header className="space-y-2">
				<div className="flex items-center gap-2">
					{/* Dot da cor de acento do evento */}
					<span
						aria-hidden="true"
						className="size-3 shrink-0 rounded-full"
						style={{ backgroundColor: event.colorAccent }}
					/>
					<span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						{event.status}
					</span>
				</div>
				<h1 className="text-2xl font-semibold tracking-tight">{event.name}</h1>
				<p className="text-sm text-muted-foreground">
					{formatEventDate(event.eventDate)}
				</p>
			</header>

			{/* State machine pelo status (Stories 3.4/3.5). */}
			{event.status === "Inativo" ? (
				<>
					<PendingActivationPanel />
					{/* Anfitrião ainda pode ajustar o evento antes da ativação. */}
					<EditEventForm event={event} onSaved={setEvent} />
				</>
			) : null}

			{event.status === "Ativo" ? (
				<>
					<ActivePanel event={event} onClosed={setEvent} />
					<EditEventForm event={event} onSaved={setEvent} />
				</>
			) : null}

			{event.status === "Encerrado" ? <ClosedPanel /> : null}
		</main>
	);
}

/** Estado Inativo: aguardando o admin ativar. Sem QR/link (R-019, gate 3.4). */
function PendingActivationPanel() {
	return (
		<section className="space-y-2 rounded-xl border border-input bg-muted/30 px-5 py-6">
			<h2 className="text-base font-semibold tracking-tight">
				Aguardando ativação
			</h2>
			<p className="text-sm text-muted-foreground">
				Seu evento está pronto e aguardando ativação. Quando for ativado, o QR
				Code e o link de convite aparecem aqui.
			</p>
		</section>
	);
}

/**
 * Estado Ativo: mostra o link de convite copiável + QR Code (mesmo padrão do
 * MFA) + botão destrutivo de encerrar. O link aponta pra landing pública do
 * evento (`/event/:slug`), montado a partir da origin do navegador.
 */
function ActivePanel({
	event,
	onClosed,
}: {
	event: EventDetail;
	onClosed: (event: EventDetail) => void;
}) {
	const [copied, setCopied] = useState(false);

	// Origin só existe no browser; em SSR/teste sem window cai num fallback vazio.
	const origin =
		typeof window !== "undefined" ? window.location.origin : "";
	const inviteUrl = `${origin}/event/${event.slug}`;

	async function copyInvite() {
		try {
			await navigator.clipboard.writeText(inviteUrl);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard pode falhar (permissão/ambiente). Silencioso: o link fica
			// visível e selecionável (select-all) como fallback manual.
		}
	}

	return (
		<section className="space-y-5 rounded-xl border border-input px-5 py-6">
			<div className="space-y-1.5">
				<h2 className="text-base font-semibold tracking-tight">
					Convide os participantes
				</h2>
				<p className="text-sm text-muted-foreground">
					Compartilhe o link ou deixe a galera escanear o QR Code.
				</p>
			</div>

			{/* QR Code do link de convite (mesmo padrão visual do MFA). */}
			<div className="flex justify-center">
				<div className="rounded-lg bg-white p-3">
					<QRCodeSVG
						value={inviteUrl}
						size={184}
						title="QR Code de convite do evento"
					/>
				</div>
			</div>

			{/* Link copiável. */}
			<div className="space-y-1.5">
				<Label htmlFor="event-invite-link">Link de convite</Label>
				<div className="flex items-center gap-2">
					<code
						id="event-invite-link"
						className="flex-1 overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-sm select-all"
					>
						{inviteUrl}
					</code>
					<Button
						type="button"
						variant="outline"
						size="icon"
						aria-label="Copiar link de convite"
						onClick={copyInvite}
					>
						{copied ? <Check className="size-4" /> : <Copy className="size-4" />}
					</Button>
				</div>
			</div>

			{/* Encerrar evento (Story 3.5) — atualiza o painel pro estado Encerrado. */}
			<CloseEventButton slug={event.slug} onClosed={onClosed} />
		</section>
	);
}

/**
 * Estado Encerrado: leitura apenas, sem QR/link e sem edição.
 * TODO Story 3.7: ClosingScreen completa (resumo, download, etc.); por ora só
 * um estado calmo. `EventDetail` não expõe `endedAt` hoje, então não datamos o
 * encerramento — quando o schema crescer, adicionar "encerrado em {endedAt}".
 */
function ClosedPanel() {
	return (
		<section className="space-y-2 rounded-xl border border-input bg-muted/30 px-5 py-6">
			<h2 className="text-base font-semibold tracking-tight">
				Evento encerrado
			</h2>
			<p className="text-sm text-muted-foreground">
				Este evento foi encerrado e não aceita mais novas fotos. Em breve você
				poderá baixar o álbum completo por aqui.
			</p>
		</section>
	);
}
