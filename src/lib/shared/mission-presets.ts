/**
 * Catálogo de missões preset (FR60): ~10 missões genéricas que o anfitrião pode
 * habilitar com um clique, além das missões personalizadas de texto livre.
 *
 * ⚠️ CONTEÚDO DE PRODUTO — Bernardo pode reescrever os textos / adicionar / remover
 * livremente. Cada preset tem um `id` estável (NÃO renomear ids já usados em prod)
 * usado pra marcar seleção no form; o `label` é o que vira `event_missions.label`.
 * Compartilhado: o form (frontend) lista os presets; o backend valida os ids enviados.
 */

export interface MissionPreset {
	/** Id estável (slug) — referenciado pelo form/backend. Não mudar após uso em prod. */
	readonly id: string;
	/** Texto exibido ao convidado, persistido em event_missions.label. */
	readonly label: string;
}

export const MISSION_PRESETS: readonly MissionPreset[] = [
	{ id: "selfie-anfitriao", label: "Selfie com o anfitrião" },
	{ id: "decoracao", label: "Foto da decoração" },
	{ id: "mesa-comida", label: "A mesa do bolo (ou da comida)" },
	{ id: "brinde", label: "Hora do brinde 🥂" },
	{ id: "pista", label: "Todo mundo na pista" },
	{ id: "grupo-amigos", label: "Um grupo de amigos reunidos" },
	{ id: "look-da-noite", label: "O look da noite" },
	{ id: "espontanea", label: "Um momento espontâneo" },
	{ id: "alguem-novo", label: "Foto com alguém que você acabou de conhecer" },
	{ id: "melhor-risada", label: "A melhor risada da festa" },
] as const;

export const MISSION_PRESET_IDS = MISSION_PRESETS.map((m) => m.id) as [
	string,
	...string[],
];

export function presetLabelById(id: string): string | undefined {
	return MISSION_PRESETS.find((m) => m.id === id)?.label;
}
