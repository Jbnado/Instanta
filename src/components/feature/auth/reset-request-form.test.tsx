import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	RESET_CONFIRMATION_MESSAGE,
	ResetRequestForm,
} from "./reset-request-form";

const VALID_EMAIL = "teste@example.com";

describe("ResetRequestForm", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("renderiza o campo de email", () => {
		render(<ResetRequestForm />);
		expect(screen.getByLabelText("Email")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /enviar link/i }),
		).toBeInTheDocument();
	});

	it("envia o email pro endpoint ao submeter válido", async () => {
		const user = userEvent.setup();
		const fetchMock = vi
			.mocked(fetch)
			.mockResolvedValue(new Response(null, { status: 200 }));

		render(<ResetRequestForm />);
		await user.type(screen.getByLabelText("Email"), VALID_EMAIL);

		const submit = screen.getByRole("button", { name: /enviar link/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toBe("/api/auth/reset");
		expect(init?.method).toBe("POST");
		expect(init?.credentials).toBe("include");
		expect(JSON.parse(init?.body as string)).toEqual({ email: VALID_EMAIL });
	});

	it("mostra a confirmação idêntica no sucesso (200)", async () => {
		const user = userEvent.setup();
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));

		render(<ResetRequestForm />);
		await user.type(screen.getByLabelText("Email"), VALID_EMAIL);

		const submit = screen.getByRole("button", { name: /enviar link/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() => {
			expect(screen.getByText(RESET_CONFIRMATION_MESSAGE)).toBeInTheDocument();
		});
	});

	it("mostra a MESMA confirmação no 404 (anti-enumeração, nunca revela)", async () => {
		const user = userEvent.setup();
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));

		render(<ResetRequestForm />);
		await user.type(screen.getByLabelText("Email"), VALID_EMAIL);

		const submit = screen.getByRole("button", { name: /enviar link/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() => {
			expect(screen.getByText(RESET_CONFIRMATION_MESSAGE)).toBeInTheDocument();
		});
	});

	it("mostra a MESMA confirmação no 500 (anti-enumeração)", async () => {
		const user = userEvent.setup();
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }));

		render(<ResetRequestForm />);
		await user.type(screen.getByLabelText("Email"), VALID_EMAIL);

		const submit = screen.getByRole("button", { name: /enviar link/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() => {
			expect(screen.getByText(RESET_CONFIRMATION_MESSAGE)).toBeInTheDocument();
		});
	});

	it("mostra rate limit no 429 (não vaza existência)", async () => {
		const user = userEvent.setup();
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 429 }));

		render(<ResetRequestForm />);
		await user.type(screen.getByLabelText("Email"), VALID_EMAIL);

		const submit = screen.getByRole("button", { name: /enviar link/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() => {
			expect(screen.getByText(/muitas tentativas/i)).toBeInTheDocument();
		});
	});
});
