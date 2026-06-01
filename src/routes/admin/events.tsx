import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";

/**
 * Superfície de ativação de eventos (Story 3.4, FR53) — semente do dashboard
 * admin da Epic 4. Roda sob o gate de `/admin` (route.tsx): admin + MFA.
 *
 * Lista os eventos pendentes (status Inativo) ordenados por data e permite
 * ativar cada um via POST /api/admin/events/:slug/activate. No 200 a linha some
 * (o evento deixou de estar pendente); erros aparecem inline na própria linha.
 */

/** Item da lista de pendentes vindo de GET /api/admin/events. */
interface PendingEvent {
	id: string;
	slug: string;
	name: string;
	eventDate: string; // ISO
	status: string;
	hostEmail: string;
	hostName: string | null;
	missionCount: number;
}

interface PendingEventsResponse {
	events: PendingEvent[];
}

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

export const Route = createFileRoute("/admin/events")({
	loader: async (): Promise<PendingEvent[]> => {
		const res = await fetch("/api/admin/events", { credentials: "include" });
		if (!res.ok) {
			// Falha de carga: lista vazia (o gate já garante admin+MFA; aqui é
			// defensivo contra erro transitório do backend).
			return [];
		}
		const body = (await res.json().catch(() => null)) as
			| PendingEventsResponse
			| null;
		const events = body?.events ?? [];
		// Ordena por data do evento (ascendente).
		return [...events].sort(
			(a, b) =>
				new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime(),
		);
	},
	component: AdminEventsPage,
});

/** Estado de ativação por linha (chaveado pelo slug). */
type RowStatus =
	| { kind: "idle" }
	| { kind: "activating" }
	| { kind: "error"; message: string };

function AdminEventsPage() {
	const initial = Route.useLoaderData();
	const [events, setEvents] = useState<PendingEvent[]>(initial);
	const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});

	function setStatus(slug: string, status: RowStatus) {
		setRowStatus((prev) => ({ ...prev, [slug]: status }));
	}

	async function activate(slug: string) {
		setStatus(slug, { kind: "activating" });

		let res: Response;
		try {
			res = await fetch(`/api/admin/events/${slug}/activate`, {
				method: "POST",
				credentials: "include",
			});
		} catch {
			setStatus(slug, {
				kind: "error",
				message: "Sem conexão. Tenta de novo.",
			});
			return;
		}

		// 200 → ativado. Remove da lista de pendentes.
		if (res.ok) {
			setEvents((prev) => prev.filter((e) => e.slug !== slug));
			return;
		}

		// 400 INVALID_STATE → não estava Inativo (ex: já ativado noutra aba).
		if (res.status === 400) {
			setStatus(slug, {
				kind: "error",
				message: "Esse evento não pode ser ativado (não está inativo).",
			});
			return;
		}

		if (res.status === 404) {
			setStatus(slug, { kind: "error", message: "Evento não encontrado." });
			return;
		}

		// 401/403 → sessão/permissão; 500 → backend. Mensagem genérica.
		setStatus(slug, {
			kind: "error",
			message: "Não foi possível ativar agora. Tenta de novo.",
		});
	}

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-6 py-10">
			<header className="space-y-1">
				<h1 className="text-2xl font-semibold tracking-tight">
					Eventos aguardando ativação
				</h1>
				<p className="text-sm text-muted-foreground">
					Revise e ative os eventos criados pelos anfitriões. Ativar gera o QR
					Code, o link de convite e dispara o email pro anfitrião.
				</p>
			</header>

			{events.length === 0 ? (
				<div className="rounded-xl border border-dashed border-input px-5 py-10 text-center text-sm text-muted-foreground">
					Nenhum evento aguardando ativação.
				</div>
			) : (
				<ul className="space-y-2">
					{events.map((event) => {
						const status = rowStatus[event.slug] ?? { kind: "idle" };
						const activating = status.kind === "activating";
						return (
							<li
								key={event.id}
								className="flex flex-col gap-3 rounded-xl border border-input px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
							>
								<div className="min-w-0 flex-1 space-y-0.5">
									<p className="truncate font-medium">{event.name}</p>
									<p className="text-sm text-muted-foreground">
										{formatEventDate(event.eventDate)} · {event.missionCount}{" "}
										{event.missionCount === 1 ? "missão" : "missões"}
									</p>
									<p className="truncate text-sm text-muted-foreground">
										{event.hostName ? `${event.hostName} · ` : ""}
										{event.hostEmail}
									</p>
									{status.kind === "error" ? (
										<p
											role="alert"
											className="text-sm text-destructive"
										>
											{status.message}
										</p>
									) : null}
								</div>
								<Button
									type="button"
									size="sm"
									disabled={activating}
									onClick={() => activate(event.slug)}
									className="shrink-0"
								>
									{activating ? "Ativando…" : "Ativar"}
								</Button>
							</li>
						);
					})}
				</ul>
			)}
		</main>
	);
}
