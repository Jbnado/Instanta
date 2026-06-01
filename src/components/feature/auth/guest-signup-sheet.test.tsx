import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// O LoginForm embutido renderiza o `<Link>` do TanStack ("Esqueci minha senha"),
// que quebra fora de um RouterProvider. Mockamos só esse export por um `<a>` simples
// (mesmo padrão do login-form.test) pra manter a sheet testável isolada.
vi.mock("@tanstack/react-router", () => ({
	Link: ({ to, children }: { to: string; children: ReactNode }) => (
		<a href={to}>{children}</a>
	),
}));

import { GuestSignupSheet } from "./guest-signup-sheet";

// O SignupForm embutido carrega zxcvbn via dynamic import pesado; mockamos como no
// signup-form.test pra manter o jsdom rápido/determinístico.
vi.mock("@zxcvbn-ts/core", () => ({
	zxcvbn: () => ({ score: 3, feedback: { warning: null, suggestions: [] } }),
	zxcvbnOptions: { setOptions: () => {} },
}));
vi.mock("@zxcvbn-ts/language-common", () => ({
	dictionary: {},
	adjacencyGraphs: {},
}));
vi.mock("@zxcvbn-ts/language-pt-br", () => ({
	dictionary: {},
	translations: {},
}));

describe("GuestSignupSheet", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	function renderSheet(overrides: Partial<Parameters<typeof GuestSignupSheet>[0]> = {}) {
		return render(
			<GuestSignupSheet
				open
				eventName="Festa da Ana"
				onOpenChange={() => {}}
				onAuthenticated={() => {}}
				{...overrides}
			/>,
		);
	}

	it("não renderiza conteúdo quando open=false", () => {
		renderSheet({ open: false });
		expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
	});

	it("abre em modo signup com o nome do evento no contexto", () => {
		renderSheet();
		expect(
			screen.getByRole("heading", { name: /crie sua conta pra entrar/i }),
		).toBeInTheDocument();
		expect(screen.getByText(/participar de festa da ana/i)).toBeInTheDocument();
		// Reusa o SignupForm: campos de cadastro presentes.
		expect(screen.getByLabelText("Email")).toBeInTheDocument();
		expect(screen.getByLabelText("Como te chamamos?")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /criar conta/i }),
		).toBeInTheDocument();
	});

	it("alterna pra login e mostra o LoginForm", async () => {
		const user = userEvent.setup();
		renderSheet();
		await user.click(screen.getByRole("button", { name: /^entrar$/i }));
		expect(
			screen.getByRole("heading", { name: /entre na sua conta/i }),
		).toBeInTheDocument();
		// LoginForm: sem campo "Como te chamamos?", com botão Entrar de submit.
		expect(screen.queryByLabelText("Como te chamamos?")).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /^entrar$/i }),
		).toBeInTheDocument();
	});

	it("dispara onAuthenticated após signup com sucesso (201)", async () => {
		const user = userEvent.setup();
		const onAuthenticated = vi.fn();
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			status: 201,
			ok: true,
			json: async () => ({}),
		} as Response);

		renderSheet({ onAuthenticated });

		await user.type(screen.getByLabelText("Email"), "guest@example.com");
		await user.type(screen.getByLabelText("Senha"), "senha123abc");
		await user.type(screen.getByLabelText("Como te chamamos?"), "Convidado");
		await user.click(screen.getByRole("checkbox"));
		await user.click(screen.getByRole("button", { name: /criar conta/i }));

		expect(onAuthenticated).toHaveBeenCalledTimes(1);
	});
});
