import { useState } from "react";

import type { EventDetail } from "@/lib/shared/schemas/event";
import { Button } from "@/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * Botão destrutivo "Encerrar evento" (Story 3.5, FR14, UX-DR15).
 *
 * Abre um AlertDialog de confirmação — encerrar é irreversível (status vira
 * Encerrado, `ended_at` setado no backend), então exigimos um passo extra.
 * Ao confirmar: POST /api/events/:slug/close. No 200 chamamos `onClosed` com o
 * evento atualizado (a rota pai re-renderiza pro painel "encerrado"); em erro,
 * mostramos um alerta inline DENTRO do diálogo (não fecha sozinho).
 */

interface Props {
	/** Slug do evento a encerrar. */
	slug: string;
	/** Chamado quando o POST /close responde 200, com o EventDetail atualizado. */
	onClosed?: (event: EventDetail) => void;
}

type CloseStatus =
	| { kind: "idle" }
	| { kind: "submitting" }
	| { kind: "error"; message: string };

/** Resposta 200 do POST /api/events/:slug/close. */
interface ClosedEventResponse {
	event: EventDetail;
}

export function CloseEventButton({ slug, onClosed }: Props) {
	const [open, setOpen] = useState(false);
	const [status, setStatus] = useState<CloseStatus>({ kind: "idle" });

	async function handleConfirm() {
		setStatus({ kind: "submitting" });

		let res: Response;
		try {
			res = await fetch(`/api/events/${slug}/close`, {
				method: "POST",
				credentials: "include",
			});
		} catch {
			setStatus({
				kind: "error",
				message: "Não rolou conectar. Confere sua internet e tenta de novo.",
			});
			return;
		}

		// 200 → encerrado. Repassa o EventDetail atualizado e fecha o diálogo.
		if (res.ok) {
			const body = (await res.json().catch(() => null)) as
				| ClosedEventResponse
				| null;
			setStatus({ kind: "idle" });
			setOpen(false);
			if (body?.event && onClosed) {
				onClosed(body.event);
			}
			return;
		}

		// 400 INVALID_STATE → evento não estava Ativo (ex: já encerrado noutra aba).
		if (res.status === 400) {
			setStatus({
				kind: "error",
				message: "Esse evento não pode ser encerrado agora (já não está ativo).",
			});
			return;
		}

		// 404 → evento não existe / não é seu.
		if (res.status === 404) {
			setStatus({
				kind: "error",
				message: "Evento não encontrado.",
			});
			return;
		}

		// 500 e qualquer outro → erro genérico.
		setStatus({
			kind: "error",
			message: "Deu ruim do nosso lado. Tenta de novo em instantes.",
		});
	}

	const submitting = status.kind === "submitting";

	return (
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				// Ao fechar (cancelar/Esc), limpa qualquer erro pendente.
				setOpen(next);
				if (!next) setStatus({ kind: "idle" });
			}}
		>
			<AlertDialogTrigger asChild>
				<Button type="button" variant="destructive" size="lg" className="w-full">
					Encerrar evento
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Encerrar este evento?</AlertDialogTitle>
					<AlertDialogDescription>
						Ao encerrar, o evento para de aceitar novas fotos e o QR Code/link
						deixam de funcionar. Isso não pode ser desfeito.
					</AlertDialogDescription>
				</AlertDialogHeader>

				{status.kind === "error" ? (
					<p
						role="alert"
						className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
					>
						{status.message}
					</p>
				) : null}

				<AlertDialogFooter>
					<AlertDialogCancel disabled={submitting}>Cancelar</AlertDialogCancel>
					{/* Ação destrutiva — sobrescreve o estilo default do AlertDialogAction
					    pra usar a variante destructive. `onClick` com preventDefault não é
					    necessário: o diálogo só fecha via setOpen no 200. */}
					<AlertDialogAction
						className="bg-destructive/10 text-destructive hover:bg-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30"
						disabled={submitting}
						onClick={(e) => {
							// Impede o fechamento automático do Radix: só fechamos no 200
							// (senão o diálogo sumiria antes do erro inline aparecer).
							e.preventDefault();
							void handleConfirm();
						}}
					>
						{submitting ? "Encerrando…" : "Encerrar evento"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
