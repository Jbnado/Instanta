import { useState } from "react";
import { Check, Plus, X } from "lucide-react";

import {
	EVENT_ACCENT_COLORS,
	DEFAULT_ACCENT_HEX,
} from "@/lib/shared/event-palette";
import { MISSION_PRESETS } from "@/lib/shared/mission-presets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/**
 * Sub-componente presentacional compartilhado entre o form de criação (Story 3.1)
 * e o de edição (Story 3.2): picker de cor de acento (FR59), checkboxes de missões
 * preset (FR60) e a lista dinâmica de missões personalizadas.
 *
 * Não conhece react-hook-form — recebe valores + setters controlados pelo pai.
 * Mantido DRY de propósito: a UI dos dois forms é idêntica, só o submit difere.
 */

/** Teto de missões personalizadas (espelha o schema; trava o botão "adicionar"). */
export const MAX_CUSTOM_MISSIONS = 10;

interface Props {
	colorAccent: string;
	presetMissionIds: string[];
	customMissions: string[];
	onColorChange: (hex: string) => void;
	onPresetToggle: (id: string) => void;
	onCustomAdd: (label: string) => void;
	onCustomRemove: (index: number) => void;
	/** Mensagem de erro do array de missões personalizadas (vinda do RHF). */
	customMissionsError?: string;
}

export function EventStyleFields({
	colorAccent,
	presetMissionIds,
	customMissions,
	onColorChange,
	onPresetToggle,
	onCustomAdd,
	onCustomRemove,
	customMissionsError,
}: Props) {
	// Buffer do input de missão personalizada (fora do RHF — só vira item ao adicionar).
	const [customDraft, setCustomDraft] = useState("");

	const accent = colorAccent || DEFAULT_ACCENT_HEX;

	function handleAdd() {
		const value = customDraft.trim();
		if (!value) return;
		if (customMissions.length >= MAX_CUSTOM_MISSIONS) return;
		onCustomAdd(value);
		setCustomDraft("");
	}

	return (
		<>
			{/* Cor de acento — picker de swatches da paleta curada (FR59) */}
			<fieldset className="space-y-2.5">
				<legend className="text-sm font-medium leading-none">
					Cor do evento
				</legend>
				<div
					role="radiogroup"
					aria-label="Cor de acento do evento"
					className="flex flex-wrap gap-3"
				>
					{EVENT_ACCENT_COLORS.map((color) => {
						const selected = accent === color.hex;
						return (
							<button
								key={color.hex}
								type="button"
								role="radio"
								aria-checked={selected}
								aria-label={color.name}
								title={color.name}
								onClick={() => onColorChange(color.hex)}
								className={cn(
									"flex size-9 items-center justify-center rounded-full outline-none transition-transform",
									"focus-visible:ring-3 focus-visible:ring-ring/50",
									// Ring de seleção: anel da cor da marca em volta do swatch.
									selected
										? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
										: "hover:scale-105",
								)}
								style={{ backgroundColor: color.hex }}
							>
								{selected ? (
									<Check className="size-4 text-white" strokeWidth={3} />
								) : null}
							</button>
						);
					})}
				</div>
			</fieldset>

			{/* Missões preset (FR60) — checkbox list */}
			<fieldset className="space-y-2.5">
				<legend className="text-sm font-medium leading-none">
					Missões sugeridas
				</legend>
				<p className="text-sm text-muted-foreground">
					Desafios de foto pros convidados. Escolhe quantas quiser.
				</p>
				<ul className="space-y-2">
					{MISSION_PRESETS.map((mission) => {
						const checked = presetMissionIds.includes(mission.id);
						return (
							<li key={mission.id} className="flex items-start gap-2.5">
								<Checkbox
									id={`preset-${mission.id}`}
									checked={checked}
									onCheckedChange={() => onPresetToggle(mission.id)}
								/>
								<Label
									htmlFor={`preset-${mission.id}`}
									className="font-normal leading-snug"
								>
									{mission.label}
								</Label>
							</li>
						);
					})}
				</ul>
			</fieldset>

			{/* Missões personalizadas — lista dinâmica add/remove */}
			<fieldset className="space-y-2.5">
				<legend className="text-sm font-medium leading-none">
					Missões personalizadas
				</legend>
				<p className="text-sm text-muted-foreground">
					Crie as suas (até {MAX_CUSTOM_MISSIONS}).
				</p>

				{customMissions.length > 0 ? (
					<ul className="space-y-2">
						{customMissions.map((mission, index) => (
							<li
								// Índice no key: as missões não reordenam e podem repetir texto.
								key={`custom-${index}`}
								className="flex items-center gap-2 rounded-lg border border-input bg-muted/30 px-3 py-2 text-sm"
							>
								<span className="flex-1 break-words">{mission}</span>
								<button
									type="button"
									onClick={() => onCustomRemove(index)}
									aria-label={`Remover missão "${mission}"`}
									className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
								>
									<X className="size-4" />
								</button>
							</li>
						))}
					</ul>
				) : null}

				{customMissions.length < MAX_CUSTOM_MISSIONS ? (
					<div className="flex gap-2">
						<Input
							type="text"
							value={customDraft}
							onChange={(e) => setCustomDraft(e.target.value)}
							onKeyDown={(e) => {
								// Enter adiciona sem submeter o form.
								if (e.key === "Enter") {
									e.preventDefault();
									handleAdd();
								}
							}}
							placeholder="Ex: Foto com o mascote"
							aria-label="Nova missão personalizada"
							maxLength={80}
						/>
						<Button
							type="button"
							variant="outline"
							size="icon"
							onClick={handleAdd}
							disabled={!customDraft.trim()}
							aria-label="Adicionar missão personalizada"
						>
							<Plus className="size-4" />
						</Button>
					</div>
				) : (
					<p className="text-sm text-muted-foreground">
						Você chegou no limite de {MAX_CUSTOM_MISSIONS} missões.
					</p>
				)}

				{customMissionsError ? (
					<p className="text-sm text-destructive">{customMissionsError}</p>
				) : null}
			</fieldset>
		</>
	);
}
