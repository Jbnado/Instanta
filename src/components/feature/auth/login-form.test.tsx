import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "./login-form";

const VALID = {
	email: "teste@example.com",
	password: "senha123abc",
};

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
	await user.type(screen.getByLabelText("Email"), VALID.email);
	await user.type(screen.getByLabelText("Senha"), VALID.password);
}

describe("LoginForm", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("renderiza todos os campos", () => {
		render(<LoginForm />);
		expect(screen.getByLabelText("Email")).toBeInTheDocument();
		expect(screen.getByLabelText("Senha")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /entrar/i }),
		).toBeInTheDocument();
	});

	it("mostra erro de validação ao tocar email vazio", async () => {
		const user = userEvent.setup();
		render(<LoginForm />);

		await user.click(screen.getByLabelText("Email"));
		await user.tab();

		await waitFor(() => {
			expect(screen.getByText(/email inválido/i)).toBeInTheDocument();
		});
		expect(screen.getByRole("button", { name: /entrar/i })).toBeDisabled();
	});

	it("envia o payload correto pro endpoint ao submeter válido", async () => {
		const user = userEvent.setup();
		const fetchMock = vi
			.mocked(fetch)
			.mockResolvedValue(new Response(null, { status: 200 }));

		render(<LoginForm onSuccess={() => {}} />);
		await fillValidForm(user);

		const submit = screen.getByRole("button", { name: /entrar/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toBe("/api/auth/login");
		expect(init?.method).toBe("POST");
		expect(init?.credentials).toBe("include");
		expect(JSON.parse(init?.body as string)).toEqual({
			email: VALID.email,
			password: VALID.password,
		});
	});

	it("chama onSuccess no status 200", async () => {
		const user = userEvent.setup();
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
		const onSuccess = vi.fn();

		render(<LoginForm onSuccess={onSuccess} />);
		await fillValidForm(user);

		const submit = screen.getByRole("button", { name: /entrar/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
	});

	it("mostra mensagem genérica no 401 (anti-enumeração)", async () => {
		const user = userEvent.setup();
		vi.mocked(fetch).mockResolvedValue(
			new Response(JSON.stringify({ error: "INVALID_CREDENTIALS" }), {
				status: 401,
				headers: { "Content-Type": "application/json" },
			}),
		);

		render(<LoginForm onSuccess={() => {}} />);
		await fillValidForm(user);

		const submit = screen.getByRole("button", { name: /entrar/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() => {
			expect(screen.getByText(/email ou senha inválidos/i)).toBeInTheDocument();
		});
	});

	it("mostra mensagem de rate limit no 429", async () => {
		const user = userEvent.setup();
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 429 }));

		render(<LoginForm onSuccess={() => {}} />);
		await fillValidForm(user);

		const submit = screen.getByRole("button", { name: /entrar/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() => {
			expect(screen.getByText(/muitas tentativas/i)).toBeInTheDocument();
		});
	});
});
