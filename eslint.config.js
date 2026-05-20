import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{ ignores: ["dist", ".wrangler", "node_modules", "coverage", "playwright-report", "test-results"] },
	{
		extends: [js.configs.recommended, ...tseslint.configs.recommended],
		files: ["**/*.{ts,tsx}"],
		languageOptions: {
			ecmaVersion: 2020,
			globals: globals.browser,
		},
		plugins: {
			"react-hooks": reactHooks,
			"react-refresh": reactRefresh,
		},
		rules: {
			...reactHooks.configs.recommended.rules,
			"react-refresh/only-export-components": [
				"warn",
				{ allowConstantExport: true },
			],
		},
	},
	// Boundary guard: services puros (sem HTTP, sem CF runtime, sem cross-imports de routes/middleware).
	// Permite testar com Vitest sem subir Worker e protege a separação de camadas (ADD-3).
	{
		files: ["src/server/services/**/*.{ts,tsx}"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "hono",
							message: "services puros não usam HTTP — mantenha Hono em src/server/routes/",
						},
						{
							name: "@cloudflare/workers-types",
							message: "services puros não conhecem o runtime CF — encapsule em src/server/adapters/",
						},
					],
					patterns: [
						{
							group: ["hono/*"],
							message: "services puros não usam Hono (nem sub-paths) — mantenha em src/server/routes/",
						},
						{
							group: ["cloudflare:*"],
							message: "services puros não importam built-ins do runtime CF — encapsule em src/server/adapters/",
						},
						{
							group: ["**/routes/**"],
							message: "services não dependem de routes (inversão errada).",
						},
						{
							group: ["**/middleware/**"],
							message: "services não dependem de middleware (inversão errada).",
						},
					],
				},
			],
		},
	},
);
