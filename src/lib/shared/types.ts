/**
 * Re-exports de `z.infer<...>` dos schemas — tipos compartilhados front ↔ back.
 * Mantém um único `import { SignupInput } from '@/lib/shared/types'` em vez de
 * importar do schema diretamente (que vem com baggage do zod).
 */
export type {
	AuthErrorCode,
	LoginInput,
	SignupInput,
	SignupResponse,
	UserPublic,
} from "./schemas/auth";
