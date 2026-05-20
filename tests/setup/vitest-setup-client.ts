import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Cleanup automático do DOM entre testes — evita vazamento entre `render()`.
afterEach(() => {
	cleanup();
});
