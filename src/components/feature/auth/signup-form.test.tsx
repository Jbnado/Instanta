import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SignupForm } from "./signup-form";

// zxcvbn carrega via dynamic import() pesado; mockamos pra não baixar dicionário
// nos testes de unidade e manter o jsdom rápido/determinístico.
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

const VALID = {
	email: "teste@example.com",
	password: "senha123abc",
	displayName: "Teste",
};

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
	await user.type(screen.getByLabelText("Email"), VALID.email);
	await user.type(screen.getByLabelText("Senha"), VALID.password);
	await user.type(screen.getByLabelText("Como te chamamos?"), VALID.displayName);
	await user.click(screen.getByRole("checkbox"));
}

describe("SignupForm", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("renderiza todos os campos", () => {
		render(<SignupForm />);
		expect(screen.getByLabelText("Email")).toBeInTheDocument();
		expect(screen.getByLabelText("Senha")).toBeInTheDocument();
		expect(screen.getByLabelText("Como te chamamos?")).toBeInTheDocument();
		expect(screen.getByRole("checkbox")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /criar conta/i }),
		).toBeInTheDocument();
	});

	it("mostra erros de validação ao tentar avançar com campos vazios", async () => {
		const user = userEvent.setup();
		render(<SignupForm />);

		// Submit começa desabilitado (isValid === false). Tocamos os campos pra
		// disparar a validação onTouched e revelar as mensagens.
		await user.click(screen.getByLabelText("Email"));
		await user.click(screen.getByLabelText("Senha"));
		await user.tab();

		await waitFor(() => {
			expect(screen.getByText(/email inválido/i)).toBeInTheDocument();
		});
		expect(screen.getByRole("button", { name: /criar conta/i })).toBeDisabled();
	});

	it("mostra erro inline quando a senha é curta demais (no blur)", async () => {
		const user = userEvent.setup();
		render(<SignupForm />);

		await user.type(screen.getByLabelText("Senha"), "123");
		await user.tab();

		await waitFor(() => {
			expect(
				screen.getByText(/pelo menos 8 caracteres/i),
			).toBeInTheDocument();
		});
	});

	it("envia o payload correto pro endpoint ao submeter válido", async () => {
		const user = userEvent.setup();
		const fetchMock = vi
			.mocked(fetch)
			.mockResolvedValue(new Response(null, { status: 201 }));

		render(<SignupForm onSuccess={() => {}} />);
		await fillValidForm(user);

		const submit = screen.getByRole("button", { name: /criar conta/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toBe("/api/auth/signup");
		expect(init?.method).toBe("POST");
		expect(init?.credentials).toBe("include");
		expect(JSON.parse(init?.body as string)).toEqual({
			email: VALID.email,
			password: VALID.password,
			displayName: VALID.displayName,
			termsAccepted: true,
		});
	});

	it("chama onSuccess no status 201", async () => {
		const user = userEvent.setup();
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 201 }));
		const onSuccess = vi.fn();

		render(<SignupForm onSuccess={onSuccess} />);
		await fillValidForm(user);

		const submit = screen.getByRole("button", { name: /criar conta/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
	});

	it("mostra erro inline no email quando o servidor responde EMAIL_EXISTS", async () => {
		const user = userEvent.setup();
		vi.mocked(fetch).mockResolvedValue(
			new Response(JSON.stringify({ error: "EMAIL_EXISTS" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);

		render(<SignupForm onSuccess={() => {}} />);
		await fillValidForm(user);

		const submit = screen.getByRole("button", { name: /criar conta/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() => {
			expect(
				screen.getByText(/esse email já tem conta/i),
			).toBeInTheDocument();
		});
	});
});
