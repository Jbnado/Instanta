import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { SignupForm } from "@/components/feature/auth/signup-form";

export const Route = createFileRoute("/auth/signup")({
	component: SignupPage,
});

function SignupPage() {
	const navigate = useNavigate();

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
			<header className="space-y-1.5 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">
					Criar conta no Instanta
				</h1>
				<p className="text-sm text-muted-foreground">
					É rapidinho. Depois você já entra no feed do evento.
				</p>
			</header>

			<SignupForm onSuccess={() => navigate({ to: "/" })} />
		</main>
	);
}
