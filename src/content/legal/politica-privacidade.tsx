/**
 * Política de Privacidade — conteúdo prose (PT-BR), copiado de
 * _bmad-output/planning-artifacts/legal/politica-privacidade.md (fora do bundle).
 * JSX direto pra evitar dependência de markdown. Renderizado por
 * src/routes/privacidade.tsx dentro de um container prose.
 */
export function PoliticaPrivacidade() {
	return (
		<>
			<p className="lead">
				Esta Política de Privacidade ("Política") descreve como o Instanta trata
				seus dados pessoais, em conformidade com a <strong>Lei Geral de Proteção
				de Dados Pessoais (Lei 13.709/2018 — LGPD)</strong>, o <strong>Marco
				Civil da Internet (Lei 12.965/2014)</strong> e o <strong>Código de Defesa
				do Consumidor</strong>.
			</p>

			<h2>1. Quem Somos</h2>
			<p>
				1.1. O Instanta é operado por [Bernardo / razão social a definir], CNPJ
				[XX.XXX.XXX/0001-XX], com sede em [endereço].
			</p>
			<p>
				1.2. <strong>Canal de Privacidade (LGPD Art. 41 §2 I):</strong>
			</p>
			<ul>
				<li>
					Email: <strong>privacidade@instanta.com.br</strong> (canal a ser
					publicado)
				</li>
				<li>
					Prazo de resposta: até <strong>15 (quinze) dias úteis</strong> para
					solicitações de direitos do titular.
				</li>
			</ul>
			<p>
				1.3. O Instanta opera atualmente como <strong>Agente de Tratamento de
				Pequeno Porte (ATPP)</strong>, conforme Resolução CD/ANPD nº 2/2022, e
				está dispensado da nomeação formal de Encarregado, mantendo este canal de
				comunicação para garantir os direitos do titular.
			</p>

			<h2>2. Dados que Coletamos</h2>
			<ul>
				<li>
					<strong>Cadastro:</strong> nome, email, hash da senha (informados por
					você no signup).
				</li>
				<li>
					<strong>Perfil:</strong> nome de exibição, avatar gerado, Instantes
					acumulados (você + sistema, em uso).
				</li>
				<li>
					<strong>Conteúdo:</strong> fotos enviadas, reações, denúncias (você,
					durante eventos).
				</li>
				<li>
					<strong>Eventos (Anfitrião):</strong> nome, data, descrição, cor,
					missões (você, ao criar evento).
				</li>
				<li>
					<strong>Acesso (Marco Civil):</strong> IP, timestamp, porta NAT
					(automático, a cada acesso).
				</li>
				<li>
					<strong>Telemetria operacional:</strong> tipo de dispositivo,
					navegador, latências (automático, em uso).
				</li>
				<li>
					<strong>Analytics de comportamento:</strong> interações na página
					(cliques, rolagem, navegação), gravação parcial de sessão com
					mascaramento agressivo de inputs e dados pessoais, erros de JavaScript
					(automático via Microsoft Clarity).
				</li>
			</ul>
			<p>
				<strong>Não coletamos:</strong> data de nascimento, telefone, localização
				precisa via GPS, dados de cartão de crédito (no MVP gratuito), informações
				de redes sociais.
			</p>

			<h2>3. Por Que Coletamos (Finalidades e Bases Legais)</h2>
			<ul>
				<li>Criar e autenticar conta — Art. 7, V (execução de contrato).</li>
				<li>
					Permitir uso da Plataforma (postar, ver, baixar fotos) — Art. 7, V.
				</li>
				<li>
					Sistema de Instantes e histórico privado — Art. 7, I (consentimento).
				</li>
				<li>Reset de senha por email — Art. 7, V.</li>
				<li>
					Moderação e segurança da Plataforma — Art. 7, IX (legítimo interesse).
				</li>
				<li>
					Cumprir Marco Civil — guarda de logs — Art. 7, II (obrigação legal).
				</li>
				<li>Atender solicitações da ANPD/Justiça — Art. 7, VI.</li>
				<li>Melhorar a Plataforma (telemetria agregada) — Art. 7, IX.</li>
				<li>
					Identificar problemas de usabilidade e erros via analytics de
					comportamento (Microsoft Clarity) — Art. 7, IX (legítimo interesse).
				</li>
			</ul>

			<h2>4. Como Tratamos Fotos com Identificação de Pessoas</h2>
			<p>
				4.1. <strong>Fotos enviadas pelos convidados podem identificar
				terceiros</strong> (retratados que não criaram conta no Instanta).
			</p>
			<p>
				4.2. A base legal para o tratamento dessas imagens é o{" "}
				<strong>consentimento implícito do retratado</strong> ao participar do
				evento — concedido tanto pela declaração do Anfitrião (Termo de
				Responsabilidade) quanto pela ciência do disclaimer in-app exibido a cada
				convidado ao entrar no evento.
			</p>
			<p>
				4.3. Caso um terceiro retratado em foto deseje exercer{" "}
				<strong>direitos previstos no Art. 18 da LGPD</strong> (acesso, exclusão,
				oposição), pode contatar o canal de privacidade — atenderemos sem
				necessidade de cadastro prévio na Plataforma.
			</p>
			<p>
				4.4. <strong>Recomendamos fortemente</strong> que o Anfitrião comunique
				aos convidados as orientações de não-fotografar.
			</p>
			<p>
				4.5. <strong>Em qualquer caso de dúvida ou conflito</strong>, prevalece o
				pedido de exclusão da pessoa retratada — agimos com viés à proteção do
				titular.
			</p>

			<h2>5. Com Quem Compartilhamos</h2>
			<ul>
				<li>
					<strong>Cloudflare Inc.</strong> — storage e delivery de imagens,
					hospedagem de aplicação (Workers, D1, R2) e CDN (Global, EUA).
				</li>
				<li>
					<strong>Resend (Cycomp Inc.)</strong> — envio de emails transacionais
					(reset de senha, ativação de evento, alertas) (EUA).
				</li>
				<li>
					<strong>Microsoft Corporation</strong> — analytics de comportamento e
					identificação de erros (Microsoft Clarity), gravação parcial de sessão
					com mascaramento de dados pessoais (EUA).
				</li>
				<li>
					<strong>Sentry (Functional Software, Inc.)</strong> — captura e
					diagnóstico de erros de aplicação (EUA).
				</li>
				<li>
					<strong>[Gateway de pagamento — futuro v1.1]</strong> — processar
					pagamentos via Pix/cartão (Brasil).
				</li>
			</ul>
			<p>
				5.1. Mantemos <strong>Data Processing Addendum (DPA)</strong> com cada
				operador, conforme Art. 33-36 LGPD para transferência internacional.
			</p>
			<p>
				5.2. <strong>Não vendemos</strong> seus dados, <strong>não
				compartilhamos</strong> com terceiros para publicidade, <strong>não
				treinamos modelos de IA</strong> com fotos dos eventos.
			</p>

			<h2>6. Por Quanto Tempo Retemos</h2>
			<ul>
				<li>
					<strong>Fotos do evento:</strong> 30 dias após encerramento (princípio
					da minimização, LGPD Art. 6 III).
				</li>
				<li>
					<strong>Cadastro (email, hash de senha):</strong> até pedido de
					exclusão (continuidade do serviço).
				</li>
				<li>
					<strong>Instantes e histórico privado:</strong> até pedido de exclusão
					(consentimento específico, Art. 7 I).
				</li>
				<li>
					<strong>Logs de acesso (Marco Civil):</strong> 6 meses (obrigação
					legal, Lei 12.965/2014 Art. 15).
				</li>
				<li>
					<strong>Logs de auditoria de segurança:</strong> 12 meses (segurança da
					informação).
				</li>
				<li>
					<strong>Registros internos de incidente:</strong> 5 anos (Resolução
					CD/ANPD nº 15/2024).
				</li>
			</ul>

			<h2>7. Seus Direitos (LGPD Art. 18)</h2>
			<p>Você tem direito a:</p>
			<ul>
				<li>
					<strong>Confirmar</strong> se tratamos seus dados;
				</li>
				<li>
					<strong>Acessar</strong> todos os seus dados via painel "Meus Dados" no
					app ou solicitar export estruturado (JSON/ZIP);
				</li>
				<li>
					<strong>Corrigir</strong> dados incompletos, inexatos ou
					desatualizados;
				</li>
				<li>
					<strong>Solicitar exclusão</strong> completa do cadastro e fotos
					enviadas;
				</li>
				<li>
					<strong>Portabilidade</strong> — exportar seus dados em formato
					interoperável;
				</li>
				<li>
					<strong>Saber com quem</strong> compartilhamos seus dados (vide cláusula
					5);
				</li>
				<li>
					<strong>Revogar consentimento</strong> em finalidades baseadas em
					consentimento;
				</li>
				<li>
					<strong>Opor-se</strong> a tratamento por legítimo interesse, mediante
					justificativa.
				</li>
			</ul>
			<p>
				<strong>Como exercer:</strong> envie email para{" "}
				<strong>privacidade@instanta.com.br</strong> com seu pedido. Atenderemos em
				até <strong>15 dias úteis</strong>.
			</p>

			<h2>8. Segurança</h2>
			<p>8.1. Adotamos medidas técnicas e organizacionais razoáveis:</p>
			<ul>
				<li>Senhas armazenadas com hashing seguro (argon2id/bcrypt);</li>
				<li>Comunicação em HTTPS obrigatória (TLS 1.2+);</li>
				<li>Controle de acesso por papel (RBAC);</li>
				<li>Logs de auditoria de ações sensíveis;</li>
				<li>Backup de banco de dados encrypted-at-rest;</li>
				<li>
					Stripping automático de metadados EXIF de fotos (incluindo
					geolocalização);
				</li>
				<li>
					Mascaramento agressivo de inputs e dados pessoais visíveis no DOM antes
					de envio ao serviço de analytics de comportamento (Microsoft Clarity).
				</li>
			</ul>
			<p>
				8.2. <strong>Não há sistema 100% seguro</strong> — em caso de incidente,
				comunicaremos a ANPD e os titulares afetados nos prazos regulamentares (3 a
				6 dias úteis, conforme Resolução CD/ANPD nº 15/2024).
			</p>

			<h2>9. Cookies e Tecnologias de Rastreamento</h2>
			<p>
				9.1. <strong>Cookies essenciais (autenticação):</strong> sessão httpOnly +
				secure + SameSite=Lax, indispensáveis para manter o login do Usuário. Sem
				eles a Plataforma não funciona.
			</p>
			<p>
				9.2. <strong>Cookies e identificadores de analytics de
				comportamento:</strong> o Instanta utiliza o serviço Microsoft Clarity
				para identificar problemas de usabilidade e erros, com base no legítimo
				interesse de melhoria contínua da Plataforma (Art. 7, IX da LGPD). O
				Clarity coleta dados de interação e pode gravar trechos da sessão, com
				mascaramento agressivo aplicado pelo Instanta.
			</p>
			<p>
				9.3. <strong>Não usamos</strong> cookies de marketing, cookies de
				rastreamento publicitário entre sites (cross-site tracking), ou
				compartilhamento de dados com plataformas de anúncios.
			</p>
			<p>
				9.4. Para mais informações sobre o tratamento de dados pelo Microsoft
				Clarity, consulte a política de privacidade da Microsoft em{" "}
				<a
					href="https://privacy.microsoft.com/pt-br/privacystatement"
					target="_blank"
					rel="noreferrer"
				>
					privacy.microsoft.com
				</a>
				.
			</p>

			<h2>10. Crianças e Adolescentes</h2>
			<p>
				10.1. <strong>O Instanta NÃO é destinado a menores de 18 anos.</strong> Não
				coletamos intencionalmente dados de menores.
			</p>
			<p>
				10.2. <strong>Se houver denúncia ou se for identificado</strong> durante
				moderação que um menor criou conta ou foi retratado em foto sem
				consentimento dos responsáveis legais, <strong>analisaremos o caso e
				excluiremos</strong> os dados associados. O Instanta <strong>não realiza
				detecção automática</strong> de idade ou identidade.
			</p>
			<p>
				10.3. <strong>Eventos com menores como participantes principais não são
				permitidos.</strong>
			</p>

			<h2>11. Alterações desta Política</h2>
			<p>
				11.1. Esta Política pode ser atualizada. Alterações materiais serão
				comunicadas com 30 dias de antecedência via email e in-app.
			</p>
			<p>
				11.2. A versão vigente sempre estará disponível em{" "}
				<strong>https://instanta.com.br/privacidade</strong>, com data e versão
				visíveis no rodapé.
			</p>

			<h2>12. Contato e Reclamações</h2>
			<p>
				12.1. <strong>Canal Instanta:</strong> privacidade@instanta.com.br
			</p>
			<p>
				12.2. <strong>ANPD:</strong> se considerar que seus direitos não foram
				respeitados pelo Instanta, você pode peticionar diretamente à Autoridade
				Nacional de Proteção de Dados em{" "}
				<a href="https://www.gov.br/anpd" target="_blank" rel="noreferrer">
					www.gov.br/anpd
				</a>
				.
			</p>

			<hr />
			<p className="text-sm text-muted-foreground">
				Versão 1.0 — Draft inicial, pendente de revisão jurídica antes de uso com
				não-fundadores.
			</p>
		</>
	);
}
