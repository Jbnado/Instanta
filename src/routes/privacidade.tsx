import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { PoliticaPrivacidade } from "@/content/legal/politica-privacidade";
import { LegalDocument } from "@/components/feature/legal/legal-document";

/**
 * Tela de leitura da Política de Privacidade (/privacidade). Conteúdo prose
 * copiado de planning-artifacts/legal/politica-privacidade.md pra dentro do
 * bundle (NÃO importa de _bmad-output). Linkada pelo checkbox de T&C do signup.
 */
export const Route = createFileRoute("/privacidade")({
	component: PrivacidadePage,
});

function PrivacidadePage() {
	return (
		<LegalDocument
			title="Política de Privacidade"
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
			<PoliticaPrivacidade />
		</LegalDocument>
	);
}
