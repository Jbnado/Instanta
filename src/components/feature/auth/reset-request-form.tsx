import { useState } from "react";
import { useForm } from "react-hook-form";
import { zResolver } from "@/lib/zod-resolver";

import {
	resetRequestSchema,
	type ResetRequestInput,
} from "@/lib/shared/schemas/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Form de SOLICITAÇÃO de reset (Story 2.4).
 *
 * Anti-enumeração estrita (FR65): independente do email existir ou não — e mesmo
 * em erros benignos do servidor (404/500) — mostramos a MESMA mensagem de
 * confirmação. Nunca revelamos se a conta existe. O único estado que difere é o
 * 429 (rate limit), que é uma proteção operacional, não um vazamento de
 * existência (o limite é por email tentado, não por email cadastrado).
 */

// Mensagem ÚNICA de confirmação (FR65). Constante exportada pra travar no teste
// que sucesso e erro mostram exatamente o mesmo texto.
export const RESET_CONFIRMATION_MESSAGE =
	"Se este email estiver cadastrado, você receberá um link em até 5 minutos.";

type FormStatus =
	| { kind: "idle" }
	| { kind: "submitted" }
	| { kind: "rate-limited" };

export function ResetRequestForm() {
	const [status, setStatus] = useState<FormStatus>({ kind: "idle" });

	const {
		register,
		handleSubmit,
		formState: { errors, isValid, isSubmitting },
	} = useForm<ResetRequestInput>({
		resolver: zResolver<ResetRequestInput>(resetRequestSchema),
		mode: "onTouched",
		defaultValues: {
			email: "",
		},
	});

	const onSubmit = handleSubmit(async (data) => {
		let res: Response;
		try {
			res = await fetch("/api/auth/reset", {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(data),
			});
		} catch {
			// Falha de rede também não pode revelar existência. Mostramos a
			// confirmação idêntica — o servidor reenvia/expira tokens com segurança.
			setStatus({ kind: "submitted" });
			return;
		}

		// 429 → rate limit (NFR13: 3 resets/hora/email). Proteção operacional, não
		// vazamento de existência — pode mostrar mensagem distinta.
		if (res.status === 429) {
			setStatus({ kind: "rate-limited" });
			return;
		}

		// QUALQUER outro caso (2xx de sucesso E erros benignos 404/500) → mensagem
		// IDÊNTICA. Anti-enumeração: nunca revela se o email existe (FR65).
		setStatus({ kind: "submitted" });
	});

	// Estado final de confirmação: substitui o form inteiro. Mesma mensagem
	// sempre, independente do resultado real no servidor.
	if (status.kind === "submitted") {
		return (
			<div
				role="status"
				className="rounded-lg bg-muted px-4 py-5 text-center text-sm text-foreground"
			>
				<p className="font-medium">{RESET_CONFIRMATION_MESSAGE}</p>
				<p className="mt-2 text-muted-foreground">
					Não chegou? Confere a caixa de spam antes de tentar de novo.
				</p>
			</div>
		);
	}

	return (
		<form onSubmit={onSubmit} noValidate className="space-y-5">
			{/* Email */}
			<div className="space-y-1.5">
				<Label htmlFor="reset-email">Email</Label>
				<Input
					id="reset-email"
					type="email"
					autoComplete="email"
					autoCapitalize="none"
					spellCheck={false}
					placeholder="voce@exemplo.com"
					aria-invalid={errors.email ? true : undefined}
					aria-describedby={errors.email ? "reset-email-error" : undefined}
					{...register("email")}
				/>
				{errors.email ? (
					<p id="reset-email-error" className="text-sm text-destructive">
						{errors.email.message}
					</p>
				) : null}
			</div>

			{/* Status global (apenas rate limit; sucesso/erro viram a confirmação). */}
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

			<Button
				type="submit"
				size="lg"
				className="w-full"
				disabled={!isValid || isSubmitting}
			>
				{isSubmitting ? "Enviando…" : "Enviar link de recuperação"}
			</Button>
		</form>
	);
}
