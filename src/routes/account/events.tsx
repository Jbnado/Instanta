import { createFileRoute, redirect, Link } from "@tanstack/react-router";

import {
	EventList,
	type EventListItem,
} from "@/components/feature/event/event-list";
import { Button } from "@/components/ui/button";

/**
 * Lista de eventos do anfitrião (Story 3.3, FR11/FR12). Rota auth-gated: só
 * anfitrião logado entra (espelha o `beforeLoad` de `/event/create`).
 *
 * O loader busca GET /api/events e devolve os eventos já tipados; o componente
 * delega o agrupamento/ordenação ao <EventList> (presentacional + testável).
 */

interface MeResponse {
	user: {
		id: string;
		email: string;
		displayName: string | null;
		role: string;
	};
}

interface EventsResponse {
	events: EventListItem[];
}

export const Route = createFileRoute("/account/events")({
	beforeLoad: async () => {
		let meRes: Response;
		try {
			meRes = await fetch("/api/auth/me", { credentials: "include" });
		} catch {
			// Sem rede / backend fora do ar: trata como não-autenticado.
			throw redirect({ to: "/auth/login" });
		}

		if (meRes.status === 401 || !meRes.ok) {
			throw redirect({ to: "/auth/login" });
		}

		// Consome o corpo pra liberar a conexão (não precisamos do payload aqui).
		await meRes.json().catch(() => null as MeResponse | null);
	},
	loader: async () => {
		const res = await fetch("/api/events", { credentials: "include" });
		if (!res.ok) {
			// Falha ao listar: devolve vazio (o componente mostra o estado vazio).
			return { events: [] as EventListItem[] };
		}
		const body = (await res.json().catch(() => null)) as EventsResponse | null;
		return { events: body?.events ?? [] };
	},
	component: AccountEventsPage,
});

function AccountEventsPage() {
	const { events } = Route.useLoaderData();

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-6 py-10">
			<header className="flex items-start justify-between gap-4">
				<div className="space-y-1.5">
					<h1 className="text-2xl font-semibold tracking-tight">
						Meus eventos
					</h1>
					<p className="text-sm text-muted-foreground">
						Acompanhe o que está inativo, ativo ou já encerrado.
					</p>
				</div>
				{events.length > 0 ? (
					<Button asChild size="sm" variant="outline">
						<Link to="/event/create">Criar</Link>
					</Button>
				) : null}
			</header>

			<EventList events={events} />
		</main>
	);
}
