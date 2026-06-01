import { createFileRoute, redirect } from "@tanstack/react-router";

import { EditEventForm } from "@/components/feature/event/edit-event-form";
import type { EventDetail } from "@/lib/shared/schemas/event";

/**
 * Painel do anfitrião pra um evento (Story 3.2, FR13). Rota auth-gated (espelha
 * `/event/create`). O loader busca GET /api/events/:slug; em 404 sinaliza
 * "não encontrado" sem revelar se o evento existe e não é seu, ou não existe.
 *
 * Este painel vai crescer nas Stories 3.4/3.5 (ativar/encerrar, QR Code, etc.).
 * Por ora: header do evento + form de edição.
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

	const { event } = data;

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

			{/* TODO Story 3.4/3.5: status/ativação/encerrar, QR Code e link do evento. */}

			<EditEventForm event={event} />
		</main>
	);
}
