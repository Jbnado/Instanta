import { Link } from "@tanstack/react-router";

/**
 * Lista presentacional dos eventos do anfitrião (Story 3.3, FR11/FR12).
 * Agrupa por status na ordem Inativo → Ativo → Encerrado e, dentro de cada grupo,
 * ordena por data do evento (ascendente). Componente puro — a rota busca os dados
 * e passa via prop, o que mantém a lógica de agrupamento testável isolada.
 */

/** Item da lista (subset de EventDetail que o GET /api/events devolve). */
export interface EventListItem {
	id: string;
	slug: string;
	name: string;
	status: "Inativo" | "Ativo" | "Encerrado";
	colorAccent: string;
	eventDate: string; // ISO
	description: string | null;
}

/** Ordem fixa dos grupos (espelha o AC da Story 3.3). */
const STATUS_ORDER = ["Inativo", "Ativo", "Encerrado"] as const;

/** Rótulos/cor do badge de status (microcopy PT-BR). */
const STATUS_BADGE: Record<
	EventListItem["status"],
	{ label: string; className: string }
> = {
	Inativo: {
		label: "Inativo",
		className: "bg-muted text-muted-foreground",
	},
	Ativo: {
		label: "Ativo",
		className: "bg-primary/15 text-primary",
	},
	Encerrado: {
		label: "Encerrado",
		className: "bg-foreground/10 text-foreground/70",
	},
};

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
	day: "2-digit",
	month: "long",
	year: "numeric",
	// eventDate é "dia inteiro" guardado como meia-noite UTC. Formatar em UTC evita
	// o off-by-one (BRT/UTC-3 voltaria um dia: 2026-07-15 viraria 14).
	timeZone: "UTC",
});

/** Formata o ISO numa data legível PT-BR (ex: "31 de dezembro de 2026"). */
function formatEventDate(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return dateFormatter.format(date);
}

interface Props {
	events: EventListItem[];
}

export function EventList({ events }: Props) {
	// Estado vazio: convida a criar o primeiro evento.
	if (events.length === 0) {
		return (
			<div className="space-y-3 rounded-xl border border-dashed border-input px-5 py-10 text-center">
				<p className="text-sm text-muted-foreground">
					Você ainda não criou eventos.
				</p>
				<Link
					to="/event/create"
					className="inline-block text-sm font-medium text-primary hover:underline"
				>
					Criar meu primeiro evento
				</Link>
			</div>
		);
	}

	return (
		<div className="space-y-8">
			{STATUS_ORDER.map((statusKey) => {
				const group = events
					.filter((e) => e.status === statusKey)
					// Ordena por data (ascendente) dentro do grupo.
					.sort(
						(a, b) =>
							new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime(),
					);

				if (group.length === 0) return null;

				return (
					<section key={statusKey} className="space-y-3">
						<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
							{STATUS_BADGE[statusKey].label}
						</h2>
						<ul className="space-y-2">
							{group.map((event) => (
								<li key={event.id}>
									<Link
										to="/event/$slug/host"
										params={{ slug: event.slug }}
										className="flex items-center gap-3 rounded-xl border border-input px-4 py-3 transition-colors hover:bg-muted/40"
									>
										{/* Dot da cor de acento do evento */}
										<span
											aria-hidden="true"
											className="size-3 shrink-0 rounded-full"
											style={{ backgroundColor: event.colorAccent }}
										/>
										<span className="min-w-0 flex-1">
											<span className="block truncate font-medium">
												{event.name}
											</span>
											<span className="block text-sm text-muted-foreground">
												{formatEventDate(event.eventDate)}
											</span>
										</span>
										<span
											className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[event.status].className}`}
										>
											{STATUS_BADGE[event.status].label}
										</span>
									</Link>
								</li>
							))}
						</ul>
					</section>
				);
			})}
		</div>
	);
}
