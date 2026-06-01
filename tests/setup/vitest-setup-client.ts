import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom não implementa ResizeObserver, que alguns primitivos radix-ui
// (ex.: Checkbox via react-use-size) consomem no mount. Polyfill no-op.
if (typeof globalThis.ResizeObserver === "undefined") {
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
}

// Cleanup automático do DOM entre testes — evita vazamento entre `render()`.
afterEach(() => {
	cleanup();
});
