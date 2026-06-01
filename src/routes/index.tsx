import { createFileRoute, Link } from "@tanstack/react-router";

import { A11ySettings } from "@/components/feature/settings/a11y-settings";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/feature/auth/logout-button";

/**
 * Home auth-aware (Story 2.x). O loader consulta GET /api/auth/me:
 *  - 200 → usuário logado → painel do anfitrião (criar/listar eventos + sair);
 *  - 401 (ou erro de rede) → deslogado → landing com signup/login.
 *
 * Não é uma lista de botões de debug: cada estado mostra só os CTAs que fazem
 * sentido pra quem está vendo. As telas de login/signup são rotas próprias
 * (/auth/login, /auth/signup) — aqui só decidimos pra onde mandar.
 */

interface MeUser {
	id: string;
	email: string;
	displayName: string | null;
	role: string;
}

interface MeResponse {
	user: MeUser;
}

type HomeAuth = { user: MeUser } | { user: null };

export const Route = createFileRoute("/")({
	loader: async (): Promise<HomeAuth> => {
		let res: Response;
		try {
			res = await fetch("/api/auth/me", { credentials: "include" });
		} catch {
			// Sem rede / backend fora do ar: trata como deslogado (landing pública).
			return { user: null };
		}

		if (!res.ok) {
			// 401 e qualquer outro não-ok → deslogado.
			return { user: null };
		}

		const body = (await res.json().catch(() => null)) as MeResponse | null;
		return { user: body?.user ?? null };
	},
	component: HomePage,
});

function HomePage() {
	const { user } = Route.useLoaderData();

	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-8 px-6 py-10 text-center">
			{user ? <LoggedInView user={user} /> : <LoggedOutView />}

			{/* A11ySettings (Story 2.9): toggle de tema, presente em ambos os estados. */}
			<footer className="w-full border-t border-border pt-6">
				<A11ySettings />
			</footer>
		</main>
	);
}

/** Estado deslogado: landing pública com signup + login. */
function LoggedOutView() {
	return (
		<>
			<div className="space-y-2">
				<h1 className="text-3xl font-semibold tracking-tight">Instanta</h1>
				<p className="text-muted-foreground">
					O feed colaborativo de fotos do seu evento, ao vivo.
				</p>
			</div>

			<div className="flex w-full flex-col gap-3">
				<Button asChild size="lg">
					<Link to="/auth/signup">Criar conta</Link>
				</Button>

				<Button asChild variant="outline" size="lg">
					<Link to="/auth/login">Entrar</Link>
				</Button>
			</div>
		</>
	);
}

/** Estado logado: saudação + atalhos de anfitrião + sair. */
function LoggedInView({ user }: { user: MeUser }) {
	const name = user.displayName?.trim() || "anfitrião";

	return (
		<>
			<div className="space-y-2">
				<h1 className="text-3xl font-semibold tracking-tight">
					Olá, {name}
				</h1>
				<p className="text-muted-foreground">
					Pronto pro próximo evento? Monte o setup ou veja os que já criou.
				</p>
			</div>

			<div className="flex w-full flex-col gap-3">
				<Button asChild size="lg">
					<Link to="/event/create">Criar evento</Link>
				</Button>

				<Button asChild variant="outline" size="lg">
					<Link to="/account/events">Meus eventos</Link>
				</Button>

				<LogoutButton />
			</div>
		</>
	);
}
