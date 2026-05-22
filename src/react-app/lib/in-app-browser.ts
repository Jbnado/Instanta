// Detecta acesso via in-app browser de plataformas sociais (FR58, NFR38).
// WebViews terceiras quebram câmera, share API, cookies persistentes — banner
// avisa o user pra abrir no browser nativo. Detecção via UserAgent string.

export type InAppPlatform =
	| "instagram"
	| "facebook"
	| "whatsapp"
	| "tiktok"
	| "twitter"
	| "other";

export interface InAppBrowserResult {
	isInApp: boolean;
	platform: InAppPlatform | null;
}

const PATTERNS: Array<{ platform: InAppPlatform; regex: RegExp }> = [
	{ platform: "instagram", regex: /Instagram/i },
	{ platform: "facebook", regex: /FBAN|FBAV|FB_IAB/i },
	{ platform: "whatsapp", regex: /WhatsApp/i },
	{ platform: "tiktok", regex: /musical_ly|BytedanceWebview/i },
	{ platform: "twitter", regex: /Twitter/i },
];

export function detectInAppBrowser(userAgent: string): InAppBrowserResult {
	if (!userAgent) return { isInApp: false, platform: null };
	for (const { platform, regex } of PATTERNS) {
		if (regex.test(userAgent)) return { isInApp: true, platform };
	}
	return { isInApp: false, platform: null };
}
