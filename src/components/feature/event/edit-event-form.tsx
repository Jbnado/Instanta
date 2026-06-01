import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zResolver } from "@/lib/zod-resolver";
import { Check } from "lucide-react";

import {
	updateEventSchema,
	type UpdateEventInput,
	type EventDetail,
} from "@/lib/shared/schemas/event";
import { MISSION_PRESETS } from "@/lib/shared/mission-presets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { EventStyleFields } from "./event-style-fields";

interface Props {
	/** Detalhe atual do evento (vem do GET /api/events/:slug). Usado pra prefill. */
	event: EventDetail;
	/** Chamado quando o PATCH responde 200, com o EventDetail atualizado. */
	onSaved?: (event: EventDetail) => void;
}

type FormStatus =
	| { kind: "idle" }
	| { kind: "saved" }
	| { kind: "not-found" }
	| { kind: "error"; message: string };

/** Resposta 200 do PATCH /api/events/:slug. */
interface UpdatedEventResponse {
	event: EventDetail;
}

/**
 * Converte o ISO de `eventDate` no value `YYYY-MM-DD` que o <input type="date">
 * espera. Pega só a parte da data (ignora hora/timezone do ISO).
 */
function isoToDateInput(iso: string): string {
	return iso.slice(0, 10);
}

/**
 * Mapeia as missões do evento de volta pro shape do form:
 * - presets viram ids (casados por label, já que o id da missão é da linha, não do preset);
 * - personalizadas viram a lista de labels livres.
 */
function splitMissions(missions: EventDetail["missions"]): {
	presetMissionIds: string[];
	customMissions: string[];
} {
	const presetMissionIds: string[] = [];
	const customMissions: string[] = [];
	for (const m of missions) {
		if (m.isPreset) {
			const preset = MISSION_PRESETS.find((p) => p.label === m.label);
			if (preset) presetMissionIds.push(preset.id);
		} else {
			customMissions.push(m.label);
		}
	}
	return { presetMissionIds, customMissions };
}

