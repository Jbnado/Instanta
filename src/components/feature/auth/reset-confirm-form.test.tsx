import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// O ResetConfirmForm usa o `<Link>` do TanStack no estado de token inválido.
// Fora de um RouterProvider o Link quebra, então mockamos só esse export por um
// `<a>` simples — mantém o form testável isolado, sem montar router de verdade.
vi.mock("@tanstack/react-router", () => ({
	Link: ({ to, children }: { to: string; children: ReactNode }) => (
		<a href={to}>{children}</a>
	),
}));

import { ResetConfirmForm } from "./reset-confirm-form";

const TOKEN = "tok_abc123";
const VALID_PASSWORD = "senha123abc";

function renderWithRouter(ui: ReactNode) {
	return render(ui);
}

describe("ResetConfirmForm", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("renderiza o campo de nova senha", () => {
		renderWithRouter(<ResetConfirmForm token={TOKEN} />);
		expect(screen.getByLabelText("Nova senha")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /definir nova senha/i }),
		).toBeInTheDocument();
	});

	it("envia { token, password } pro endpoint ao submeter válido", async () => {
		const user = userEvent.setup();
		const fetchMock = vi
			.mocked(fetch)
			.mockResolvedValue(new Response(null, { status: 200 }));

		renderWithRouter(<ResetConfirmForm token={TOKEN} onSuccess={() => {}} />);
		await user.type(screen.getByLabelText("Nova senha"), VALID_PASSWORD);

		const submit = screen.getByRole("button", { name: /definir nova senha/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toBe("/api/auth/reset-confirm");
		expect(init?.method).toBe("POST");
		expect(init?.credentials).toBe("include");
		expect(JSON.parse(init?.body as string)).toEqual({
			token: TOKEN,
			password: VALID_PASSWORD,
		});
	});

	it("chama onSuccess no status 200", async () => {
		const user = userEvent.setup();
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
		const onSuccess = vi.fn();

		renderWithRouter(<ResetConfirmForm token={TOKEN} onSuccess={onSuccess} />);
		await user.type(screen.getByLabelText("Nova senha"), VALID_PASSWORD);

		const submit = screen.getByRole("button", { name: /definir nova senha/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
	});

	it("mostra 'Link expirado ou inválido' no 400 INVALID_RESET_TOKEN", async () => {
		const user = userEvent.setup();
		vi.mocked(fetch).mockResolvedValue(
			new Response(JSON.stringify({ error: "INVALID_RESET_TOKEN" }), {
				status: 400,
				headers: { "Content-Type": "application/json" },
			}),
		);

		renderWithRouter(<ResetConfirmForm token={TOKEN} onSuccess={() => {}} />);
		await user.type(screen.getByLabelText("Nova senha"), VALID_PASSWORD);

		const submit = screen.getByRole("button", { name: /definir nova senha/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() => {
			expect(
				screen.getByText(/link expirado ou inválido/i),
			).toBeInTheDocument();
		});
	});

	it("mostra rate limit no 429", async () => {
		const user = userEvent.setup();
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 429 }));

		renderWithRouter(<ResetConfirmForm token={TOKEN} onSuccess={() => {}} />);
		await user.type(screen.getByLabelText("Nova senha"), VALID_PASSWORD);

		const submit = screen.getByRole("button", { name: /definir nova senha/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() => {
			expect(screen.getByText(/muitas tentativas/i)).toBeInTheDocument();
		});
	});
});
