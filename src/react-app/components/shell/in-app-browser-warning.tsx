import { useEffect, useState } from "react";

import { useInAppBrowser } from "../../hooks/use-in-app-browser";
import type { InAppPlatform } from "../../lib/in-app-browser";

const STORAGE_KEY = "instanta.in-app-warning.dismissed-at";
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;

const PLATFORM_NAMES: Record<InAppPlatform, string> = {
	instagram: "Instagram",
	facebook: "Facebook",
	whatsapp: "WhatsApp",
	tiktok: "TikTok",
	twitter: "Twitter/X",
	other: "este aplicativo",
};

function readDismiss(): number | null {
	if (typeof window === "undefined") return null;
	const raw = window.localStorage.getItem(STORAGE_KEY);
	if (!raw) return null;
	const n = Number(raw);
	return Number.isFinite(n) ? n : null;
}

function writeDismiss(): void {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
}

export function InAppBrowserWarning(): React.ReactElement | null {
	const { isInApp, platform } = useInAppBrowser();
	const [dismissed, setDismissed] = useState(false);

	useEffect(() => {
		const at = readDismiss();
		// eslint-disable-next-line react-hooks/set-state-in-effect -- ler localStorage no mount é leitura-única.
		if (at && Date.now() - at < DISMISS_TTL_MS) setDismissed(true);
	}, []);

	if (!isInApp || !platform || dismissed) return null;

	const handleDismiss = () => {
		writeDismiss();
		setDismissed(true);
	};

	const name = PLATFORM_NAMES[platform];
	const instruction = navigator.userAgent.includes("iPhone")
		? "Toque no menu (•••) → Abrir em Safari."
		: "Toque no menu (⋮) → Abrir no Chrome.";

	return (
		<div
			data-clarity-mask
			className="sticky top-0 z-50 flex items-center gap-3 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm dark:bg-amber-950 dark:text-amber-100"
			role="alert"
		>
			<span aria-hidden="true">⚠️</span>
			<div className="flex-1">
				<strong>Você está dentro do {name}.</strong>{" "}
				Pra a melhor experiência (upload de foto, login persistente), abra no
				navegador do seu celular. {instruction}
			</div>
			<button
				type="button"
				onClick={handleDismiss}
				aria-label="Dispensar aviso"
				className="ml-2 rounded-md px-2 py-1 text-amber-900/70 hover:bg-amber-100 hover:text-amber-900 dark:text-amber-100/70 dark:hover:bg-amber-900"
			>
				✕
			</button>
		</div>
	);
}
