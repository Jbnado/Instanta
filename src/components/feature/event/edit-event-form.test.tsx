import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditEventForm } from "./edit-event-form";
import type { EventDetail } from "@/lib/shared/schemas/event";

/** Fixture: evento Inativo com 1 preset + 1 missão personalizada. */
const EVENT: EventDetail = {
	id: "evt_1",
	slug: "aniversario-da-ana",
	name: "Aniversário da Ana",
	status: "Inativo",
	colorAccent: "#3B82F6", // Azul
	eventDate: "2026-12-31T00:00:00.000Z",
	description: "Festa surpresa",
	missions: [
		{ id: "m1", label: "Selfie com o anfitrião", isPreset: true },
		{ id: "m2", label: "Foto com o mascote", isPreset: false },
	],
};

/** Resposta 200 do PATCH (devolve o EventDetail atualizado). */
function okResponse(overrides: Partial<EventDetail> = {}) {
	return new Response(JSON.stringify({ event: { ...EVENT, ...overrides } }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

describe("EditEventForm", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("prefilla nome, data, cor e missões a partir do EventDetail", () => {
		render(<EditEventForm event={EVENT} />);

		expect(screen.getByLabelText("Nome do evento")).toHaveValue(
			"Aniversário da Ana",
		);
		expect(screen.getByLabelText("Data do evento")).toHaveValue("2026-12-31");

		// Cor de acento: o swatch Azul vem marcado.
		const swatches = screen.getByRole("radiogroup", { name: /cor de acento/i });
		expect(within(swatches).getByRole("radio", { name: "Azul" })).toHaveAttribute(
			"aria-checked",
			"true",
		);

		// Preset casado por label vem checado; a personalizada aparece na lista.
		expect(screen.getByLabelText("Selfie com o anfitrião")).toBeChecked();
		expect(screen.getByText("Foto com o mascote")).toBeInTheDocument();
	});

	it("envia PATCH com o nome alterado (sem campo de senha)", async () => {
		const user = userEvent.setup();
		const fetchMock = vi.mocked(fetch).mockResolvedValue(okResponse());

		render(<EditEventForm event={EVENT} />);

		const nameInput = screen.getByLabelText("Nome do evento");
		await user.clear(nameInput);
		await user.type(nameInput, "Aniversário da Bia");

		const submit = screen.getByRole("button", { name: /salvar alterações/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toBe("/api/events/aniversario-da-ana");
		expect(init?.method).toBe("PATCH");
		expect(init?.credentials).toBe("include");

		const body = JSON.parse(init?.body as string);
		expect(body.name).toBe("Aniversário da Bia");
		// Senha de evento foi abolida — não existe campo nem vai no payload.
		expect(body).not.toHaveProperty("password");
		expect(screen.queryByLabelText("Senha do evento")).not.toBeInTheDocument();
	});

	it("chama onSaved e mostra confirmação no 200", async () => {
		const user = userEvent.setup();
		vi.mocked(fetch).mockResolvedValue(okResponse({ name: "Aniversário da Bia" }));
		const onSaved = vi.fn();

		render(<EditEventForm event={EVENT} onSaved={onSaved} />);

		const nameInput = screen.getByLabelText("Nome do evento");
		await user.clear(nameInput);
		await user.type(nameInput, "Aniversário da Bia");

		const submit = screen.getByRole("button", { name: /salvar alterações/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() =>
			expect(screen.getByText(/alterações salvas/i)).toBeInTheDocument(),
		);
		expect(onSaved).toHaveBeenCalledTimes(1);
		expect(onSaved.mock.calls[0]![0].name).toBe("Aniversário da Bia");
	});

	it("mostra erro de não encontrado no 404", async () => {
		const user = userEvent.setup();
		vi.mocked(fetch).mockResolvedValue(
			new Response(JSON.stringify({ error: "NOT_FOUND" }), {
				status: 404,
				headers: { "Content-Type": "application/json" },
			}),
		);

		render(<EditEventForm event={EVENT} />);

		const submit = screen.getByRole("button", { name: /salvar alterações/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() =>
			expect(screen.getByText(/evento não encontrado/i)).toBeInTheDocument(),
		);
	});
});
