import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CloseEventButton } from "./close-event-button";
import type { EventDetail } from "@/lib/shared/schemas/event";

/** Evento Ativo devolvido como Encerrado no 200 do POST /close. */
const CLOSED_EVENT: EventDetail = {
	id: "evt_1",
	slug: "aniversario-da-ana",
	name: "Aniversário da Ana",
	status: "Encerrado",
	colorAccent: "#3B82F6",
	eventDate: "2026-12-31T00:00:00.000Z",
	description: null,
	missions: [],
};

function okResponse() {
	return new Response(JSON.stringify({ event: CLOSED_EVENT }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

function invalidStateResponse() {
	return new Response(JSON.stringify({ error: "INVALID_STATE" }), {
		status: 400,
		headers: { "Content-Type": "application/json" },
	});
}

describe("CloseEventButton", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("abre o AlertDialog de confirmação ao clicar em Encerrar evento", async () => {
		const user = userEvent.setup();
		render(<CloseEventButton slug="aniversario-da-ana" />);

		// O diálogo não está aberto de cara.
		expect(
			screen.queryByRole("alertdialog"),
		).not.toBeInTheDocument();

		await user.click(
			screen.getByRole("button", { name: /encerrar evento/i }),
		);

		expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
		expect(
			screen.getByRole("heading", { name: /encerrar este evento/i }),
		).toBeInTheDocument();
	});

	it("chama POST /close e dispara onClosed no 200", async () => {
		const user = userEvent.setup();
		const fetchMock = vi.mocked(fetch).mockResolvedValue(okResponse());
		const onClosed = vi.fn();

		render(
			<CloseEventButton slug="aniversario-da-ana" onClosed={onClosed} />,
		);

		await user.click(
			screen.getByRole("button", { name: /encerrar evento/i }),
		);

		// Confirma no diálogo. Pega o botão que está DENTRO do diálogo (o trigger
		// homônimo fica fora do portal).
		const dialog = await screen.findByRole("alertdialog");
		const confirmInDialog = within(dialog).getByRole("button", {
			name: /^encerrar evento$/i,
		});
		await user.click(confirmInDialog);

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toBe("/api/events/aniversario-da-ana/close");
		expect(init?.method).toBe("POST");
		expect(init?.credentials).toBe("include");

		await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
		expect(onClosed.mock.calls[0]![0].status).toBe("Encerrado");
	});

	it("mostra erro inline no 400 INVALID_STATE e não chama onClosed", async () => {
		const user = userEvent.setup();
		vi.mocked(fetch).mockResolvedValue(invalidStateResponse());
		const onClosed = vi.fn();

		render(
			<CloseEventButton slug="aniversario-da-ana" onClosed={onClosed} />,
		);

		await user.click(
			screen.getByRole("button", { name: /encerrar evento/i }),
		);

		const dialog = await screen.findByRole("alertdialog");
		await user.click(
			within(dialog).getByRole("button", { name: /^encerrar evento$/i }),
		);

		await waitFor(() =>
			expect(
				screen.getByText(/não pode ser encerrado/i),
			).toBeInTheDocument(),
		);
		expect(onClosed).not.toHaveBeenCalled();
		// O diálogo continua aberto (não fechou no erro).
		expect(screen.getByRole("alertdialog")).toBeInTheDocument();
	});
});
