import { createFileRoute, Link } from "@tanstack/react-router";

import { A11ySettings } from "@/components/feature/settings/a11y-settings";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/feature/auth/logout-button";

/**
 * Home placeholder. A UI real do feed/eventos chega nas Epics 3/5/7.
 * Por enquanto serve só de ponto de entrada pro fluxo de auth.
 */
export const Route = createFileRoute("/")({
	component: HomePage,
});

function HomePage() {
	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
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

				{/* Atalho pro setup de evento (Story 3.1). A rota é auth-gated:
				    quem não estiver logado cai no /auth/login pelo beforeLoad. */}
				<Button asChild variant="ghost" size="lg">
					<Link to="/event/create">Criar evento</Link>
				</Button>

				{/* Logout sempre disponível: o endpoint 401 graciosamente se não houver
				    sessão. Affordance mínima até a Epic 3/5 trazer o header real. */}
				<LogoutButton />
			</div>

			{/* A11ySettings (Story 2.9): por ora hospeda só o toggle de tema. */}
			<A11ySettings />
		</main>
	);
}
