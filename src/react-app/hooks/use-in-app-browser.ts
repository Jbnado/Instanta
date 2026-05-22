import { useEffect, useState } from "react";

import { detectInAppBrowser, type InAppBrowserResult } from "../lib/in-app-browser";

// Hook React. SSR-safe (defaults se window undefined). Roda apenas no mount —
// UA não muda em runtime.
export function useInAppBrowser(): InAppBrowserResult {
	const [result, setResult] = useState<InAppBrowserResult>({
		isInApp: false,
		platform: null,
	});

	useEffect(() => {
		if (typeof navigator === "undefined") return;
		// eslint-disable-next-line react-hooks/set-state-in-effect -- UA não muda em runtime; detecção single-shot no mount.
		setResult(detectInAppBrowser(navigator.userAgent));
	}, []);

	return result;
}
