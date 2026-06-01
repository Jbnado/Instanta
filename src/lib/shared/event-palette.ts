/**
 * Paleta curada de cores de acento do evento (FR59).
 *
 * O anfitrião escolhe UMA destas 10 no setup; a cor propaga via CSS variable
 * durante o evento (ver ux-design-specification §cor de acento runtime).
 *
 * ⚠️ CONTEÚDO DE PRODUTO — Bernardo pode ajustar hex/nomes livremente. Default
 * é o roxo da marca (#A855F7). Mantida em `src/lib/shared/` porque tanto o
 * picker do form (frontend) quanto a validação Zod (backend) consomem a mesma lista.
 */

export interface AccentColor {
	/** Hex usado como valor persistido em `events.color_accent`. */
	readonly hex: string;
	/** Nome curto exibido no picker (PT-BR). */
	readonly name: string;
}

export const EVENT_ACCENT_COLORS: readonly AccentColor[] = [
	{ hex: "#A855F7", name: "Roxo" },
	{ hex: "#EC4899", name: "Rosa" },
	{ hex: "#FB7185", name: "Coral" },
	{ hex: "#EF4444", name: "Vermelho" },
	{ hex: "#F97316", name: "Laranja" },
	{ hex: "#F59E0B", name: "Âmbar" },
	{ hex: "#10B981", name: "Verde" },
	{ hex: "#14B8A6", name: "Turquesa" },
	{ hex: "#3B82F6", name: "Azul" },
	{ hex: "#6366F1", name: "Índigo" },
] as const;

/** Default quando o anfitrião não escolhe — cor da marca. */
export const DEFAULT_ACCENT_HEX = "#A855F7";

/** Tupla de hexes pra `z.enum(...)` (Zod exige tupla não-vazia de literais). */
export const ACCENT_HEXES = EVENT_ACCENT_COLORS.map((c) => c.hex) as [
	string,
	...string[],
];

export function isValidAccentHex(hex: string): boolean {
	return EVENT_ACCENT_COLORS.some((c) => c.hex === hex);
}
