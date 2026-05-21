# FR-mapping: Functional Requirements → arquivos

Rastreia onde cada FR1-FR75 vive ou está previsto. Validado por `pnpm fr:check`:

- Linhas marcadas `implemented` exigem comentário `// FR-NN` em pelo menos 1 arquivo listado (regex aceita `// FR-23`, `// FR23`, `//FR-23`).
- Linhas `planned` (default no MVP) não exigem comentário — apenas indicam o arquivo previsto.

Quando uma story implementar um FR, **mude o Status pra `implemented`** nesta tabela e adicione o comentário `// FR-NN` no arquivo.

## Mapping

| FR | Description | Planned file(s) | Status |
|---|---|---|---|
| FR1 | Cadastro email+senha | src/server/services/auth-service.ts | planned |
| FR2 | Login email+senha | src/server/services/auth-service.ts | planned |
| FR3 | Logout (encerrar sessão) | src/server/services/session-service.ts | planned |
| FR4 | Reset de senha via email | src/server/services/auth-service.ts | planned |
| FR5 | Sessão httpOnly persistente | src/server/services/session-service.ts | planned |
| FR6 | Cadastro único cross-role | src/server/services/auth-service.ts | planned |
| FR7 | Anfitrião cria evento | src/server/services/event-service.ts | planned |
| FR8 | Anfitrião define senha do evento | src/server/services/event-service.ts | planned |
| FR9 | QR Code + link gerados após ativação | src/server/services/event-service.ts | planned |
| FR10 | Evento criado como Inativo até admin ativar | src/server/services/event-service.ts | planned |
| FR11 | Anfitrião vê status do evento | src/react-app/routes/event.$slug.host.tsx | planned |
| FR12 | Lista de eventos do anfitrião | src/react-app/routes/account/events.tsx | planned |
| FR13 | Anfitrião edita evento (incl. senha rotação) | src/server/services/event-service.ts | planned |
| FR14 | Anfitrião encerra evento ativo | src/server/services/event-service.ts | planned |
| FR15 | Sistema encerra evento após data | src/server/scheduled.ts | planned |
| FR16 | Auto-clean D+30 das fotos | src/server/scheduled.ts | planned |
| FR17 | Acesso evento via QR/link | src/react-app/routes/event.$slug.tsx | planned |
| FR18 | Auth no evento via senha | src/server/services/event-service.ts | planned |
| FR19 | Sessão persistente cross-event | src/server/services/session-service.ts | planned |
| FR20 | Convidado define nome de exibição | src/server/services/user-service.ts | planned |
| FR21 | Captura foto câmera/galeria | src/react-app/components/feature/capture/capture-sheet.tsx | planned |
| FR22 | Compressão cliente antes do upload | src/react-app/lib/image/compress-image.ts | planned |
| FR23 | Rejeita upload sem compressão mínima | src/react-app/lib/image/compress-image.ts | planned |
| FR24 | Marcar foto como oculta no telão | src/server/services/photo-service.ts | planned |
| FR25 | Convidado vê próprias fotos | src/server/services/photo-service.ts | planned |
| FR26 | Convidado deleta própria foto | src/server/services/photo-service.ts | planned |
| FR27 | Bloqueio de upload no cap | src/server/services/photo-service.ts | planned |
| FR28 | Notificação 80%/100% cap | src/server/services/photo-service.ts | planned |
| FR29 | Feed cronológico reverso | src/react-app/components/feature/feed/feed-player.tsx | planned |
| FR30 | Polling 5s + badge novidades | src/react-app/hooks/use-feed.ts | planned |
| FR31 | 6 reactions (tap + long-press) | src/react-app/components/feature/feed/reaction-picker.tsx | planned |
| FR32 | Ações secundárias da foto | src/react-app/components/feature/feed/photo-actions.tsx | planned |
| FR33 | Download individual de foto | src/react-app/components/feature/feed/photo-actions.tsx | planned |
| FR34 | Anfitrião baixa zip do evento | src/server/services/download-service.ts | planned |
| FR35 | Convidado reporta foto | src/server/services/report-service.ts | planned |
| FR36 | Anfitrião ativa modo telão | src/react-app/routes/event.$slug.telao.tsx | planned |
| FR37 | Fila do telão (cronológica + anti-spam) | src/server/services/telao-service.ts | planned |
| FR38 | Telão atualiza com novas fotos | src/react-app/routes/event.$slug.telao.tsx | planned |
| FR39 | Anfitrião pausa/retoma/desativa telão | src/react-app/routes/event.$slug.telao.tsx | planned |
| FR40 | Telão exclui ocultas/banidas/reportadas | src/server/services/telao-service.ts | planned |
| FR41 | 10 Instantes baseline por evento | src/server/services/gamification-service.ts | planned |
| FR42 | 1 Instante por reação recebida | src/server/services/gamification-service.ts | planned |
| FR43 | Instantes persistem cross-event | src/server/services/gamification-service.ts | planned |
| FR44 | Leveling exponencial 5→10→20→… | src/server/services/gamification-service.ts | planned |
| FR45 | Histórico privado do usuário | src/react-app/routes/account/history.tsx | planned |
| FR46 | Histórico sobrevive ao D+30 | src/server/services/gamification-service.ts | planned |
| FR47 | Apenas próprio user acessa histórico | src/server/middleware/authz.ts | planned |
| FR48 | Toggle tema claro/escuro | src/react-app/providers/theme-provider.tsx | planned |
| FR49 | Auto-hide foto com N reports (IP-based, limiar dinâmico) | src/server/services/report-service.ts | planned |
| FR50 | Anfitrião oculta foto do feed | src/server/services/photo-service.ts | planned |
| FR51 | Anfitrião banir/banimento (reversível) | src/server/services/event-service.ts | planned |
| FR52 | Anfitrião reverte banimento | src/server/services/event-service.ts | planned |
| FR53 | Admin ativa/rejeita eventos | src/server/services/admin-service.ts | planned |
| FR54 | Admin encerra eventos | src/server/services/admin-service.ts | planned |
| FR55 | Admin lazy gate (bundle) | src/react-app/routes/admin/_layout.tsx | planned |
| FR56 | 404 em admin pra não-admins | src/server/middleware/authz.ts | planned |
| FR57 | Open Graph meta tags | src/react-app/components/meta/og-tags.tsx | planned |
| FR58 | Detecção in-app browser + aviso | src/react-app/components/onboarding/in-app-browser-warning.tsx | planned |
| FR59 | Anfitrião escolhe cor primária | src/react-app/components/feature/event-setup/color-picker.tsx | planned |
| FR60 | Anfitrião cria missões (custom/preset) | src/react-app/components/feature/event-setup/mission-editor.tsx | planned |
| FR61 | Convidado vê missões ativas | src/react-app/components/feature/feed/mission-list.tsx | planned |
| FR62 | Convidado marca missão cumprida no upload | src/react-app/components/feature/capture/mission-tag.tsx | planned |
| FR63 | +1 Instante por foto enviada | src/server/services/gamification-service.ts | planned |
| FR64 | +10 Instantes por missão | src/server/services/gamification-service.ts | planned |
| FR65 | Reset password anti-enumeration | src/server/services/auth-service.ts | planned |
| FR66 | Super-admin promove user a admin | src/server/services/admin-service.ts | planned |
| FR67 | Email crítico (ativação, rejeição, msg admin) | src/server/services/email-service.ts | planned |
| FR68 | Reports anônimos ao anfitrião | src/server/services/report-service.ts | planned |
| FR69 | Reactions mostram identidade | src/server/services/reaction-service.ts | planned |
| FR70 | Histórico privado isolado | src/server/middleware/authz.ts | planned |
| FR71 | Lead capture quando cap atingido | src/server/services/lead-service.ts | planned |
| FR72 | Tags internas de evento (admin only) | src/server/services/admin-service.ts | planned |
| FR73 | Admin "pedir mais info" antes de decidir | src/server/services/admin-service.ts | planned |
| FR74 | Telemetria de eventos analíticos | src/server/lib/analytics.ts | planned |
| FR75 | Anfitrião apaga foto definitivamente | src/server/services/photo-service.ts | planned |

## Como atualizar este mapping

Quando uma story implementar um FR:

1. Adicione comentário `// FR-NN` perto da implementação no arquivo listado.
2. Mude `planned` → `implemented` nesta tabela na linha do FR.
3. Rode `pnpm fr:check` localmente — deve sair com exit 0.

Quando um FR for implementado em arquivo diferente do planejado, atualize a coluna `Planned file(s)` pro path real (ou adicione, separando por vírgula). O script aceita múltiplos arquivos por FR.
