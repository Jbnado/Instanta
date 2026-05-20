import { expect, test } from "@playwright/test";

import { makeAxeBuilder } from "../setup/axe-config";

// Smoke a11y — roda axe-core na home com tags WCAG 2.1 AA (NFR31).
// Falha se houver violation. Conforme a Story 1.3, este test é "smoke" pra provar
// a infra; cobertura a11y completa cresce a cada feature que entrar.
test("home não tem violations WCAG 2.1 AA", async ({ page }) => {
	await page.goto("/");
	const results = await makeAxeBuilder(page).analyze();
	expect(results.violations).toEqual([]);
});
