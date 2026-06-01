import { useState } from "react";
import { useForm } from "react-hook-form";
import { zResolver } from "@/lib/zod-resolver";

import {
	AUTH_ERROR_CODES,
	mfaCodeSchema,
	type MfaCodeInput,
} from "@/lib/shared/schemas/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
	/**
	 * Chamado quando o 2º fator é verificado (HTTP 200). A rota standalone passa
	 * `navigate({ to: '/admin' })`. Prop pra deixar o componente testável sem
	 * router (espelha o `onSuccess` do signup/login).
	 */
	onVerified?: () => void;
}

type VerifyStatus =
	| { kind: "idle" }
	| { kind: "invalid" }
	| { kind: "replay" }
	| { kind: "error"; message: string };

export function MfaVerify({ onVerified }: Props) {
	const [status, setStatus] = useState<VerifyStatus>({ kind: "idle" });

	const {
		register,
		handleSubmit,
		formState: { errors, isValid, isSubmitting },
	} = useForm<MfaCodeInput>({
		resolver: zResolver<MfaCodeInput>(mfaCodeSchema),
		mode: "onTouched",
		defaultValues: { code: "" },
	});

	const onSubmit = handleSubmit(async (data) => {
		setStatus({ kind: "idle" });

		let res: Response;
		try {
			res = await fetch("/api/auth/mfa/verify", {
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

		// 200 → 2º fator OK; segue pro painel.
		if (res.status === 200) {
			if (onVerified) onVerified();
			else window.location.assign("/admin");
			return;
		}

		if (res.status === 400) {
			const body = (await res.json().catch(() => null)) as {
				error?: string;
			} | null;

			// Replay: código já usado nos últimos 30s (proteção da Story 2.8).
			if (body?.error === AUTH_ERROR_CODES.MFA_REPLAY) {
				setStatus({ kind: "replay" });
				return;
			}
			// Código fora da janela ±1 / formato aceito mas inválido.
			if (body?.error === AUTH_ERROR_CODES.MFA_INVALID_CODE) {
				setStatus({ kind: "invalid" });
				return;
			}
		}

		// Qualquer outro → erro genérico.
		setStatus({
			kind: "error",
			message: "Deu ruim do nosso lado. Tenta de novo em instantes.",
		});
	});

	return (
		<form onSubmit={onSubmit} noValidate className="space-y-5">
			<div className="space-y-1.5">
				<Label htmlFor="mfa-verify-code">Código de 6 dígitos</Label>
				<Input
					id="mfa-verify-code"
					type="text"
					inputMode="numeric"
					autoComplete="one-time-code"
					maxLength={6}
					placeholder="000000"
					className="text-center font-mono text-lg tracking-[0.4em]"
					aria-invalid={errors.code ? true : undefined}
					aria-describedby={errors.code ? "mfa-verify-code-error" : undefined}
					{...register("code")}
				/>
				{errors.code ? (
					<p id="mfa-verify-code-error" className="text-sm text-destructive">
						{errors.code.message}
					</p>
				) : null}
			</div>

			{status.kind === "invalid" ? (
				<p
					role="alert"
					className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
				>
					Código inválido.
				</p>
			) : null}
			{status.kind === "replay" ? (
				<p
					role="alert"
					className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
				>
					Esse código já foi usado, espere o próximo.
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
				{isSubmitting ? "Verificando…" : "Verificar"}
			</Button>
		</form>
	);
}
