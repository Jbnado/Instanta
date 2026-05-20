import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./button";

// Smoke test — prova que o setup client (jsdom + Testing Library + jest-dom)
// renderiza um componente shadcn da Story 1.1. Cobertura real chega com cada feature.
describe("Button", () => {
	it("renderiza com texto e role acessível", () => {
		render(<Button>Olá</Button>);
		const btn = screen.getByRole("button", { name: "Olá" });
		expect(btn).toBeInTheDocument();
		expect(btn).toHaveAttribute("data-slot", "button");
	});
});
