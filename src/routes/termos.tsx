import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { TermosDeUso } from "@/content/legal/termos-de-uso";
import { LegalDocument } from "@/components/feature/legal/legal-document";

/**
 * Tela de leitura dos Termos de Uso (/termos). Conteúdo prose copiado de
 * planning-artifacts/legal/termos-de-uso.md pra dentro do bundle (NÃO importa de
 * _bmad-output). Linkada pelo checkbox de T&C do signup.
 */
export const Route = createFileRoute("/termos")({
	component: TermosPage,
});

function TermosPage() {
	return (
		<LegalDocument
			title="Termos de Uso"
			back={
				<Link
					to="/"
					className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
				>
					<ArrowLeft className="size-4" />
					Voltar pra home
				</Link>
			}
		>
			<TermosDeUso />
		</LegalDocument>
	);
}
