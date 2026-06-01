import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// O EventList usa o <Link> do TanStack. Fora de um RouterProvider ele quebra,
// então mockamos por um <a> que serializa `to` + `params.slug` no href — assim
// dá pra asserir o destino /event/$slug/host sem montar router de verdade.
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		params,
		children,
		...rest
	}: {
		to: string;
		params?: { slug?: string };
		children: ReactNode;
		className?: string;
	}) => {
		const href = params?.slug ? to.replace("$slug", params.slug) : to;
		return (
			<a href={href} {...rest}>
				{children}
			</a>
		);
	},
}));

import { EventList, type EventListItem } from "./event-list";

const EVENTS: EventListItem[] = [
	{
		id: "e-ativo-2",
		slug: "ativo-2",
		name: "Ativo Dezembro",
		status: "Ativo",
		colorAccent: "#10B981",
		eventDate: "2026-12-01T00:00:00.000Z",
		description: null,
	},
	{
		id: "e-encerrado",
		slug: "encerrado-1",
		name: "Encerrado Janeiro",
		status: "Encerrado",
		colorAccent: "#EF4444",
		eventDate: "2026-01-10T00:00:00.000Z",
		description: null,
	},
	{
		id: "e-ativo-1",
		slug: "ativo-1",
		name: "Ativo Junho",
		status: "Ativo",
		colorAccent: "#3B82F6",
		eventDate: "2026-06-01T00:00:00.000Z",
		description: null,
	},
	{
		id: "e-inativo",
		slug: "inativo-1",
		name: "Inativo Maio",
		status: "Inativo",
		colorAccent: "#A855F7",
		eventDate: "2026-05-01T00:00:00.000Z",
		description: null,
	},
];

describe("EventList", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("mostra o estado vazio com link pra criar evento", () => {
		render(<EventList events={[]} />);
		expect(
			screen.getByText(/você ainda não criou eventos/i),
		).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: /criar meu primeiro evento/i }),
		).toHaveAttribute("href", "/event/create");
	});

	it("agrupa por status na ordem Inativo → Ativo → Encerrado", () => {
		render(<EventList events={EVENTS} />);
		const headings = screen
			.getAllByRole("heading", { level: 2 })
			.map((h) => h.textContent);
		expect(headings).toEqual(["Inativo", "Ativo", "Encerrado"]);
	});

	it("ordena por data (ascendente) dentro de cada grupo", () => {
		render(<EventList events={EVENTS} />);

		// Grupo "Ativo": Junho (06) deve vir antes de Dezembro (12).
		const ativoHeading = screen.getByRole("heading", {
			level: 2,
			name: "Ativo",
		});
		const ativoSection = ativoHeading.closest("section")!;
		const names = within(ativoSection)
			.getAllByRole("link")
			.map((a) => a.textContent ?? "");
		expect(names[0]).toContain("Ativo Junho");
		expect(names[1]).toContain("Ativo Dezembro");
	});

	it("linka cada card pra /event/$slug/host", () => {
		render(<EventList events={EVENTS} />);
		const link = screen.getByRole("link", { name: /inativo maio/i });
		expect(link).toHaveAttribute("href", "/event/inativo-1/host");
	});
});
