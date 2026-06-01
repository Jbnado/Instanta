import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

interface Props {
	password: string;
}

/**
 * Indicador de força de senha (UX-DR22). 4 níveis: fraca / ok / boa / forte.
 *
 * O `@zxcvbn-ts/core` + dicionários pt-br são pesados (~dezenas de KB), então
 * carregam via dynamic `import()` dentro do useEffect — vira chunk separado no
 * Vite e só baixa quando o usuário chega nesta tela. Enquanto carrega,
 * mostramos o estado neutro (`isReady === false`) sem travar a digitação.
 */

// zxcvbn devolve score 0–4. Mapeamos pros 4 níveis visuais do Instanta.
const LEVELS = [
	{ label: "Senha fraca", bars: 1, color: "bg-destructive" },
	{ label: "Senha fraca", bars: 1, color: "bg-destructive" },
	{ label: "Senha ok", bars: 2, color: "bg-amber-500" },
	{ label: "Senha boa", bars: 3, color: "bg-lime-500" },
	{ label: "Senha forte", bars: 4, color: "bg-emerald-500" },
] as const;

type Zxcvbn = (password: string) => { score: 0 | 1 | 2 | 3 | 4; feedback: { warning: string | null; suggestions: string[] } };

let cachedZxcvbn: Zxcvbn | null = null;

async function loadZxcvbn(): Promise<Zxcvbn> {
	if (cachedZxcvbn) return cachedZxcvbn;

	const [core, common, ptBr] = await Promise.all([
		import("@zxcvbn-ts/core"),
		import("@zxcvbn-ts/language-common"),
		import("@zxcvbn-ts/language-pt-br"),
	]);

	core.zxcvbnOptions.setOptions({
		dictionary: {
			...common.dictionary,
			...ptBr.dictionary,
		},
		graphs: common.adjacencyGraphs,
		translations: ptBr.translations,
	});

	cachedZxcvbn = core.zxcvbn as unknown as Zxcvbn;
	return cachedZxcvbn;
}

export function PasswordStrengthMeter({ password }: Props) {
	const [isReady, setIsReady] = useState(cachedZxcvbn !== null);
	const [result, setResult] = useState<ReturnType<Zxcvbn> | null>(null);

	useEffect(() => {
		let cancelled = false;

		// Senha vazia → nada a avaliar. Não chamamos setState aqui (o render já
		// retorna null abaixo); evita cascading render e o lint set-state-in-effect.
		if (password.length === 0) {
			return;
		}

		loadZxcvbn()
			.then((zxcvbn) => {
				if (cancelled) return;
				setIsReady(true);
				setResult(zxcvbn(password));
			})
			.catch(() => {
				// Falha ao carregar o chunk não pode quebrar o signup — degrada
				// silenciosamente (sem meter). A validação Zod já barra senha fraca.
				if (!cancelled) setIsReady(false);
			});

		return () => {
			cancelled = true;
		};
	}, [password]);

	// Renderiza só quando há senha digitada (spec: password.length > 0).
	if (password.length === 0) return null;

	const score = result?.score ?? 0;
	const level = LEVELS[score];
	const warning = result?.feedback.warning;
	const suggestion = result?.feedback.suggestions[0];

	return (
		<div className="space-y-1.5" aria-live="polite">
			<div className="flex gap-1.5" role="presentation">
				{[0, 1, 2, 3].map((i) => (
					<div
						key={i}
						className={cn(
							"h-1.5 flex-1 rounded-full transition-colors",
							isReady && i < level.bars ? level.color : "bg-muted",
						)}
					/>
				))}
			</div>

			<p className="text-xs text-muted-foreground">
				{isReady ? (
					<>
						<span className="font-medium text-foreground">{level.label}.</span>{" "}
						{warning || suggestion || "Quanto mais longa, melhor."}
					</>
				) : (
					"Avaliando a força da senha…"
				)}
			</p>
		</div>
	);
}
