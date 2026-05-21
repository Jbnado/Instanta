import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.tsx";
import { loadClarity } from "./lib/clarity.ts";
import "./index.css";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
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
