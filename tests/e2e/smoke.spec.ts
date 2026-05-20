import { expect, test } from "@playwright/test";

// Smoke E2E — sobe Vite via webServer, navega na home, asserta title.
// Esta é a prova mínima de que Playwright vê a app rodando.
test("home carrega com title Instanta", async ({ page }) => {
	await page.goto("/");
	await expect(page).toHaveTitle(/Instanta/i);
});
