import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
	plugins: [react(), cloudflare(), tailwindcss()],
	resolve: {
		// Ordem importa: aliases mais específicos antes do prefixo curto `@`,
		// senão Vite faria match no primeiro e `@shared/x` cairia em `src/x`.
		alias: [
			{ find: /^@shared\//, replacement: fileURLToPath(new URL("./src/shared/", import.meta.url)) },
			{ find: /^@server\//, replacement: fileURLToPath(new URL("./src/server/", import.meta.url)) },
			{ find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) },
		],
	},
});
