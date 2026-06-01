import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MfaSetup } from "./mfa-setup";

const SETUP_BODY = {
	otpauthUri: "otpauth://totp/Instanta:admin?secret=ABC123&issuer=Instanta",
	secret: "ABC123DEF456",
};

const RECOVERY_CODES = ["aaaa-1111", "bbbb-2222", "cccc-3333"];

// Resposta JSON helper.
function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("MfaSetup", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
		// Clipboard usado pelos botões de copiar (não exercitado nestes testes,
		// mas evita crash se algum clique chegar lá).
		vi.stubGlobal("navigator", {
			...navigator,
			clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("monta, chama setup e renderiza QR + secret + input", async () => {
		vi.mocked(fetch).mockResolvedValueOnce(json(SETUP_BODY));

		render(<MfaSetup onConfirmed={() => {}} />);

		// Espera o setup resolver e renderizar o secret manual + input.
		await waitFor(() => {
			expect(screen.getByText(SETUP_BODY.secret)).toBeInTheDocument();
		});

		expect(fetch).toHaveBeenCalledWith(
			"/api/auth/mfa/setup",
			expect.objectContaining({ method: "POST", credentials: "include" }),
		);
		expect(screen.getByLabelText("Código de 6 dígitos")).toBeInTheDocument();
		// QR Code renderizado como SVG com title acessível.
		expect(
			screen.getByTitle("QR Code de configuração do MFA"),
		).toBeInTheDocument();
	});

	it("confirma código válido → chama confirm e mostra recovery codes", async () => {
		const user = userEvent.setup();
		vi.mocked(fetch)
			.mockResolvedValueOnce(json(SETUP_BODY)) // setup
			.mockResolvedValueOnce(json({ recoveryCodes: RECOVERY_CODES })); // confirm

		render(<MfaSetup onConfirmed={() => {}} />);

		await waitFor(() =>
			expect(screen.getByText(SETUP_BODY.secret)).toBeInTheDocument(),
		);

		await user.type(screen.getByLabelText("Código de 6 dígitos"), "123456");
		const submit = screen.getByRole("button", { name: /confirmar/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() => {
			expect(
				screen.getByText(/guarde seus códigos de recuperação/i),
			).toBeInTheDocument();
		});

		// Os códigos aparecem na tela.
		for (const code of RECOVERY_CODES) {
			expect(screen.getByText(code)).toBeInTheDocument();
		}

		// Chamada de confirm com o payload certo.
		expect(fetch).toHaveBeenCalledWith(
			"/api/auth/mfa/confirm",
			expect.objectContaining({
				method: "POST",
				credentials: "include",
				body: JSON.stringify({ code: "123456" }),
			}),
		);
	});

	it("400 MFA_INVALID_CODE → erro inline", async () => {
		const user = userEvent.setup();
		vi.mocked(fetch)
			.mockResolvedValueOnce(json(SETUP_BODY)) // setup
			.mockResolvedValueOnce(json({ error: "MFA_INVALID_CODE" }, 400)); // confirm

		render(<MfaSetup onConfirmed={() => {}} />);

		await waitFor(() =>
			expect(screen.getByText(SETUP_BODY.secret)).toBeInTheDocument(),
		);

		await user.type(screen.getByLabelText("Código de 6 dígitos"), "000000");
		const submit = screen.getByRole("button", { name: /confirmar/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() => {
			expect(screen.getByText(/código inválido, tenta de novo/i)).toBeInTheDocument();
		});
		// Não mostrou recovery codes.
		expect(
			screen.queryByText(/guarde seus códigos de recuperação/i),
		).not.toBeInTheDocument();
	});

	it("chama onConfirmed ao clicar Continuar após recovery codes", async () => {
		const user = userEvent.setup();
		const onConfirmed = vi.fn();
		vi.mocked(fetch)
			.mockResolvedValueOnce(json(SETUP_BODY))
			.mockResolvedValueOnce(json({ recoveryCodes: RECOVERY_CODES }));

		render(<MfaSetup onConfirmed={onConfirmed} />);

		await waitFor(() =>
			expect(screen.getByText(SETUP_BODY.secret)).toBeInTheDocument(),
		);
		await user.type(screen.getByLabelText("Código de 6 dígitos"), "123456");
		const submit = screen.getByRole("button", { name: /confirmar/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() =>
			expect(screen.getByRole("button", { name: /continuar/i })).toBeInTheDocument(),
		);
		await user.click(screen.getByRole("button", { name: /continuar/i }));
		expect(onConfirmed).toHaveBeenCalledTimes(1);
	});
});
