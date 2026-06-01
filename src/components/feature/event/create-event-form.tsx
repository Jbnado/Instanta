import { useState } from "react";
import { useForm } from "react-hook-form";
import { zResolver } from "@/lib/zod-resolver";
import { Eye, EyeOff, Check, Plus, X } from "lucide-react";

import {
	createEventSchema,
	EVENT_ERROR_CODES,
	type CreateEventInput,
} from "@/lib/shared/schemas/event";
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

/** Teto de missões personalizadas (espelha o schema; usado pra travar o botão "adicionar"). */
const MAX_CUSTOM_MISSIONS = 10;

interface Props {
	/**
	 * Chamado na criação com sucesso (HTTP 201). A página passa um callback que
	 * troca pro painel de sucesso inline. Sem callback, o form ainda mostra o
	 * próprio estado de sucesso interno (mantém embeddable/testável isolado).
	 */
	onSuccess?: (event: { slug: string; name: string }) => void;
}

type FormStatus =
	| { kind: "idle" }
	| { kind: "active-limit" }
	| { kind: "rate-limited" }
	| { kind: "error"; message: string }
	| { kind: "success"; name: string };

/** Resposta 201 do POST /api/events. */
interface CreatedEventResponse {
	event: {
		id: string;
		slug: string;
		name: string;
		status: string;
		colorAccent: string;
	};
}

