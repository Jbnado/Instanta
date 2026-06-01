import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "instanta-theme";

/**
 * Mocka `window.matchMedia` para controlar o `prefers-color-scheme`.
 * Precisa estar setado ANTES de importar o store (o default é computado na
 * criação do módulo). Por isso usamos `vi.resetModules()` + import dinâmico.
 */
function mockMatchMedia(prefersDark: boolean) {
	window.matchMedia = vi.fn().mockImplementation((query: string) => ({
		matches: query.includes("dark") ? prefersDark : false,
		media: query,
		onchange: null,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		addListener: vi.fn(),
		removeListener: vi.fn(),
		dispatchEvent: vi.fn(),
	}));
}

async function loadStore() {
	vi.resetModules();
	return import("./theme-store");
}

beforeEach(() => {
	localStorage.clear();
	document.documentElement.classList.remove("dark");
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("getSystemTheme", () => {
	it("retorna 'dark' quando o SO prefere escuro", async () => {
		mockMatchMedia(true);
		const { getSystemTheme } = await loadStore();
		expect(getSystemTheme()).toBe("dark");
	});

	it("retorna 'light' quando o SO prefere claro", async () => {
		mockMatchMedia(false);
		const { getSystemTheme } = await loadStore();
		expect(getSystemTheme()).toBe("light");
	});
});

describe("theme default (primeiro acesso)", () => {
	it("segue prefers-color-scheme: dark quando não há valor persistido", async () => {
		mockMatchMedia(true);
		const { useThemeStore } = await loadStore();
		expect(useThemeStore.getState().theme).toBe("dark");
	});

	it("segue prefers-color-scheme: light quando não há valor persistido", async () => {
		mockMatchMedia(false);
		const { useThemeStore } = await loadStore();
		expect(useThemeStore.getState().theme).toBe("light");
	});
});

describe("applyTheme", () => {
	it("adiciona a classe .dark no <html> para tema escuro", async () => {
		mockMatchMedia(false);
		const { applyTheme } = await loadStore();
		applyTheme("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	it("remove a classe .dark no <html> para tema claro", async () => {
		mockMatchMedia(false);
		const { applyTheme } = await loadStore();
		document.documentElement.classList.add("dark");
		applyTheme("light");
		expect(document.documentElement.classList.contains("dark")).toBe(false);
	});
});

describe("toggleTheme", () => {
	it("alterna de claro para escuro e aplica .dark", async () => {
		mockMatchMedia(false);
		const { useThemeStore } = await loadStore();
		expect(useThemeStore.getState().theme).toBe("light");

		useThemeStore.getState().toggleTheme();

		expect(useThemeStore.getState().theme).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	it("alterna de escuro para claro e remove .dark", async () => {
		mockMatchMedia(true);
		const { useThemeStore } = await loadStore();
		expect(useThemeStore.getState().theme).toBe("dark");

		useThemeStore.getState().toggleTheme();

		expect(useThemeStore.getState().theme).toBe("light");
		expect(document.documentElement.classList.contains("dark")).toBe(false);
	});
});

describe("setTheme", () => {
	it("define o tema e aplica a classe", async () => {
		mockMatchMedia(false);
		const { useThemeStore } = await loadStore();
		useThemeStore.getState().setTheme("dark");
		expect(useThemeStore.getState().theme).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});
});

describe("persistência (localStorage)", () => {
	it("escreve o tema no localStorage sob a chave instanta-theme", async () => {
		mockMatchMedia(false);
		const { useThemeStore } = await loadStore();
		useThemeStore.getState().setTheme("dark");

		const raw = localStorage.getItem(STORAGE_KEY);
		expect(raw).toBeTruthy();
		expect(JSON.parse(raw!).state.theme).toBe("dark");
	});

	it("reidrata o tema persistido em vez do default do SO", async () => {
		// SO prefere claro, mas há valor persistido = dark → vence o persistido.
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ state: { theme: "dark" }, version: 0 }),
		);
		mockMatchMedia(false);
		const { useThemeStore } = await loadStore();
		expect(useThemeStore.getState().theme).toBe("dark");
	});
});
