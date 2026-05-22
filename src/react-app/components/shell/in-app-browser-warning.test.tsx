import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InAppBrowserWarning } from "./in-app-browser-warning";

function setUA(ua: string) {
	Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
}

describe("InAppBrowserWarning", () => {
	beforeEach(() => {
		localStorage.clear();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("renderiza banner pra UA Instagram", () => {
		setUA("Mozilla/5.0 (iPhone) Instagram 300.0");
		render(<InAppBrowserWarning />);
		expect(screen.getByRole("alert")).toBeInTheDocument();
		expect(screen.getByText(/Instagram/)).toBeInTheDocument();
	});

	it("não renderiza pra Chrome desktop", () => {
		setUA("Mozilla/5.0 (Windows NT 10.0) Chrome/126.0.0.0 Safari/537.36");
		const { container } = render(<InAppBrowserWarning />);
		expect(container.firstChild).toBeNull();
	});

	it("respeita dismiss persistido em localStorage (24h)", () => {
		setUA("Mozilla/5.0 (iPhone) Instagram 300.0");
		localStorage.setItem("instanta.in-app-warning.dismissed-at", String(Date.now()));
		const { container } = render(<InAppBrowserWarning />);
		expect(container.firstChild).toBeNull();
	});

	it("ignora dismiss expirado (>24h)", () => {
		setUA("Mozilla/5.0 (iPhone) Instagram 300.0");
		const long_ago = Date.now() - 25 * 60 * 60 * 1000;
		localStorage.setItem("instanta.in-app-warning.dismissed-at", String(long_ago));
		render(<InAppBrowserWarning />);
		expect(screen.getByRole("alert")).toBeInTheDocument();
	});
});
