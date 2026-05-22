import { describe, expect, it } from "vitest";

import { detectInAppBrowser } from "./in-app-browser";

describe("detectInAppBrowser", () => {
	it("detecta Instagram", () => {
		const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Instagram 300.0.0.0";
		expect(detectInAppBrowser(ua)).toEqual({ isInApp: true, platform: "instagram" });
	});

	it("detecta Facebook (FBAN)", () => {
		expect(
			detectInAppBrowser("Mozilla/5.0 ... [FBAN/FBIOS;FBAV/300]"),
		).toEqual({ isInApp: true, platform: "facebook" });
	});

	it("detecta WhatsApp", () => {
		expect(detectInAppBrowser("Mozilla/5.0 ... WhatsApp/2.23.0")).toEqual({
			isInApp: true,
			platform: "whatsapp",
		});
	});

	it("detecta TikTok (musical_ly)", () => {
		expect(detectInAppBrowser("Mozilla/5.0 ... musical_ly_2023")).toEqual({
			isInApp: true,
			platform: "tiktok",
		});
	});

	it("Chrome desktop não é in-app", () => {
		const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36";
		expect(detectInAppBrowser(ua)).toEqual({ isInApp: false, platform: null });
	});

	it("Safari iOS nativo não é in-app", () => {
		const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
		expect(detectInAppBrowser(ua)).toEqual({ isInApp: false, platform: null });
	});

	it("string vazia retorna defaults", () => {
		expect(detectInAppBrowser("")).toEqual({ isInApp: false, platform: null });
	});
});
