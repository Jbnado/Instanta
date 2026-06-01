import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createRouter, RouterProvider } from "@tanstack/react-router";

import { routeTree } from "../routeTree.gen";
import { loadClarity } from "./lib/clarity.ts";
import "./index.css";

const router = createRouter({ routeTree });

// Type augmentation do TanStack Router — dá type-safety nas rotas/links.
declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<RouterProvider router={router} />
	</StrictMode>,
);

// Clarity: env-gated (prod-only) + lazy após hidratação React. Build-time
// substitui `import.meta.env.VITE_CLARITY_PROJECT_ID` por string literal
// (dev = undefined → no-op).
if (import.meta.env.PROD) {
	const projectId = import.meta.env.VITE_CLARITY_PROJECT_ID as string | undefined;
	if (projectId) {
		const enqueue = (cb: () => void) =>
			"requestIdleCallback" in window
				? window.requestIdleCallback(cb, { timeout: 2000 })
				: setTimeout(cb, 0);
		enqueue(() => loadClarity(projectId));
	}
}
