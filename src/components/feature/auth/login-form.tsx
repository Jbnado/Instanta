import { useState } from "react";
import { useForm } from "react-hook-form";
import { zResolver } from "@/lib/zod-resolver";
import { Eye, EyeOff } from "lucide-react";
import { Link } from "@tanstack/react-router";

import {
	AUTH_ERROR_CODES,
	loginInputSchema,
	type LoginInput,
} from "@/lib/shared/schemas/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface Props {
	/**
	 * Chamado no login com sucesso (HTTP 200). A rota standalone passa um
	 * `navigate({ to: '/' })`. Default: navega pra home via `window.location`
	 * (não depende de router, mantém o form embeddable e testável isoladamente).
	 */
	onSuccess?: () => void;
}

type FormStatus =
	| { kind: "idle" }
	| { kind: "rate-limited" }
	| { kind: "error"; message: string };

export function LoginForm({ onSuccess }: Props) {
	const [showPassword, setShowPassword] = useState(false);
	const [status, setStatus] = useState<FormStatus>({ kind: "idle" });

	const {
		register,
		handleSubmit,
		formState: { errors, isValid, isSubmitting },
	} = useForm<LoginInput>({
		resolver: zResolver<LoginInput>(loginInputSchema),
		mode: "onTouched",
		defaultValues: {
			email: "",
			password: "",
		},
	});

	const onSubmit = handleSubmit(async (data) => {
		setStatus({ kind: "idle" });

		let res: Response;
		try {
			res = await fetch("/api/auth/login", {
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

		// 200 → login ok, cookies setados pelo servidor.
		if (res.status === 200) {
			if (onSuccess) onSuccess();
			else window.location.assign("/");
			return;
		}

		// 429 → rate limit (NFR13). Mensagem humana, sem pânico.
		if (res.status === 429) {
			setStatus({ kind: "rate-limited" });
			return;
		}

		// 401 → credenciais inválidas. Mensagem GENÉRICA (anti-enumeração): não
		// distingue email-não-existe de senha-errada. Mostrada como status global,
		// não num campo específico, pra não vazar qual campo está "errado".
		if (res.status === 401) {
			setStatus({
				kind: "error",
				message: "Email ou senha inválidos.",
			});
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

	// Referência a AUTH_ERROR_CODES mantém o contrato front↔back explícito mesmo
	// sem mapear por campo (o 401 já carrega a semântica INVALID_CREDENTIALS).
	void AUTH_ERROR_CODES.INVALID_CREDENTIALS;

	return (
		<form onSubmit={onSubmit} noValidate className="space-y-5">
			{/* Email */}
			<div className="space-y-1.5">
				<Label htmlFor="login-email">Email</Label>
				<Input
					id="login-email"
					type="email"
					autoComplete="email"
					autoCapitalize="none"
					spellCheck={false}
					placeholder="voce@exemplo.com"
					aria-invalid={errors.email ? true : undefined}
					aria-describedby={errors.email ? "login-email-error" : undefined}
					{...register("email")}
				/>
				{errors.email ? (
					<p id="login-email-error" className="text-sm text-destructive">
						{errors.email.message}
					</p>
				) : null}
			</div>

			{/* Senha */}
			<div className="space-y-1.5">
				<Label htmlFor="login-password">Senha</Label>
				<div className="relative">
					<Input
						id="login-password"
						type={showPassword ? "text" : "password"}
						autoComplete="current-password"
						className="pr-11"
						aria-invalid={errors.password ? true : undefined}
						aria-describedby={
							errors.password ? "login-password-error" : undefined
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
					<p id="login-password-error" className="text-sm text-destructive">
						{errors.password.message}
					</p>
				) : null}
				{/* Atalho pro fluxo de reset (Story 2.4). */}
				<div className="text-right">
					<Link
						to="/auth/reset"
						className="text-sm font-medium text-primary underline-offset-4 hover:underline"
					>
						Esqueci minha senha
					</Link>
				</div>
			</div>

			{/* Status global (rate limit / credenciais inválidas / erro de servidor) */}
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
				{isSubmitting ? "Entrando…" : "Entrar"}
			</Button>
		</form>
	);
}
