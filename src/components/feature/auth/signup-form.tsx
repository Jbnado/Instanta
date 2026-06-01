import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff } from "lucide-react";

import {
	AUTH_ERROR_CODES,
	signupInputSchema,
	type SignupInput,
} from "@/lib/shared/schemas/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { PasswordStrengthMeter } from "./password-strength-meter";

interface Props {
	/**
	 * Chamado no signup com sucesso (HTTP 201). A rota standalone passa um
	 * `navigate({ to: '/' })`; a sheet da Story 5.3 passa o fechamento da sheet.
	 * Default: navega pra home via `window.location` (não depende de router,
	 * mantém o form embeddable e testável isoladamente).
	 */
	onSuccess?: () => void;
}

type FormStatus =
	| { kind: "idle" }
	| { kind: "rate-limited" }
	| { kind: "error"; message: string };

export function SignupForm({ onSuccess }: Props) {
	const [showPassword, setShowPassword] = useState(false);
	const [status, setStatus] = useState<FormStatus>({ kind: "idle" });

	const {
		register,
		handleSubmit,
		setError,
		watch,
		setValue,
		formState: { errors, isValid, isSubmitting },
	} = useForm<SignupInput>({
		resolver: zodResolver(signupInputSchema),
		mode: "onTouched",
		defaultValues: {
			email: "",
			password: "",
			displayName: "",
			// termsAccepted parte de `false`; Zod exige `literal(true)`.
			termsAccepted: false as unknown as true,
		},
	});

	const watchedPassword = watch("password") ?? "";
	const termsAccepted = watch("termsAccepted");

	const onSubmit = handleSubmit(async (data) => {
		setStatus({ kind: "idle" });

		let res: Response;
		try {
			res = await fetch("/api/auth/signup", {
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

		// 201 → conta criada, cookies setados pelo servidor.
		if (res.status === 201) {
			if (onSuccess) onSuccess();
			else window.location.assign("/");
			return;
		}

		// 429 → rate limit (NFR13). Mensagem humana, sem pânico.
		if (res.status === 429) {
			setStatus({ kind: "rate-limited" });
			return;
		}

		// 200 com `error` → erro de negócio mapeado pra microcopy no campo certo
		// (anti-enumeração via timing tratada no servidor; aqui só UX).
		if (res.status === 200) {
			const body = (await res.json().catch(() => null)) as
				| { error?: string }
				| null;

			if (body?.error === AUTH_ERROR_CODES.EMAIL_EXISTS) {
				setError("email", {
					message: "Esse email já tem conta. Esqueceu a senha?",
				});
				return;
			}
			if (body?.error === AUTH_ERROR_CODES.DISPOSABLE_EMAIL) {
				setError("email", {
					message: "Esse domínio de email não é aceito.",
				});
				return;
			}
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
		<form onSubmit={onSubmit} noValidate className="space-y-5">
			{/* Email */}
			<div className="space-y-1.5">
				<Label htmlFor="signup-email">Email</Label>
				<Input
					id="signup-email"
					type="email"
					autoComplete="email"
					autoCapitalize="none"
					spellCheck={false}
					placeholder="voce@exemplo.com"
					aria-invalid={errors.email ? true : undefined}
					aria-describedby={errors.email ? "signup-email-error" : undefined}
					{...register("email")}
				/>
				{errors.email ? (
					<p id="signup-email-error" className="text-sm text-destructive">
						{errors.email.message}
					</p>
				) : null}
			</div>

			{/* Senha */}
			<div className="space-y-1.5">
				<Label htmlFor="signup-password">Senha</Label>
				<div className="relative">
					<Input
						id="signup-password"
						type={showPassword ? "text" : "password"}
						autoComplete="new-password"
						className="pr-11"
						aria-invalid={errors.password ? true : undefined}
						aria-describedby={
							errors.password ? "signup-password-error" : undefined
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
					<p id="signup-password-error" className="text-sm text-destructive">
						{errors.password.message}
					</p>
				) : null}
				<PasswordStrengthMeter password={watchedPassword} />
			</div>

			{/* Nome */}
			<div className="space-y-1.5">
				<Label htmlFor="signup-display-name">Como te chamamos?</Label>
				<Input
					id="signup-display-name"
					type="text"
					autoComplete="nickname"
					placeholder="Seu nome ou apelido"
					aria-invalid={errors.displayName ? true : undefined}
					aria-describedby={
						errors.displayName ? "signup-display-name-error" : undefined
					}
					{...register("displayName")}
				/>
				{errors.displayName ? (
					<p
						id="signup-display-name-error"
						className="text-sm text-destructive"
					>
						{errors.displayName.message}
					</p>
				) : null}
			</div>

			{/* Termos */}
			<div className="space-y-1.5">
				<div className="flex items-start gap-2.5">
					<Checkbox
						id="signup-terms"
						checked={termsAccepted === true}
						aria-invalid={errors.termsAccepted ? true : undefined}
						onCheckedChange={(checked) =>
							setValue("termsAccepted", (checked === true) as true, {
								shouldValidate: true,
								shouldTouch: true,
							})
						}
					/>
					<Label htmlFor="signup-terms" className="leading-snug font-normal">
						{/* TODO: linkar os Termos e a Política de Privacidade reais
						    (planning-artifacts/legal/*) quando as páginas existirem. */}
						<span>
							Li e aceito os{" "}
							<a
								href="/termos"
								target="_blank"
								rel="noreferrer"
								className="font-medium text-primary underline-offset-4 hover:underline"
							>
								Termos de Uso
							</a>{" "}
							e a{" "}
							<a
								href="/privacidade"
								target="_blank"
								rel="noreferrer"
								className="font-medium text-primary underline-offset-4 hover:underline"
							>
								Política de Privacidade
							</a>
							.
						</span>
					</Label>
				</div>
				{errors.termsAccepted ? (
					<p className="text-sm text-destructive">
						{errors.termsAccepted.message}
					</p>
				) : null}
			</div>

			{/* Status global (rate limit / erro de servidor) */}
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
				{isSubmitting ? "Criando conta…" : "Criar conta"}
			</Button>
		</form>
	);
}
