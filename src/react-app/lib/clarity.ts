// Microsoft Clarity loader — injeta script tag no <head> de forma lazy.
// Carrega depois de TTI via requestIdleCallback (fallback setTimeout) pra
// não competir com a hidratação React. Idempotente.
//
// Convenção de mascaramento: forms sensíveis (email, senha, MFA, etc.) devem
// ter `data-clarity-mask` no input/container. Clarity respeita nativamente.

const SCRIPT_ID = "clarity-loader";

export function loadClarity(projectId: string): void {
	if (!projectId) return;
	if (typeof document === "undefined") return;
	if (document.getElementById(SCRIPT_ID)) return;

	// Snippet oficial Clarity (formato canônico em <projectId>).
	const script = document.createElement("script");
	script.id = SCRIPT_ID;
	script.async = true;
	script.textContent = `
		(function(c,l,a,r,i,t,y){
			c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
			t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
			y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
		})(window, document, "clarity", "script", "${projectId}");
	`;
	document.head.appendChild(script);
}
