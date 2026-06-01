import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zResolver } from "@/lib/zod-resolver";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Download } from "lucide-react";

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
	 * Chamado quando o setup é confirmado (HTTP 200 no /confirm). A rota
	 * standalone passa `navigate({ to: '/admin' })`. Mantido como prop pra deixar
	 * o componente testável sem montar router (espelha o `onSuccess` do signup).
	 */
	onConfirmed?: () => void;
}

// Estados do passo 1 (gerar secret + QR).
type SetupState =
	| { kind: "loading" }
	| { kind: "ready"; otpauthUri: string; secret: string }
	| { kind: "error"; message: string };

// Erro inline do passo 2 (confirmar código).
type ConfirmStatus =
	| { kind: "idle" }
	| { kind: "invalid" }
	| { kind: "error"; message: string };

export function MfaSetup({ onConfirmed }: Props) {
	const [setup, setSetup] = useState<SetupState>({ kind: "loading" });
	const [confirmStatus, setConfirmStatus] = useState<ConfirmStatus>({
		kind: "idle",
	});
	const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
	const [secretCopied, setSecretCopied] = useState(false);
	const [codesCopied, setCodesCopied] = useState(false);

	const {
		register,
		handleSubmit,
		formState: { errors, isValid, isSubmitting },
	} = useForm<MfaCodeInput>({
		resolver: zResolver<MfaCodeInput>(mfaCodeSchema),
		mode: "onTouched",
		defaultValues: { code: "" },
	});

	// No mount: pede o secret + otpauth URI pro servidor gerar o QR.
	useEffect(() => {
		let cancelled = false;

		(async () => {
			let res: Response;
			try {
				res = await fetch("/api/auth/mfa/setup", {
					method: "POST",
					credentials: "include",
				});
			} catch {
				if (!cancelled) {
					setSetup({
						kind: "error",
						message:
							"Não rolou iniciar a configuração. Confere sua internet e recarrega.",
					});
				}
				return;
			}

			if (cancelled) return;

			if (!res.ok) {
				setSetup({
					kind: "error",
					message: "Deu ruim ao gerar o código. Recarrega e tenta de novo.",
				});
				return;
			}

			const body = (await res.json().catch(() => null)) as {
				otpauthUri?: string;
				secret?: string;
			} | null;

			if (!body?.otpauthUri || !body?.secret) {
				setSetup({
					kind: "error",
					message: "Resposta inesperada do servidor. Recarrega e tenta de novo.",
				});
				return;
			}

			setSetup({
				kind: "ready",
				otpauthUri: body.otpauthUri,
				secret: body.secret,
			});
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	const onSubmit = handleSubmit(async (data) => {
		setConfirmStatus({ kind: "idle" });

		let res: Response;
		try {
			res = await fetch("/api/auth/mfa/confirm", {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(data),
			});
		} catch {
			setConfirmStatus({
				kind: "error",
				message: "Não rolou conectar. Confere sua internet e tenta de novo.",
			});
			return;
		}

		// 200 → MFA confirmado; servidor devolve os recovery codes.
		if (res.status === 200) {
			const body = (await res.json().catch(() => null)) as {
				recoveryCodes?: string[];
			} | null;
			setRecoveryCodes(body?.recoveryCodes ?? []);
			return;
		}

		// 400 MFA_INVALID_CODE → código errado, erro inline.
		if (res.status === 400) {
			const body = (await res.json().catch(() => null)) as {
				error?: string;
			} | null;
			if (body?.error === AUTH_ERROR_CODES.MFA_INVALID_CODE) {
				setConfirmStatus({ kind: "invalid" });
				return;
			}
		}

		// Qualquer outro → erro genérico.
		setConfirmStatus({
			kind: "error",
			message: "Deu ruim do nosso lado. Tenta de novo em instantes.",
		});
	});

	async function copySecret(secret: string) {
		try {
			await navigator.clipboard.writeText(secret);
			setSecretCopied(true);
			setTimeout(() => setSecretCopied(false), 2000);
		} catch {
			// Clipboard indisponível: o usuário ainda pode copiar manualmente.
		}
	}

	async function copyCodes(codes: string[]) {
		try {
			await navigator.clipboard.writeText(codes.join("\n"));
			setCodesCopied(true);
			setTimeout(() => setCodesCopied(false), 2000);
		} catch {
			// Silencioso: download continua disponível como alternativa.
		}
	}

	function downloadCodes(codes: string[]) {
		const blob = new Blob([codes.join("\n") + "\n"], { type: "text/plain" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "instanta-recovery-codes.txt";
		a.click();
		URL.revokeObjectURL(url);
	}

	// ── Passo 3: recovery codes (depois do confirm bem-sucedido) ───────────────
	if (recoveryCodes) {
		return (
			<section className="space-y-5">
				<div className="space-y-1.5 text-center">
					<h2 className="text-lg font-semibold tracking-tight">
						Guarde seus códigos de recuperação
					</h2>
					<p className="text-sm text-muted-foreground">
						São sua única forma de entrar se você perder o app authenticator.
						Guarde em local seguro — eles não serão mostrados de novo.
					</p>
				</div>

				<ul
					aria-label="Códigos de recuperação"
					className="grid grid-cols-2 gap-2 rounded-lg bg-muted px-4 py-3 font-mono text-sm"
				>
					{recoveryCodes.map((code) => (
						<li key={code} className="select-all tracking-wide">
							{code}
						</li>
					))}
				</ul>

				<div className="flex gap-2">
					<Button
						type="button"
						variant="outline"
						className="flex-1"
						onClick={() => copyCodes(recoveryCodes)}
					>
						{codesCopied ? (
							<>
								<Check className="size-4" /> Copiado
							</>
						) : (
							<>
								<Copy className="size-4" /> Copiar
							</>
						)}
					</Button>
					<Button
						type="button"
						variant="outline"
						className="flex-1"
						onClick={() => downloadCodes(recoveryCodes)}
					>
						<Download className="size-4" /> Baixar
					</Button>
				</div>

				<Button
					type="button"
					size="lg"
					className="w-full"
					onClick={() => {
						if (onConfirmed) onConfirmed();
						else window.location.assign("/admin");
					}}
				>
					Continuar
				</Button>
			</section>
		);
	}

	// ── Estado de erro ao gerar o setup ────────────────────────────────────────
	if (setup.kind === "error") {
		return (
			<p
				role="alert"
				className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
			>
				{setup.message}
			</p>
		);
	}

	// ── Estado de carregamento ──────────────────────────────────────────────────
	if (setup.kind === "loading") {
		return (
			<p role="status" className="text-center text-sm text-muted-foreground">
				Gerando seu código de configuração…
			</p>
		);
	}

	// ── Passos 1 + 2: QR + secret manual + input do código ─────────────────────
	return (
		<section className="space-y-6">
			<div className="space-y-1.5 text-center">
				<p className="text-sm text-muted-foreground">
					Escaneie o QR Code com seu app authenticator (Google Authenticator,
					1Password, etc.) e digite o código de 6 dígitos pra confirmar.
				</p>
			</div>

			{/* QR Code gerado a partir do otpauth URI vindo do servidor. */}
			<div className="flex justify-center">
				<div className="rounded-lg bg-white p-3">
					<QRCodeSVG
						value={setup.otpauthUri}
						size={184}
						title="QR Code de configuração do MFA"
					/>
				</div>
			</div>

			{/* Secret manual pra quem não consegue escanear o QR. */}
			<div className="space-y-1.5">
				<Label htmlFor="mfa-secret">Ou digite o código manualmente</Label>
				<div className="flex items-center gap-2">
					<code
						id="mfa-secret"
						className="flex-1 overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-sm tracking-wider select-all"
					>
						{setup.secret}
					</code>
					<Button
						type="button"
						variant="outline"
						size="icon"
						aria-label="Copiar código"
						onClick={() => copySecret(setup.secret)}
					>
						{secretCopied ? (
							<Check className="size-4" />
						) : (
							<Copy className="size-4" />
						)}
					</Button>
				</div>
			</div>

			{/* Confirmação: código de 6 dígitos do app. */}
			<form onSubmit={onSubmit} noValidate className="space-y-4">
				<div className="space-y-1.5">
					<Label htmlFor="mfa-code">Código de 6 dígitos</Label>
					<Input
						id="mfa-code"
						type="text"
						inputMode="numeric"
						autoComplete="one-time-code"
						maxLength={6}
						placeholder="000000"
						className="text-center font-mono text-lg tracking-[0.4em]"
						aria-invalid={errors.code ? true : undefined}
						aria-describedby={errors.code ? "mfa-code-error" : undefined}
						{...register("code")}
					/>
					{errors.code ? (
						<p id="mfa-code-error" className="text-sm text-destructive">
							{errors.code.message}
						</p>
					) : null}
				</div>

				{confirmStatus.kind === "invalid" ? (
					<p
						role="alert"
						className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
					>
						Código inválido, tenta de novo.
					</p>
				) : null}
				{confirmStatus.kind === "error" ? (
					<p
						role="alert"
						className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
					>
						{confirmStatus.message}
					</p>
				) : null}

				<Button
					type="submit"
					size="lg"
					className="w-full"
					disabled={!isValid || isSubmitting}
				>
					{isSubmitting ? "Confirmando…" : "Confirmar"}
				</Button>
			</form>
		</section>
	);
}
