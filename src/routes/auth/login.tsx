import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { LoginForm } from "@/components/feature/auth/login-form";

export const Route = createFileRoute("/auth/login")({
	component: LoginPage,
});

function LoginPage() {
	const navigate = useNavigate();

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
			<header className="space-y-1.5 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">
					Entrar no Instanta
				</h1>
				<p className="text-sm text-muted-foreground">
					Bem-vindo de volta. Continue de onde parou.
				</p>
			</header>

			<LoginForm onSuccess={() => navigate({ to: "/" })} />
		</main>
	);
}
