import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import type { EventPublic } from "@/lib/shared/schemas/event";
import { Button } from "@/components/ui/button";
import { GuestSignupSheet } from "@/components/feature/auth/guest-signup-sheet";

/**
 * Landing do convidado (Stories 3.4 + 5.1 + 5.3).
 *
 * GATE (Story 3.4, R-019): GET /api/events/:slug/public só responde 200 pra eventos
 * Ativos; Inativo/Encerrado/inexistente → 404 → estado genérico "Página não encontrada"
 * (nunca revelamos que um evento Inativo existe).
 *
 * ACESSO (Story 5.1): SEM senha de evento — o slug aleatório (≥60 bits, R-019) JÁ é o
 * segredo. Quando Ativo, mostramos a tela de entrada (nome + cor de acento) com CTA.
 *
 * AUTENTICAÇÃO (Story 5.3): participar exige conta. O loader consulta /api/auth/me em
 * paralelo: se já autenticado, o CTA chama o join direto; senão, abre a GuestSignupSheet
 * (reusa SignupForm/LoginForm da Story 2.1). Após autenticar + join, mostramos o
 * placeholder do feed (o feed real é Epic 7).
 */

type PublicEvent = Pick<EventPublic, "slug" | "name" | "status" | "colorAccent">;

interface EventPublicResponse {
	event: PublicEvent;
}

interface JoinResponse {
	event: PublicEvent;
	firstJoin: boolean;
}

type LoaderData =
	| { found: true; event: PublicEvent; authenticated: boolean }
	| { found: false };

export const Route = createFileRoute("/event/$slug/")({
	loader: async ({ params }): Promise<LoaderData> => {
		// Gate de existência + estado de auth em paralelo (independentes).
		const [publicRes, meRes] = await Promise.all([
			fetch(`/api/events/${params.slug}/public`, { credentials: "include" }),
			fetch("/api/auth/me", { credentials: "include" }).catch(() => null),
		]);

		// 404 (Inativo/Encerrado/inexistente) → not-found genérico (R-019).
		if (!publicRes.ok) {
			return { found: false };
		}
		const body = (await publicRes.json().catch(() => null)) as
			| EventPublicResponse
			| null;
		if (!body?.event) {
			return { found: false };
		}

		// /api/auth/me → 200 quando autenticado (cookie de sessão válido); 401 senão.
		const authenticated = meRes != null && meRes.ok;

		return { found: true, event: body.event, authenticated };
	},
	component: EventGuestLandingPage,
});

function EventGuestLandingPage() {
	const data = Route.useLoaderData();
	const { slug } = Route.useParams();

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

	return (
		<GuestLanding
			slug={slug}
			event={data.event}
			initialAuthenticated={data.authenticated}
		/>
	);
}

type Phase = "landing" | "joining" | "joined" | "error";

/**
 * Tela de entrada do convidado pra um evento Ativo. Orquestra o fluxo:
 *  1. landing  — nome do evento + cor de acento + CTA "Entrar no evento".
 *  2. (se deslogado) GuestSignupSheet sobe → após autenticar, segue pro join.
 *  3. joining  — POST /api/events/:slug/join (membership implícita).
 *  4. joined   — placeholder do feed (Epic 7).
 */
function GuestLanding({
	slug,
	event,
	initialAuthenticated,
}: {
	slug: string;
	event: PublicEvent;
	initialAuthenticated: boolean;
}) {
	const [phase, setPhase] = useState<Phase>("landing");
	const [sheetOpen, setSheetOpen] = useState(false);
	const [authenticated, setAuthenticated] = useState(initialAuthenticated);

	async function doJoin() {
		setPhase("joining");
		let res: Response;
		try {
			res = await fetch(`/api/events/${slug}/join`, {
				method: "POST",
				credentials: "include",
			});
		} catch {
			setPhase("error");
			return;
		}
		if (res.ok) {
			const body = (await res.json().catch(() => null)) as JoinResponse | null;
			if (body?.event) {
				setPhase("joined");
				return;
			}
		}
		// 401 (sessão sumiu) → reabre a sheet; 404/erro → estado de erro genérico.
		if (res.status === 401) {
			setAuthenticated(false);
			setSheetOpen(true);
			setPhase("landing");
			return;
		}
		setPhase("error");
	}

	/** CTA principal: autenticado → join direto; deslogado → abre a sheet. */
	function onEnter() {
		if (authenticated) {
			void doJoin();
		} else {
			setSheetOpen(true);
		}
	}

	/** Disparado pela sheet após signup/login com sucesso → fecha e segue pro join. */
	function onAuthenticated() {
		setAuthenticated(true);
		setSheetOpen(false);
		void doJoin();
	}

	if (phase === "joined") {
		// TODO Epic 7: feed colaborativo real (snap-scroll, banner de novas fotos, +).
		// TODO Story 5.5: WelcomeDisclaimerModal + OnboardingCoachmarks na 1ª entrada.
		// TODO Story 5.6: lista de missões ativas do evento.
		return (
			<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-3 px-6 py-10 text-center">
				<span
					aria-hidden="true"
					className="size-3 shrink-0 rounded-full"
					style={{ backgroundColor: event.colorAccent }}
				/>
				<h1 className="text-2xl font-semibold tracking-tight">
					Você está no {event.name}
				</h1>
				<p className="text-sm text-muted-foreground">O feed chega em breve.</p>
			</main>
		);
	}

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-6 py-10 text-center">
			<span
				aria-hidden="true"
				className="size-3 shrink-0 rounded-full"
				style={{ backgroundColor: event.colorAccent }}
			/>
			<h1 className="text-2xl font-semibold tracking-tight">{event.name}</h1>
			<p className="text-sm text-muted-foreground">
				Você foi convidado pra participar. Entre pra ver e compartilhar as fotos
				do evento.
			</p>

			{phase === "error" ? (
				<p
					role="alert"
					className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
				>
					Não rolou entrar no evento agora. Tenta de novo.
				</p>
			) : null}

			<Button
				type="button"
				size="lg"
				className="w-full"
				onClick={onEnter}
				disabled={phase === "joining"}
			>
				{phase === "joining" ? "Entrando…" : "Entrar no evento"}
			</Button>

			<GuestSignupSheet
				open={sheetOpen}
				eventName={event.name}
				onOpenChange={setSheetOpen}
				onAuthenticated={onAuthenticated}
			/>
		</main>
	);
}
