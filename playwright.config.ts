import { defineConfig, devices } from "@playwright/test";

// Playwright config — testes E2E ficam em `tests/e2e/`. WebServer sobe Vite (pnpm dev)
// e Wrangler junto via plugin Cloudflare. Em CI usar `reuseExistingServer: false`.
export default defineConfig({
	testDir: "./tests/e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? "github" : "html",
	timeout: 30_000,
	expect: { timeout: 5_000 },
	use: {
		baseURL: "http://localhost:5173",
		trace: "on-first-retry",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		{ name: "webkit", use: { ...devices["Desktop Safari"] } },
	],
	webServer: {
		command: "pnpm dev",
		url: "http://localhost:5173",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
