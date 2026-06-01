import { createFileRoute } from "@tanstack/react-router";

/**
 * Painel admin — placeholder da Story 2.7/2.8.
 *
 * Só é alcançável quando o gate do layout (`route.tsx`) passou: usuário
 * autenticado + role admin + MFA configurado + verificado nesta sessão.
 * O conteúdo real do painel vem na Epic 4.
 */
export const Route = createFileRoute("/admin/")({
	component: AdminPanelPage,
});

function AdminPanelPage() {
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-6 py-10 text-center">
			<h1 className="text-2xl font-semibold tracking-tight">Painel admin</h1>
			<p className="text-sm text-muted-foreground">
				Em construção. Por aqui você vai gerenciar eventos, usuários e
				configurações da plataforma.
			</p>
		</main>
	);
}
