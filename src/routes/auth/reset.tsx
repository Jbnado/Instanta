import { createFileRoute, Link } from "@tanstack/react-router";

import { ResetRequestForm } from "@/components/feature/auth/reset-request-form";

export const Route = createFileRoute("/auth/reset")({
	component: ResetPage,
});

function ResetPage() {
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
			<header className="space-y-1.5 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">
					Recuperar senha
				</h1>
				<p className="text-sm text-muted-foreground">
					Informe seu email e enviamos um link pra você definir uma nova senha.
				</p>
			</header>

			<ResetRequestForm />

			<p className="text-center text-sm text-muted-foreground">
				Lembrou a senha?{" "}
				<Link
					to="/auth/login"
					className="font-medium text-primary underline-offset-4 hover:underline"
				>
					Voltar ao login
				</Link>
			</p>
		</main>
	);
}
