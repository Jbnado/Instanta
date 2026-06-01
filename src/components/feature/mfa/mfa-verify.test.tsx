import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MfaVerify } from "./mfa-verify";

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

async function submitCode(
	user: ReturnType<typeof userEvent.setup>,
	code: string,
) {
	await user.type(screen.getByLabelText("Código de 6 dígitos"), code);
	const submit = screen.getByRole("button", { name: /verificar/i });
	await waitFor(() => expect(submit).toBeEnabled());
	await user.click(submit);
}

describe("MfaVerify", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("renderiza input com atributos de OTP", () => {
		render(<MfaVerify onVerified={() => {}} />);
		const input = screen.getByLabelText("Código de 6 dígitos");
		expect(input).toHaveAttribute("inputmode", "numeric");
		expect(input).toHaveAttribute("autocomplete", "one-time-code");
	});

	it("submete código → chama verify com payload correto", async () => {
		const user = userEvent.setup();
		vi.mocked(fetch).mockResolvedValue(json({ ok: true }));

		render(<MfaVerify onVerified={() => {}} />);
		await submitCode(user, "123456");

		await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		expect(fetch).toHaveBeenCalledWith(
			"/api/auth/mfa/verify",
			expect.objectContaining({
				method: "POST",
				credentials: "include",
				body: JSON.stringify({ code: "123456" }),
			}),
		);
	});

	it("200 → chama onVerified", async () => {
		const user = userEvent.setup();
		const onVerified = vi.fn();
		vi.mocked(fetch).mockResolvedValue(json({ ok: true }));

		render(<MfaVerify onVerified={onVerified} />);
		await submitCode(user, "123456");

		await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
	});

	it("MFA_REPLAY → mensagem de replay", async () => {
		const user = userEvent.setup();
		vi.mocked(fetch).mockResolvedValue(json({ error: "MFA_REPLAY" }, 400));

		render(<MfaVerify onVerified={() => {}} />);
		await submitCode(user, "123456");

		await waitFor(() => {
			expect(
				screen.getByText(/esse código já foi usado, espere o próximo/i),
			).toBeInTheDocument();
		});
	});

	it("MFA_INVALID_CODE → mensagem de inválido", async () => {
		const user = userEvent.setup();
		vi.mocked(fetch).mockResolvedValue(json({ error: "MFA_INVALID_CODE" }, 400));

		render(<MfaVerify onVerified={() => {}} />);
		await submitCode(user, "000000");

		await waitFor(() => {
			expect(screen.getByText(/^código inválido\.$/i)).toBeInTheDocument();
		});
	});
});
