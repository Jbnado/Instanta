import { useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { SignupForm } from "./signup-form";
import { LoginForm } from "./login-form";

/**
 * GuestSignupSheet (Story 5.3) — bottom sheet de cadastro/login do convidado.
 *
 * O convidado precisa estar autenticado pra participar de um evento (FR17). Quando
 * chega na landing `/event/:slug` deslogado, esta sheet sobe de baixo (mobile-first)
 * e REUSA o `SignupForm` (Story 2.1) — que foi feito embeddable justamente pra isso —
 * mais o `LoginForm` pra quem já tem conta. Após signup/login com sucesso, ambos os
 * forms setam cookies httpOnly no servidor e disparam `onAuthenticated`, que a landing
 * usa pra prosseguir com o join no evento.
 *
 * Modal acessível via Radix Dialog (focus trap + Esc + aria). Estilizado como bottom
 * sheet (ancorado embaixo, full-width) pra a fricção mínima de onboarding mobile.
 */

interface Props {
	open: boolean;
	/** Nome do evento — contextualiza o convidado ("Entre pra participar de {nome}"). */
	eventName: string;
	/** Disparado quando o usuário fecha a sheet sem autenticar (Esc / overlay / X). */
	onOpenChange: (open: boolean) => void;
	/** Disparado após signup (201) OU login (200) com sucesso — a landing faz o join. */
	onAuthenticated: () => void;
}

type Mode = "signup" | "login";

export function GuestSignupSheet({
	open,
	eventName,
	onOpenChange,
	onAuthenticated,
}: Props) {
	const [mode, setMode] = useState<Mode>("signup");

	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay
					data-slot="guest-sheet-overlay"
					className={cn(
						"fixed inset-0 z-50 bg-black/50",
						"data-[state=open]:animate-in data-[state=closed]:animate-out",
						"data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
					)}
				/>
				<DialogPrimitive.Content
					data-slot="guest-sheet-content"
					className={cn(
						"fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-md flex-col gap-5 overflow-y-auto rounded-t-2xl border-t border-border bg-background px-6 pb-8 pt-6 shadow-lg",
						"data-[state=open]:animate-in data-[state=closed]:animate-out",
						"data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
					)}
				>
					<DialogPrimitive.Close
						data-slot="guest-sheet-close"
						aria-label="Fechar"
						className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
					>
						<X className="size-4" />
					</DialogPrimitive.Close>

					<div className="space-y-1.5 pr-8 text-left">
						<DialogPrimitive.Title className="text-xl font-semibold tracking-tight">
							{mode === "signup"
								? "Crie sua conta pra entrar"
								: "Entre na sua conta"}
						</DialogPrimitive.Title>
						<DialogPrimitive.Description className="text-sm text-muted-foreground">
							{mode === "signup"
								? `Cadastro rápido pra participar de ${eventName}.`
								: `Entre pra participar de ${eventName}.`}
						</DialogPrimitive.Description>
					</div>

					{mode === "signup" ? (
						<SignupForm onSuccess={onAuthenticated} />
					) : (
						<LoginForm onSuccess={onAuthenticated} />
					)}

					{/* Alterna entre cadastro e login sem sair da sheet. */}
					<p className="text-center text-sm text-muted-foreground">
						{mode === "signup" ? (
							<>
								Já tem conta?{" "}
								<button
									type="button"
									onClick={() => setMode("login")}
									className="font-medium text-primary underline-offset-4 hover:underline"
								>
									Entrar
								</button>
							</>
						) : (
							<>
								Ainda não tem conta?{" "}
								<button
									type="button"
									onClick={() => setMode("signup")}
									className="font-medium text-primary underline-offset-4 hover:underline"
								>
									Criar conta
								</button>
							</>
						)}
					</p>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
