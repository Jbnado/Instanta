/**
 * Termos de Uso — conteúdo prose (PT-BR), copiado de
 * _bmad-output/planning-artifacts/legal/termos-de-uso.md (fora do bundle).
 * Mantido como JSX direto pra não adicionar dependência de markdown.
 * Renderizado por src/routes/termos.tsx dentro de um container prose.
 */
export function TermosDeUso() {
	return (
		<>
			<p className="lead">
				Bem-vindo ao Instanta. Estes Termos de Uso ("Termos") regulam a
				utilização da Plataforma Instanta ("Plataforma" ou "Serviço"), operada
				por [Bernardo / razão social a definir] ("Instanta", "nós"). Ao se
				cadastrar ou usar o Instanta, você ("Usuário") declara ter lido,
				entendido e aceito integralmente estes Termos.
			</p>

			<h2>1. Sobre o Instanta</h2>
			<p>
				1.1. O Instanta é uma plataforma web que permite a coleta colaborativa de
				fotos em eventos sociais privados, exibição em modo apresentação
				("Telão") e download pelos participantes, com auto-exclusão automática das
				fotos em <strong>30 (trinta) dias contados do encerramento do evento</strong>.
			</p>
			<p>
				1.2. A Plataforma é acessada via navegador, sem necessidade de instalação
				de aplicativo. O acesso a eventos ocorre exclusivamente via QR Code ou
				link compartilhado pelo anfitrião.
			</p>
			<p>
				1.3. O Instanta não é álbum perpétuo, não é rede social pública e não é
				arquivo permanente. Toda foto enviada é apagada automaticamente em D+30.
			</p>

			<h2>2. Cadastro e Conta</h2>
			<p>
				2.1. Para usar o Instanta, é necessário criar conta com nome, email válido
				e senha.
			</p>
			<p>
				2.2. O Usuário declara ter <strong>idade mínima de 18 anos</strong> ou ser
				legalmente emancipado. O Instanta <strong>não verifica idade</strong> — é
				responsabilidade do Usuário declarar idade compatível.
			</p>
			<p>
				2.3. As credenciais de acesso são pessoais e intransferíveis. O Usuário é
				responsável por toda atividade ocorrida em sua conta.
			</p>
			<p>
				2.4. Um único cadastro atende a múltiplos papéis (anfitrião, convidado,
				moderador, admin); o papel é determinado pelo contexto de cada evento.
			</p>

			<h2>3. Conteúdo do Usuário (Fotos e Reações)</h2>
			<p>
				3.1. Ao enviar fotos ou interagir na Plataforma, o Usuário{" "}
				<strong>declara e garante</strong>:
			</p>
			<ol type="a">
				<li>
					Ser o autor da foto <strong>ou</strong> ter obtido todas as
					autorizações necessárias;
				</li>
				<li>
					Ter o consentimento de <strong>todas as pessoas identificáveis</strong>{" "}
					retratadas na foto, especialmente quando se tratar de menores,
					trabalhadores em atividade, prestadores de serviço ou pessoas em
					situação de vulnerabilidade;
				</li>
				<li>
					Que o conteúdo <strong>não viola</strong> direito autoral, direito de
					imagem, direito de privacidade, marca, segredo de negócio ou qualquer
					direito de terceiro;
				</li>
				<li>
					Que o conteúdo <strong>não contém</strong> material ilícito, ofensivo,
					discriminatório, pornográfico, violento, ou que envolva crianças ou
					adolescentes;
				</li>
				<li>
					Que entende que a foto <strong>pode ser exibida no Telão</strong>{" "}
					durante o evento, caso o anfitrião ative essa funcionalidade.
				</li>
			</ol>
			<p>
				3.2. O Usuário é <strong>integral e exclusivamente responsável</strong>{" "}
				pelo conteúdo que envia. O Instanta atua como <strong>operador</strong>{" "}
				dos dados nos termos da LGPD e <strong>não exerce curadoria editorial
				prévia</strong> do conteúdo enviado pelos usuários.
			</p>
			<p>
				3.3. Ao enviar conteúdo, o Usuário concede ao Instanta licença não
				exclusiva, revogável (mediante exclusão do conteúdo), gratuita, limitada
				ao território brasileiro e ao prazo de retenção do evento (até D+30),
				exclusivamente para: hospedagem, processamento técnico (compressão,
				redimensionamento, geração de variantes), distribuição aos demais
				participantes do evento, e exibição no Telão.
			</p>
			<p>
				3.4. O Instanta <strong>não comercializa</strong> conteúdo do Usuário,{" "}
				<strong>não licencia</strong> a terceiros, <strong>não treina modelos de
				IA</strong> com fotos dos eventos, e <strong>não usa</strong> fotos para
				finalidade diversa da prestação do serviço contratado.
			</p>

			<h2>4. Modo Apresentação ("Telão")</h2>
			<p>
				4.1. O Telão é uma funcionalidade que permite ao anfitrião exibir as
				fotos do evento em formato de slideshow fullscreen, projetado em monitor,
				TV ou outro dispositivo escolhido pelo anfitrião.
			</p>
			<p>
				4.2. Ao enviar uma foto, o Usuário <strong>autoriza expressamente</strong>{" "}
				sua exibição no Telão, exceto se acionar a opção "ocultar do telão" no
				momento do envio.
			</p>
			<p>
				4.3. O Usuário pode, a qualquer momento, <strong>remover sua própria
				foto do Telão</strong> sem precisar removê-la do feed do evento.
			</p>
			<p>
				4.4. O ambiente onde o Telão é exibido (local privado, semi-público ou
				público) é <strong>escolha exclusiva do anfitrião</strong> — o Instanta
				não controla quem vê o Telão.
			</p>

			<h2>5. Comportamento Proibido</h2>
			<p>É vedado ao Usuário:</p>
			<p>
				5.1. Enviar fotos de <strong>menores de idade</strong>, mesmo com
				autorização parental (salvo se autorizado expressamente em pacote pago
				futuro com mecanismo específico de coleta de consentimento dos
				responsáveis legais).
			</p>
			<p>
				5.2. Enviar fotos de <strong>trabalhadores em atividade</strong> (garçons,
				fotógrafos profissionais, manobristas, prestadores de serviço) sem
				consentimento.
			</p>
			<p>
				5.3. Enviar fotos de pessoas <strong>em situação de vulnerabilidade ou
				constrangimento</strong>, incluindo bêbadas, dormindo, em momentos
				íntimos, ou em circunstâncias que comprometam sua dignidade.
			</p>
			<p>
				5.4. Usar a Plataforma para <strong>fins comerciais não
				autorizados</strong> (cobrança de participação, monetização de conteúdo
				de terceiros, prospecção de clientes).
			</p>
			<p>
				5.5. Tentar contornar limites técnicos (cap de armazenamento, rate
				limit), abusar do sistema de denúncias com finalidade de assédio, ou criar
				contas falsas para multiplicar interações.
			</p>
			<p>
				5.6. Praticar engenharia reversa, scraping massivo, ou qualquer tentativa
				de burlar mecanismos de segurança da Plataforma.
			</p>

			<h2>6. Moderação, Banimento e Encerramento</h2>
			<p>
				6.1. O Instanta pode, a seu critério, <strong>ocultar conteúdo</strong>,{" "}
				<strong>banir usuários</strong> ou <strong>encerrar contas</strong> quando
				identificar violação destes Termos, denúncia fundamentada de terceiro, ou
				ordem judicial.
			</p>
			<p>
				6.2. O sistema de denúncia é <strong>anônimo</strong> ao anfitrião —
				anfitrião visualiza apenas a contagem de denúncias, não a identidade dos
				denunciantes.
			</p>
			<p>
				6.3. Foto que receber <strong>3 (três) ou mais denúncias
				independentes</strong> é ocultada automaticamente do feed e do Telão até
				revisão.
			</p>
			<p>6.4. O anfitrião pode banir convidados de seu evento, com reversão possível.</p>

			<h2>7. Limitação de Responsabilidade</h2>
			<p>
				7.1. O Instanta presta o serviço "como está", sem garantia de
				disponibilidade ininterrupta. Falhas pontuais não geram dever de
				indenizar, salvo em casos de dolo ou culpa grave.
			</p>
			<p>7.2. O Instanta <strong>não se responsabiliza</strong> por:</p>
			<ol type="a">
				<li>Conteúdo enviado pelos Usuários;</li>
				<li>Uso que terceiros façam das fotos baixadas via download;</li>
				<li>
					Exibição do Telão em local público sem autorização das pessoas
					retratadas — responsabilidade do anfitrião que ativou o Telão;
				</li>
				<li>
					Perda de fotos após o auto-clean D+30 — o Usuário é orientado a baixar
					as fotos antes desse prazo.
				</li>
			</ol>
			<p>
				7.3. Esta cláusula não exclui a responsabilidade do Instanta nos casos
				previstos no Código de Defesa do Consumidor, sendo nulas cláusulas que
				importem em renúncia abusiva de direitos do consumidor.
			</p>

			<h2>8. Privacidade e Tratamento de Dados</h2>
			<p>
				8.1. O tratamento dos dados pessoais é regido pela Política de
				Privacidade, parte integrante destes Termos.
			</p>
			<p>
				8.2. O Usuário pode exercer seus direitos previstos na LGPD (Art. 18) pelo
				canal: <strong>privacidade@instanta.com.br</strong> (ou email que será
				publicado oficialmente).
			</p>
			<p>
				8.3. A Plataforma utiliza serviços operadores listados na Política de
				Privacidade (incluindo, mas não limitado a, Cloudflare para hospedagem e
				CDN, Resend para emails transacionais, Microsoft Clarity para analytics de
				comportamento e Sentry para diagnóstico de erros), todos sujeitos a Data
				Processing Addendum específico e em conformidade com os requisitos da LGPD
				para transferência internacional (Art. 33-36).
			</p>

			<h2>9. Alterações destes Termos</h2>
			<p>
				9.1. Estes Termos podem ser atualizados. Alterações materiais serão
				comunicadas com <strong>antecedência mínima de 30 dias</strong>, via email
				cadastrado e via aviso in-app no próximo login.
			</p>
			<p>
				9.2. O uso continuado após o prazo configura aceitação. Se o Usuário não
				concordar, pode encerrar a conta.
			</p>

			<h2>10. Disposições Gerais</h2>
			<p>
				10.1. <strong>Foro:</strong> as partes elegem o foro da Comarca de [cidade
				— ex: São Paulo/SP], com renúncia a qualquer outro, salvo disposição
				cogente do Código de Defesa do Consumidor que privilegie o foro do
				consumidor.
			</p>
			<p>
				10.2. <strong>Lei aplicável:</strong> legislação brasileira.
			</p>
			<p>
				10.3. Se qualquer cláusula destes Termos for considerada inválida, as
				demais permanecem em vigor.
			</p>
			<p>
				10.4. Estes Termos constituem o acordo integral entre as partes,
				prevalecendo sobre qualquer entendimento anterior.
			</p>

			<hr />
			<p className="text-sm text-muted-foreground">
				Versão 1.0 — Draft inicial, pendente de revisão jurídica antes de uso com
				não-fundadores.
			</p>
		</>
	);
}