export function EditEventForm({ event, onSaved }: Props) {
	const [status, setStatus] = useState<FormStatus>({ kind: "idle" });

	const initialMissions = splitMissions(event.missions);

	const {
		register,
		handleSubmit,
		watch,
		setValue,
		trigger,
		formState: { errors, isValid, isSubmitting },
	} = useForm<UpdateEventInput>({
		resolver: zResolver<UpdateEventInput>(updateEventSchema),
		mode: "onTouched",
		defaultValues: {
			name: event.name,
			// O input date é string (YYYY-MM-DD); o schema é z.coerce.date() (output Date),
			// então RHF tipa o campo como Date. Cast pra alinhar: o `<input type="date">`
			// edita a string e o zod coage pra Date no submit (mesma fricção do create form).
			eventDate: isoToDateInput(event.eventDate) as unknown as Date,
			description: event.description ?? "",
			colorAccent: event.colorAccent,
			presetMissionIds: initialMissions.presetMissionIds,
			customMissions: initialMissions.customMissions,
		},
	});

	// O form nasce prefillado com dados já válidos, mas com mode "onTouched" o RHF
	// só calcula `isValid` após o 1º toque — o que deixaria o botão "Salvar"
	// desabilitado de cara. Validamos uma vez no mount pra liberar o submit.
	useEffect(() => {
		void trigger();
	}, [trigger]);

	const colorAccent = watch("colorAccent") ?? event.colorAccent;
	const presetMissionIds = watch("presetMissionIds") ?? [];
	const customMissions = watch("customMissions") ?? [];

	function togglePreset(id: string) {
		const next = presetMissionIds.includes(id)
			? presetMissionIds.filter((p) => p !== id)
			: [...presetMissionIds, id];
		setValue("presetMissionIds", next, {
			shouldValidate: true,
			shouldTouch: true,
			shouldDirty: true,
		});
	}

	function addCustomMission(label: string) {
		setValue("customMissions", [...customMissions, label], {
			shouldValidate: true,
			shouldTouch: true,
			shouldDirty: true,
		});
	}

	function removeCustomMission(index: number) {
		setValue(
			"customMissions",
			customMissions.filter((_, i) => i !== index),
			{ shouldValidate: true, shouldTouch: true, shouldDirty: true },
		);
	}

	const onSubmit = handleSubmit(async (data) => {
		setStatus({ kind: "idle" });

		// Monta o payload com o estado atual do form. Missões/cor sempre refletem
		// o estado atual (substituição completa no backend).
		const payload: Partial<UpdateEventInput> = {
			name: data.name,
			eventDate: data.eventDate,
			description: data.description,
			colorAccent: data.colorAccent,
			presetMissionIds: data.presetMissionIds,
			customMissions: data.customMissions,
		};

		let res: Response;
		try {
			res = await fetch(`/api/events/${event.slug}`, {
				method: "PATCH",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
		} catch {
			setStatus({
				kind: "error",
				message: "Não rolou conectar. Confere sua internet e tenta de novo.",
			});
			return;
		}

		// 200 → salvo. Repassa o EventDetail atualizado pro pai.
		if (res.ok) {
			const body = (await res.json().catch(() => null)) as
				| UpdatedEventResponse
				| null;
			setStatus({ kind: "saved" });
			if (body?.event && onSaved) {
				onSaved(body.event);
			}
			return;
		}

		// 404 → evento não existe / não é seu. Não revelamos qual dos dois.
		if (res.status === 404) {
			setStatus({ kind: "not-found" });
			return;
		}

		// 400 → validação server-side (defensivo; o front já barra via Zod).
		if (res.status === 400) {
			setStatus({
				kind: "error",
				message: "Confere os dados do formulário e tenta de novo.",
			});
			return;
		}

		// 500 e qualquer outro → erro genérico.
		setStatus({
			kind: "error",
			message: "Deu ruim do nosso lado. Tenta de novo em instantes.",
		});
	});

	return (
		<form onSubmit={onSubmit} noValidate className="space-y-6">
			{/* Nome */}
			<div className="space-y-1.5">
				<Label htmlFor="edit-event-name">Nome do evento</Label>
				<Input
					id="edit-event-name"
					type="text"
					placeholder="Aniversário da Ana, Casamento, Confra…"
					aria-invalid={errors.name ? true : undefined}
					aria-describedby={errors.name ? "edit-event-name-error" : undefined}
					{...register("name")}
				/>
				{errors.name ? (
					<p id="edit-event-name-error" className="text-sm text-destructive">
						{errors.name.message}
					</p>
				) : null}
			</div>

			{/* Data */}
			<div className="space-y-1.5">
				<Label htmlFor="edit-event-date">Data do evento</Label>
				<Input
					id="edit-event-date"
					type="date"
					aria-invalid={errors.eventDate ? true : undefined}
					aria-describedby={
						errors.eventDate ? "edit-event-date-error" : undefined
					}
					{...register("eventDate")}
				/>
				{errors.eventDate ? (
					<p id="edit-event-date-error" className="text-sm text-destructive">
						{errors.eventDate.message}
					</p>
				) : null}
			</div>

			{/* Descrição (opcional) */}
			<div className="space-y-1.5">
				<Label htmlFor="edit-event-description">
					Descrição <span className="text-muted-foreground">(opcional)</span>
				</Label>
				<textarea
					id="edit-event-description"
					rows={3}
					placeholder="Um recado pros convidados, tema da festa, dress code…"
					aria-invalid={errors.description ? true : undefined}
					aria-describedby={
						errors.description ? "edit-event-description-error" : undefined
					}
					className={cn(
						"flex min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-base shadow-xs outline-none transition-[color,box-shadow] md:text-sm",
						"placeholder:text-muted-foreground",
						"focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
						"disabled:cursor-not-allowed disabled:opacity-50",
						"aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
					)}
					{...register("description")}
				/>
				{errors.description ? (
					<p
						id="edit-event-description-error"
						className="text-sm text-destructive"
					>
						{errors.description.message}
					</p>
				) : null}
			</div>

			{/* Cor + missões (sub-componente compartilhado com o create) */}
			<EventStyleFields
				colorAccent={colorAccent}
				presetMissionIds={presetMissionIds}
				customMissions={customMissions}
				onColorChange={(hex) =>
					setValue("colorAccent", hex, {
						shouldValidate: true,
						shouldTouch: true,
						shouldDirty: true,
					})
				}
				onPresetToggle={togglePreset}
				onCustomAdd={addCustomMission}
				onCustomRemove={removeCustomMission}
				customMissionsError={errors.customMissions?.message}
			/>

			{/* Confirmação / erros */}
			{status.kind === "saved" ? (
				<p
					role="status"
					className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary"
				>
					<Check className="size-4 shrink-0" strokeWidth={3} />
					Alterações salvas
				</p>
			) : null}
			{status.kind === "not-found" ? (
				<p
					role="alert"
					className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
				>
					Evento não encontrado.
				</p>
			) : null}
			{status.kind === "error" ? (
				<p
					role="alert"
					className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
				>
					{status.message}
				</p>
			) : null}

			<Button
				type="submit"
				size="lg"
				className="w-full"
				disabled={!isValid || isSubmitting}
			>
				{isSubmitting ? "Salvando…" : "Salvar alterações"}
			</Button>
		</form>
	);
}
