import { createFileRoute, Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";

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

				{/* Login chega na Story 2.2 — desabilitado por enquanto. */}
				<Button variant="outline" size="lg" disabled title="Em breve">
					Entrar
				</Button>
			</div>
		</main>
	);
}
