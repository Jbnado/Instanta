import { useState } from "react";
import { useForm } from "react-hook-form";
import { zResolver } from "@/lib/zod-resolver";
import { Eye, EyeOff } from "lucide-react";
import { Link } from "@tanstack/react-router";

import {
	AUTH_ERROR_CODES,
	resetConfirmSchema,
	type ResetConfirmInput,
} from "@/lib/shared/schemas/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { PasswordStrengthMeter } from "./password-strength-meter";

interface Props {
	/** Token do link de reset (vem da query string `?token=`). */
	token: string;
	/**
	 * Chamado no reset com sucesso (HTTP 200). A rota standalone passa um
	 * `navigate({ to: '/auth/login' })`. Sem default: a rota é quem decide o
	 * destino pós-sucesso, mantendo o form embeddable e testável isoladamente.
	 */
	onSuccess?: () => void;
}

type FormStatus =
	| { kind: "idle" }
	| { kind: "success" }
	| { kind: "invalid-token" }
	| { kind: "rate-limited" }
	| { kind: "error"; message: string };

export function ResetConfirmForm({ token, onSuccess }: Props) {
	const [showPassword, setShowPassword] = useState(false);
	const [status, setStatus] = useState<FormStatus>({ kind: "idle" });

	const {
		register,
		handleSubmit,
		watch,
		formState: { errors, isValid, isSubmitting },
	} = useForm<ResetConfirmInput>({
		resolver: zResolver<ResetConfirmInput>(resetConfirmSchema),
		mode: "onTouched",
		defaultValues: {
			// Token vem da query string e viaja no payload via campo hidden registrado.
			token,
			password: "",
		},
	});

	const watchedPassword = watch("password") ?? "";

	const onSubmit = handleSubmit(async (data) => {
		setStatus({ kind: "idle" });

		let res: Response;
		try {
			res = await fetch("/api/auth/reset-confirm", {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				// Envia só token + senha — exatamente o contrato do schema.
				body: JSON.stringify({ token: data.token, password: data.password }),
			});
		} catch {
			setStatus({
				kind: "error",
				message: "Não rolou conectar. Confere sua internet e tenta de novo.",
			});
			return;
		}

		// 200 → senha trocada, sessões antigas revogadas pelo servidor.
		if (res.status === 200) {
			setStatus({ kind: "success" });
			if (onSuccess) onSuccess();
			return;
		}

		// 429 → rate limit (NFR13). Sem infra de toast no projeto ainda; usamos o
		// mesmo padrão de alerta inline de login/signup.
		if (res.status === 429) {
			setStatus({ kind: "rate-limited" });
			return;
		}

		// 400 INVALID_RESET_TOKEN → token expirado/inválido/já usado (Story 2.5).
		if (res.status === 400) {
			const body = (await res.json().catch(() => null)) as
				| { error?: string }
				| null;
			if (body?.error === AUTH_ERROR_CODES.INVALID_RESET_TOKEN) {
				setStatus({ kind: "invalid-token" });
				return;
			}
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

	// Sucesso: confirma e some com o form (a rota navega pro login via onSuccess).
	if (status.kind === "success") {
		return (
			<div
				role="status"
				className="rounded-lg bg-muted px-4 py-5 text-center text-sm text-foreground"
			>
				<p className="font-medium">Senha redefinida com sucesso.</p>
				<p className="mt-2 text-muted-foreground">
					Você já pode entrar com a nova senha.
				</p>
			</div>
		);
	}

	// Token inválido/expirado: oferece recomeçar o fluxo.
	if (status.kind === "invalid-token") {
		return (
			<div
				role="alert"
				className="space-y-3 rounded-lg bg-destructive/10 px-4 py-5 text-center text-sm text-destructive"
			>
				<p className="font-medium">Link expirado ou inválido. Solicite um novo.</p>
				<Link
					to="/auth/reset"
					className="inline-block font-medium underline underline-offset-4"
				>
					Solicitar novo link
				</Link>
			</div>
		);
	}

	return (
		<form onSubmit={onSubmit} noValidate className="space-y-5">
			{/* Token: campo hidden registrado, viaja no payload. */}
			<input type="hidden" {...register("token")} />

			{/* Nova senha */}
			<div className="space-y-1.5">
				<Label htmlFor="reset-confirm-password">Nova senha</Label>
				<div className="relative">
					<Input
						id="reset-confirm-password"
						type={showPassword ? "text" : "password"}
						autoComplete="new-password"
						className="pr-11"
						aria-invalid={errors.password ? true : undefined}
						aria-describedby={
							errors.password ? "reset-confirm-password-error" : undefined
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
					<p
						id="reset-confirm-password-error"
						className="text-sm text-destructive"
					>
						{errors.password.message}
					</p>
				) : null}
				<PasswordStrengthMeter password={watchedPassword} />
			</div>

			{/* Status global (rate limit / erro de servidor). */}
			{status.kind === "rate-limited" ? (
				<p
					role="alert"
					className={cn(
						"rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive",
					)}
				>
					Muitas tentativas. Tenta de novo em alguns minutos.
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
				{isSubmitting ? "Salvando…" : "Definir nova senha"}
			</Button>
		</form>
	);
}
