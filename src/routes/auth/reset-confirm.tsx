import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { ResetConfirmForm } from "@/components/feature/auth/reset-confirm-form";

/**
 * Confirmação de reset (Story 2.5). O token chega na query string do link do
 * email: `/auth/reset-confirm?token=...`. Usamos `validateSearch` pra tipar e
 * parsear o param, e `Route.useSearch()` pra lê-lo no componente.
 */
export const Route = createFileRoute("/auth/reset-confirm")({
	validateSearch: (search: Record<string, unknown>): { token?: string } => {
		const token = search.token;
		return { token: typeof token === "string" ? token : undefined };
	},
	component: ResetConfirmPage,
});

function ResetConfirmPage() {
	const navigate = useNavigate();
	const { token } = Route.useSearch();

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
			<header className="space-y-1.5 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">
					Definir nova senha
				</h1>
				<p className="text-sm text-muted-foreground">
					Escolha uma senha nova pra sua conta.
				</p>
			</header>

			{token ? (
				<ResetConfirmForm
					token={token}
					onSuccess={() => navigate({ to: "/auth/login" })}
				/>
			) : (
				// Sem token na URL → link inválido. Não renderiza o form (não há o que
				// enviar). Mesma microcopy do token expirado/inválido (Story 2.5).
				<div
					role="alert"
					className="space-y-3 rounded-lg bg-destructive/10 px-4 py-5 text-center text-sm text-destructive"
				>
					<p className="font-medium">
						Link expirado ou inválido. Solicite um novo.
					</p>
					<Link
						to="/auth/reset"
						className="inline-block font-medium underline underline-offset-4"
					>
						Solicitar novo link
					</Link>
				</div>
			)}
		</main>
	);
}
