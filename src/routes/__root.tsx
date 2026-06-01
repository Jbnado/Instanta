import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";

import { InAppBrowserWarning } from "@/react-app/components/shell/in-app-browser-warning";

/**
 * Shell raiz do roteador. Tudo que é global (aviso de in-app browser, futuros
 * providers de tema/toast) mora aqui. As rotas filhas renderizam no <Outlet />.
 */
export const Route = createRootRoute({
	component: RootLayout,
});

function RootLayout() {
	return (
		<>
			<InAppBrowserWarning />
			<Outlet />
			{/* Devtools só no bundle de dev — `import.meta.env.DEV` é tree-shaken em prod. */}
			{import.meta.env.DEV ? <TanStackRouterDevtools position="bottom-right" /> : null}
		</>
	);
}
