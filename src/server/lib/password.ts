/**
 * Hashing de senha compartilhado — argon2id (Story 3.1).
 *
 * Espelha a abordagem do auth-service (argon2-wasm-edge, NFR10) num util genérico
 * reutilizável por serviços que precisam hashear segredos que NÃO são a senha
 * pessoal do usuário — ex.: a senha do EVENTO (código compartilhado entre convidados,
 * persistido em `events.password_hash`).
 *
 * Por que duplicar a setup do WASM em vez de importar de auth-service? Pra manter o
 * boundary limpo: serviços de domínio diferentes não devem depender uns dos outros só
 * pra reusar crypto. `setWASMModules` é idempotente — chamar aqui e no auth-service
 * apenas re-popula o mesmo cache de Modules compilados. Custo: alguns bytes de import.
 */
import { argon2id, argon2Verify, setWASMModules } from "argon2-wasm-edge";
// WASM importado como módulo ES (workerd PERMITE isso). NÃO usamos o fallback
// `WebAssembly.compile(buffer)` da lib — proibido em workerd — porque
// `setWASMModules` pré-popula o cache com os Modules já compilados pelo runtime.
// @ts-expect-error — Vite/wrangler resolvem .wasm como WebAssembly.Module.
import argon2WASM from "argon2-wasm-edge/wasm/argon2.wasm";
// @ts-expect-error — idem.
import blake2bWASM from "argon2-wasm-edge/wasm/blake2b.wasm";

// Registra os Modules WASM uma vez no carregamento do módulo. Idempotente.
setWASMModules({
	argon2WASM: argon2WASM as WebAssembly.Module,
	blake2bWASM: blake2bWASM as WebAssembly.Module,
});

// NFR10: argon2id memory ≥64MB, time ≥3, parallelism ≥4 — mesmos params do auth-service.
const ARGON2_OPTS = {
	iterations: 3, // time cost (t)
	memorySize: 65_536, // memory em KiB = 64 MiB (m)
	parallelism: 4, // parallelism (p)
	hashLength: 32, // dkLen
	outputType: "encoded", // PHC string $argon2id$v=19$m=..,t=..,p=..$salt$hash
} as const;

/** Hashea `plain` em PHC string argon2id encoded (salt random de 16 bytes). */
export async function hashPassword(plain: string): Promise<string> {
	const salt = new Uint8Array(16);
	crypto.getRandomValues(salt);
	return argon2id({ ...ARGON2_OPTS, password: plain, salt });
}

/** Verifica `plain` contra um PHC string argon2id encoded. false em qualquer falha. */
export async function verifyPassword(encoded: string, plain: string): Promise<boolean> {
	try {
		return await argon2Verify({ password: plain, hash: encoded });
	} catch {
		return false;
	}
}
