import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreateEventForm } from "./create-event-form";
import { DEFAULT_ACCENT_HEX } from "@/lib/shared/event-palette";

const VALID = {
	name: "Aniversário da Ana",
	date: "2026-12-31",
};

/** Preenche os campos obrigatórios mínimos pra deixar o form válido. */
async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
	await user.type(screen.getByLabelText("Nome do evento"), VALID.name);
	await user.type(screen.getByLabelText("Data do evento"), VALID.date);
}

describe("CreateEventForm", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("renderiza nome, data, swatches de cor e checkboxes de preset", () => {
		render(<CreateEventForm />);
		expect(screen.getByLabelText("Nome do evento")).toBeInTheDocument();
		expect(screen.getByLabelText("Data do evento")).toBeInTheDocument();
		expect(screen.queryByLabelText("Senha do evento")).not.toBeInTheDocument();

		// Swatches: radiogroup com um radio por cor da paleta.
		const swatches = screen.getByRole("radiogroup", {
			name: /cor de acento/i,
		});
		expect(within(swatches).getAllByRole("radio")).toHaveLength(10);

		// Presets: checkbox por missão sugerida.
		expect(screen.getByLabelText("Selfie com o anfitrião")).toBeInTheDocument();
	});

	it("seleciona uma cor atualizando o swatch marcado", async () => {
		const user = userEvent.setup();
		render(<CreateEventForm />);

		// Default já vem marcado (cor da marca).
		const roxo = screen.getByRole("radio", { name: "Roxo" });
		expect(roxo).toHaveAttribute("aria-checked", "true");

		const azul = screen.getByRole("radio", { name: "Azul" });
		await user.click(azul);
		expect(azul).toHaveAttribute("aria-checked", "true");
		expect(roxo).toHaveAttribute("aria-checked", "false");
	});

	it("marca e desmarca uma missão preset", async () => {
		const user = userEvent.setup();
		render(<CreateEventForm />);

		const preset = screen.getByLabelText("Selfie com o anfitrião");
		expect(preset).not.toBeChecked();
		await user.click(preset);
		expect(preset).toBeChecked();
		await user.click(preset);
		expect(preset).not.toBeChecked();
	});

	it("adiciona e remove uma missão personalizada", async () => {
		const user = userEvent.setup();
		render(<CreateEventForm />);

		const draft = screen.getByLabelText("Nova missão personalizada");
		await user.type(draft, "Foto com o mascote");
		await user.click(
			screen.getByRole("button", { name: /adicionar missão/i }),
		);

		expect(screen.getByText("Foto com o mascote")).toBeInTheDocument();

		await user.click(
			screen.getByRole("button", { name: /remover missão/i }),
		);
		expect(screen.queryByText("Foto com o mascote")).not.toBeInTheDocument();
	});

	it("envia o payload correto pro endpoint ao submeter válido", async () => {
		const user = userEvent.setup();
		const fetchMock = vi.mocked(fetch).mockResolvedValue(
			new Response(
				JSON.stringify({
					event: {
						id: "evt_1",
						slug: "aniversario-da-ana",
						name: VALID.name,
						status: "Inativo",
						colorAccent: DEFAULT_ACCENT_HEX,
					},
				}),
				{ status: 201, headers: { "Content-Type": "application/json" } },
			),
		);

		render(<CreateEventForm />);
		await fillRequired(user);

		// Marca um preset e adiciona uma custom pra cobrir o payload completo.
		await user.click(screen.getByLabelText("Selfie com o anfitrião"));
		await user.type(
			screen.getByLabelText("Nova missão personalizada"),
			"Foto com o mascote",
		);
		await user.click(
			screen.getByRole("button", { name: /adicionar missão/i }),
		);

		const submit = screen.getByRole("button", { name: /criar evento/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toBe("/api/events");
		expect(init?.method).toBe("POST");
		expect(init?.credentials).toBe("include");

		const body = JSON.parse(init?.body as string);
		expect(body.name).toBe(VALID.name);
		expect(body.eventDate).toContain("2026-12-31");
		expect(body).not.toHaveProperty("password");
		expect(body.colorAccent).toBe(DEFAULT_ACCENT_HEX);
		expect(body.presetMissionIds).toEqual(["selfie-anfitriao"]);
		expect(body.customMissions).toEqual(["Foto com o mascote"]);
	});

	it("mostra o painel de sucesso e chama onSuccess no 201 (sem navegar)", async () => {
		const user = userEvent.setup();
		vi.mocked(fetch).mockResolvedValue(
			new Response(
				JSON.stringify({
					event: {
						id: "evt_1",
						slug: "aniversario-da-ana",
						name: VALID.name,
						status: "Inativo",
						colorAccent: DEFAULT_ACCENT_HEX,
					},
				}),
				{ status: 201, headers: { "Content-Type": "application/json" } },
			),
		);
		const onSuccess = vi.fn();

		render(<CreateEventForm onSuccess={onSuccess} />);
		await fillRequired(user);

		const submit = screen.getByRole("button", { name: /criar evento/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() => {
			expect(screen.getByText(/evento criado/i)).toBeInTheDocument();
		});
		expect(screen.getByText(/aguardando ativação/i)).toBeInTheDocument();
		expect(onSuccess).toHaveBeenCalledWith({
			slug: "aniversario-da-ana",
			name: VALID.name,
		});
	});

	it("mostra a mensagem de limite no 403 ACTIVE_LIMIT_REACHED", async () => {
		const user = userEvent.setup();
		vi.mocked(fetch).mockResolvedValue(
			new Response(JSON.stringify({ error: "ACTIVE_LIMIT_REACHED" }), {
				status: 403,
				headers: { "Content-Type": "application/json" },
			}),
		);

		render(<CreateEventForm />);
		await fillRequired(user);

		const submit = screen.getByRole("button", { name: /criar evento/i });
		await waitFor(() => expect(submit).toBeEnabled());
		await user.click(submit);

		await waitFor(() => {
			expect(
				screen.getByText(/já tem 3 eventos ativos/i),
			).toBeInTheDocument();
		});
	});
});
