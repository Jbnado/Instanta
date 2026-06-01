import { createFileRoute } from "@tanstack/react-router";

import type { EventPublic } from "@/lib/shared/schemas/event";

/**
 * Landing pública do convidado (Story 3.4, gate da state machine).
 *
 * O endpoint GET /api/events/:slug/public só responde 200 pra eventos Ativos;
 * pra Inativo/Encerrado/inexistente responde 404. Aqui isso vira a regra
 * R-019: nunca revelamos que um evento Inativo existe — o 404 cai num estado
 * genérico "Página não encontrada", idêntico ao de um slug que não existe.
 *
 * O loader trata o 404 graciosamente (sem lançar erro não tratado): devolve
 * `{ found: false }` e o componente renderiza o not-found.
 */

interface EventPublicResponse {
	// O backend devolve só um subset público (slug, name, status, colorAccent).
	event: Pick<EventPublic, "slug" | "name" | "status" | "colorAccent">;
}

type LoaderData =
	| { found: true; event: EventPublicResponse["event"] }
	| { found: false };

export const Route = createFileRoute("/event/$slug/")({
	loader: async ({ params }): Promise<LoaderData> => {
		const res = await fetch(`/api/events/${params.slug}/public`, {
			credentials: "include",
		});
		// 404 (Inativo/Encerrado/inexistente) → not-found genérico (R-019).
		if (!res.ok) {
			return { found: false };
		}
		const body = (await res.json().catch(() => null)) as
			| EventPublicResponse
			| null;
		if (!body?.event) {
			return { found: false };
		}
		return { found: true, event: body.event };
	},
	component: EventGuestLandingPage,
});

function EventGuestLandingPage() {
	const data = Route.useLoaderData();

	if (!data.found) {
		// Estado genérico — não diferenciamos "não existe" de "existe mas Inativo".
		return (
			<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-3 px-6 py-10 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">
					Página não encontrada
				</h1>
				<p className="text-sm text-muted-foreground">
					Esse link não está disponível. Confere se o endereço está certo.
				</p>
			</main>
		);
	}

	const { event } = data;

	// TODO Epic 5: acesso do convidado (senha do evento) + feed colaborativo.
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-3 px-6 py-10 text-center">
			<div className="flex items-center gap-2">
				<span
					aria-hidden="true"
					className="size-3 shrink-0 rounded-full"
					style={{ backgroundColor: event.colorAccent }}
				/>
			</div>
			<h1 className="text-2xl font-semibold tracking-tight">
				Bem-vindo ao {event.name}!
			</h1>
			<p className="text-sm text-muted-foreground">
				Em breve você vai poder entrar com a senha do evento e ver o feed de
				fotos.
			</p>
		</main>
	);
}
