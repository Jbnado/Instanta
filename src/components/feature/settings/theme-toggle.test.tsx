import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeToggle } from "./theme-toggle";
import { useThemeStore } from "@/stores/theme-store";

beforeEach(() => {
	localStorage.clear();
	document.documentElement.classList.remove("dark");
	// Estado conhecido entre testes (store é singleton de módulo).
	useThemeStore.setState({ theme: "light" });
	document.documentElement.classList.remove("dark");
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("ThemeToggle", () => {
	it("renderiza um botão acessível com aria-label PT-BR", () => {
		render(<ThemeToggle />);
		const btn = screen.getByRole("button", { name: "Ativar tema escuro" });
		expect(btn).toBeInTheDocument();
	});

	it("reflete aria-pressed=false quando o tema está claro", () => {
		useThemeStore.setState({ theme: "light" });
		render(<ThemeToggle />);
		expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
	});

	it("reflete aria-pressed=true quando o tema está escuro", () => {
		useThemeStore.setState({ theme: "dark" });
		render(<ThemeToggle />);
		const btn = screen.getByRole("button", { name: "Ativar tema claro" });
		expect(btn).toHaveAttribute("aria-pressed", "true");
	});

	it("ao clicar, alterna o tema no store e aplica .dark no <html>", async () => {
		const user = userEvent.setup();
		render(<ThemeToggle />);

		expect(useThemeStore.getState().theme).toBe("light");

		await user.click(screen.getByRole("button"));

		expect(useThemeStore.getState().theme).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
		// Após o toggle, o label reflete a próxima ação.
		expect(
			screen.getByRole("button", { name: "Ativar tema claro" }),
		).toHaveAttribute("aria-pressed", "true");
	});
});