export function CreateEventForm({ onSuccess }: Props) {
	const [showPassword, setShowPassword] = useState(false);
	const [status, setStatus] = useState<FormStatus>({ kind: "idle" });
	// Buffer do input de missão personalizada (fora do RHF — só vira item ao adicionar).
	const [customDraft, setCustomDraft] = useState("");

	const {
		register,
		handleSubmit,
		watch,
		setValue,
		formState: { errors, isValid, isSubmitting },
	} = useForm<CreateEventInput>({
		resolver: zResolver<CreateEventInput>(createEventSchema),
		mode: "onTouched",
		defaultValues: {
			name: "",
			description: "",
			password: "",
			colorAccent: DEFAULT_ACCENT_HEX,
			presetMissionIds: [],
			customMissions: [],
		},
	});

	const colorAccent = watch("colorAccent") ?? DEFAULT_ACCENT_HEX;
	const presetMissionIds = watch("presetMissionIds") ?? [];
	const customMissions = watch("customMissions") ?? [];

	/** Liga/desliga um preset na lista `presetMissionIds`. */
	function togglePreset(id: string) {
		const next = presetMissionIds.includes(id)
			? presetMissionIds.filter((p) => p !== id)
			: [...presetMissionIds, id];
		setValue("presetMissionIds", next, {
			shouldValidate: true,
			shouldTouch: true,
		});
	}

	/** Adiciona o rascunho atual como missão personalizada (respeitando o teto). */
	function addCustomMission() {
		const value = customDraft.trim();
		if (!value) return;
		if (customMissions.length >= MAX_CUSTOM_MISSIONS) return;
		setValue("customMissions", [...customMissions, value], {
			shouldValidate: true,
			shouldTouch: true,
		});
		setCustomDraft("");
	}

	/** Remove a missão personalizada do índice informado. */
	function removeCustomMission(index: number) {
		setValue(
			"customMissions",
			customMissions.filter((_, i) => i !== index),
			{ shouldValidate: true, shouldTouch: true },
		);
	}

	const onSubmit = handleSubmit(async (data) => {
		setStatus({ kind: "idle" });

		let res: Response;
		try {
			res = await fetch("/api/events", {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(data),
			});
		} catch {
			setStatus({
				kind: "error",
				message: "Não rolou conectar. Confere sua internet e tenta de novo.",
			});
			return;
		}

		// 201 → evento criado (nasce Inativo, sem QR Code/link até admin ativar).
		if (res.status === 201) {
			const body = (await res.json().catch(() => null)) as
				| CreatedEventResponse
				| null;
			const created = body?.event;
			const name = created?.name ?? data.name;
			setStatus({ kind: "success", name });
			if (created && onSuccess) {
				onSuccess({ slug: created.slug, name: created.name });
			}
			return;
		}

		// 403 → limite de 3 eventos ativos (NFR58).
		if (res.status === 403) {
			const body = (await res.json().catch(() => null)) as
				| { error?: string }
				| null;
			if (body?.error === EVENT_ERROR_CODES.ACTIVE_LIMIT_REACHED) {
				setStatus({ kind: "active-limit" });
				return;
			}
			setStatus({
				kind: "error",
				message: "Você não tem permissão pra criar esse evento.",
			});
			return;
		}

		// 429 → rate limit de criações no dia (NFR13).
		if (res.status === 429) {
			setStatus({ kind: "rate-limited" });
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

	// Estado de sucesso: substitui o form pelo painel de confirmação (sem navegar —
	// a rota /event/$slug/host é da Story 3.2/3.4, ainda não existe).
	if (status.kind === "success") {
		return (
			<div
				role="status"
				className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 px-5 py-6 text-center"
			>
				<div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary">
					<Check className="size-6" strokeWidth={3} />
				</div>
				<h2 className="text-lg font-semibold">Evento criado!</h2>
				<p className="text-sm text-muted-foreground">
					<span className="font-medium text-foreground">{status.name}</span>{" "}
					está <strong>aguardando ativação</strong> — você receberá o QR Code e
					o link quando for ativado.
				</p>
			</div>
		);
	}

	return (
		<form onSubmit={onSubmit} noValidate className="space-y-6">
			{/* Nome */}
			<div className="space-y-1.5">
				<Label htmlFor="event-name">Nome do evento</Label>
				<Input
					id="event-name"
					type="text"
					placeholder="Aniversário da Ana, Casamento, Confra…"
					aria-invalid={errors.name ? true : undefined}
					aria-describedby={errors.name ? "event-name-error" : undefined}
					{...register("name")}
				/>
				{errors.name ? (
					<p id="event-name-error" className="text-sm text-destructive">
						{errors.name.message}
					</p>
				) : null}
			</div>

			{/* Data */}
			<div className="space-y-1.5">
				<Label htmlFor="event-date">Data do evento</Label>
				<Input
					id="event-date"
					type="date"
					aria-invalid={errors.eventDate ? true : undefined}
					aria-describedby={errors.eventDate ? "event-date-error" : undefined}
					{...register("eventDate")}
				/>
				{errors.eventDate ? (
					<p id="event-date-error" className="text-sm text-destructive">
						{errors.eventDate.message}
					</p>
				) : null}
			</div>

			{/* Descrição (opcional) */}
			<div className="space-y-1.5">
				<Label htmlFor="event-description">
					Descrição <span className="text-muted-foreground">(opcional)</span>
				</Label>
				<textarea
					id="event-description"
					rows={3}
					placeholder="Um recado pros convidados, tema da festa, dress code…"
					aria-invalid={errors.description ? true : undefined}
					aria-describedby={
						errors.description ? "event-description-error" : undefined
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
					<p id="event-description-error" className="text-sm text-destructive">
						{errors.description.message}
					</p>
				) : null}
			</div>

			{/* Senha do evento */}
			<div className="space-y-1.5">
				<Label htmlFor="event-password">Senha do evento</Label>
				<div className="relative">
					<Input
						id="event-password"
						type={showPassword ? "text" : "password"}
						autoComplete="off"
						className="pr-11"
						placeholder="Código que os convidados vão digitar"
						aria-invalid={errors.password ? true : undefined}
						aria-describedby={
							errors.password ? "event-password-error" : undefined
						}
						{...register("password")}
					/>
					<button
						type="button"
						onClick={() => setShowPassword((s) => !s)}
						aria-label={showPassword ? "Esconder senha" : "Mostrar senha"}
						aria-pressed={showPassword}
						className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
					>
						{showPassword ? (
							<EyeOff className="size-4" />
						) : (
							<Eye className="size-4" />
						)}
					</button>
				</div>
				{errors.password ? (
					<p id="event-password-error" className="text-sm text-destructive">
						{errors.password.message}
					</p>
				) : null}
			</div>

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
						const selected = colorAccent === color.hex;
						return (
							<button
								key={color.hex}
								type="button"
								role="radio"
								aria-checked={selected}
								aria-label={color.name}
								title={color.name}
								onClick={() =>
									setValue("colorAccent", color.hex, {
										shouldValidate: true,
										shouldTouch: true,
									})
								}
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
									onCheckedChange={() => togglePreset(mission.id)}
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
									onClick={() => removeCustomMission(index)}
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
									addCustomMission();
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
							onClick={addCustomMission}
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

				{errors.customMissions ? (
					<p className="text-sm text-destructive">
						{errors.customMissions.message}
					</p>
				) : null}
			</fieldset>

			{/* Status global */}
			{status.kind === "active-limit" ? (
				<p
					role="alert"
					className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
				>
					Você já tem 3 eventos ativos. Encerre um antes de criar outro.
				</p>
			) : null}
			{status.kind === "rate-limited" ? (
				<p
					role="alert"
					className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
				>
					Muitas criações hoje. Tenta de novo amanhã.
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
				{isSubmitting ? "Criando evento…" : "Criar evento"}
			</Button>
		</form>
	);
}
