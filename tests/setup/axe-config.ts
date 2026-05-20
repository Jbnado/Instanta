import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

// WCAG 2.1 AA conforme NFR31. Tags incluem A e AA dos níveis 2.0 e 2.1.
// Lista de excludes vazia por enquanto — se algum smoke quebrar por componente
// terceiro, documentar aqui com link pro issue.
export function makeAxeBuilder(page: Page) {
	return new AxeBuilder({ page }).withTags([
		"wcag2a",
		"wcag2aa",
		"wcag21a",
		"wcag21aa",
	]);
}
