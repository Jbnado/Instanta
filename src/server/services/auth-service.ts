/**
 * Auth service — Story 2.1.
 *
 * Serviço puro: não importa hono, c.env, ou middleware. Recebe deps via factory
 * pra teste isolado. Toda lógica de hashing, dedup, sessão e refresh rotation
 * vive aqui — handlers HTTP (`routes/auth.ts`) ficam finos.
 *
 * Convenções:
 * - Emails sempre normalizados (trim + lowercase) antes de buscar/salvar.
 * - Senhas hashedas via argon2id (argon2-wasm-edge, edge-compatible).
 * - Refresh tokens armazenados como SHA-256 hash; plain só vai no cookie do cliente.
 * - JWT HS256 access token ~15min; refresh single-use 30 dias.
 * - Race protection (R-002) em `rotateRefresh` via UPDATE conditional + checagem de affected rows.
 */
import { argon2id, argon2Verify, setWASMModules } from "argon2-wasm-edge";
// WASM importado como módulo ES (workerd PERMITE isso). NÃO usamos o fallback
// `WebAssembly.compile(buffer)` da lib — que workerd PROÍBE — porque
// `setWASMModules` pré-popula o cache com os Modules já compilados pelo runtime.
// @ts-expect-error — Vite/wrangler resolvem .wasm como WebAssembly.Module.
import argon2WASM from "argon2-wasm-edge/wasm/argon2.wasm";
// @ts-expect-error — idem.
import blake2bWASM from "argon2-wasm-edge/wasm/blake2b.wasm";
import { and, eq, isNull } from "drizzle-orm";

// Registra os Modules WASM uma vez no carregamento do módulo. Idempotente.
setWASMModules({
	argon2WASM: argon2WASM as WebAssembly.Module,
	blake2bWASM: blake2bWASM as WebAssembly.Module,
});

import type { DB } from "../db/client";
import { passwordResetTokens, sessions, users } from "../db/schema";
import { isDisposableEmail } from "../../lib/shared/disposable-emails";
import type { Mailer } from "./mailer";

// ============================================================================
// Tipos
// ============================================================================

export interface SignupArgs {
	email: string;
	password: string;
	displayName: string;
	termsAccepted: boolean;
}

export interface SignupResult {
	user: { id: string; email: string; displayName: string | null; role: "user" | "admin" };
	sessionId: string;
	accessToken: string;
	refreshToken: string;
}

export interface RotateRefreshResult {
	user: { id: string; email: string; displayName: string | null; role: "user" | "admin" };
	sessionId: string;
	accessToken: string;
	refreshToken: string;
}

export interface AccessTokenPayload {
	sub: string;
	sid: string;
	role: "user" | "admin";
	iat: number;
	exp: number;
}

export interface AuthServiceDeps {
	db: DB;
	jwtSecret: string;
	/** ADMIN_EMAIL — usuários com este email recebem role admin (temporário; ver Story 4.9). */
	adminEmail?: string;
	/** Clock injetável para testes determinísticos. */
	now?: () => Date;
	/** Mailer pra envio de email de reset (Story 2.4). Stub no MVP; Resend no Epic 4. */
	mailer?: Mailer;
	/** Base URL pública pra montar o link de reset. Default: domínio de produção. */
	appBaseUrl?: string;
}

export interface AuthService {
	hashPassword(plain: string): Promise<string>;
	verifyPassword(hash: string, plain: string): Promise<boolean>;
	signup(args: SignupArgs): Promise<SignupResult>;
	login(email: string, password: string): Promise<SignupResult>;
	rotateRefresh(refreshTokenPlain: string): Promise<RotateRefreshResult>;
	verifyAccessToken(token: string): Promise<AccessTokenPayload>;
	logout(sessionId: string): Promise<void>;
	logoutAllForUser(userId: string): Promise<void>;
	getUserById(userId: string): Promise<SignupResult["user"] | null>;
	/**
	 * Solicita reset (Story 2.4). Sempre resolve void SEM sinal distinguível entre
	 * email cadastrado e não (anti-enumeração estrita, FR65) — o jitter na rota
	 * mascara o delta de timing. Só gera token + dispara email se o user existir.
	 */
	requestPasswordReset(email: string): Promise<void>;
	/**
	 * Confirma reset (Story 2.5). Token válido (não expirado, não usado) → atualiza
	 * hash de senha, marca single-use, revoga TODAS as sessões. Caso contrário lança
	 * InvalidResetTokenError.
	 */
	confirmPasswordReset(token: string, newPassword: string): Promise<void>;
}

// ============================================================================
// Erros tipados — handlers de rota traduzem pra HTTP code + microcopy.
// ============================================================================

export class EmailAlreadyExistsError extends Error {
	readonly code = "EMAIL_EXISTS";
	constructor() {
		super("Email already exists");
	}
}

export class DisposableEmailError extends Error {
	readonly code = "DISPOSABLE_EMAIL";
	constructor() {
		super("Disposable email domain not allowed");
	}
}

/**
 * Login falhou. GENÉRICO de propósito: mesmo erro pra email inexistente e pra
 * senha errada — não distingue (anti-enumeração no login, AC Story 2.2).
 */
export class InvalidCredentialsError extends Error {
	readonly code = "INVALID_CREDENTIALS";
	constructor() {
		super("Invalid email or password");
	}
}

export class SessionRevokedError extends Error {
	readonly code = "SESSION_REVOKED";
	constructor() {
		super("Session is revoked or invalid");
	}
}

export class SessionNotFoundError extends Error {
	readonly code = "SESSION_NOT_FOUND";
	constructor() {
		super("Session not found");
	}
}

/**
 * Race benigno de rotação (R-002, Story 2.6): 2 abas dispararam o MESMO refresh
 * válido quase ao mesmo tempo. O perdedor encontra a sessão já revogada PELO IRMÃO
 * concorrente (revogada há ≤ REUSE_LEEWAY_S, com `replacedBy` setado). É 401 mas
 * NÃO é reuse/roubo — a rota NÃO mata a família (a sessão nova do vencedor sobrevive).
 */
export class ConcurrentRotationError extends Error {
	readonly code = "CONCURRENT_ROTATION";
	constructor() {
		super("Concurrent rotation race; this request lost");
	}
}

/**
 * Inatividade (NFR62): a sessão é válida dentro da janela 30d, mas ficou sem uso
 * por mais de INACTIVITY_TIMEOUT_S. Tratada como expirada — força novo login.
 */
export class InactivityTimeoutError extends Error {
	readonly code = "INACTIVITY_TIMEOUT";
	constructor() {
		super("Session expired due to inactivity");
	}
}

/**
 * Reset token inválido: inexistente, expirado OU já usado. GENÉRICO de propósito
 * (não distingue qual caso) — a rota traduz pra microcopy "link expirado ou inválido".
 */
export class InvalidResetTokenError extends Error {
	readonly code = "INVALID_RESET_TOKEN";
	constructor() {
		super("Reset token is invalid, expired or already used");
	}
}

// ============================================================================
// Constantes
// ============================================================================

const ACCESS_TOKEN_TTL_S = 15 * 60; // 15min
const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60; // 30 dias
const RESET_TOKEN_TTL_S = 30 * 60; // 30min (NFR43, lifetime ≤30min)
// Janela de leeway pra reuse detection (R-002, Story 2.6). Modelo padrão da indústria
// (IETF OAuth Security BCP / Auth0 reuse detection): se um refresh já revogado é
// reapresentado DENTRO desta janela, tratamos como race concorrente benigno (2 abas);
// FORA dela, como reuse/roubo real → mata a família. 10s cobre o jitter de rede de
// requests paralelos sem abrir brecha relevante pra um atacante.
const REUSE_LEEWAY_S = 10;
// Inatividade (NFR62): sessão sem uso por mais que isso é tratada como expirada,
// mesmo dentro da janela de 30d do refresh.
const INACTIVITY_TIMEOUT_S = 24 * 60 * 60; // 24h
// Domínio público default pro link de reset quando appBaseUrl não vem nas deps.
const DEFAULT_APP_BASE_URL = "https://instanta.jbnado.dev";
// NFR10: argon2id memory ≥64MB, time ≥3, parallelism ≥4.
// Lib: argon2-wasm-edge (WASM importado como módulo ES, ~50-150ms em workerd).
// @noble/hashes (pura JS) era correto mas ~2.6s/hash em Node e >5s em workerd (timeout).
// hash-wasm compilava WASM em runtime (proibido na plataforma Workers).
const ARGON2_OPTS = {
	iterations: 3, // time cost (t)
	memorySize: 65_536, // memory em KiB = 64 MiB (m)
	parallelism: 4, // parallelism (p)
	hashLength: 32, // dkLen
	outputType: "encoded", // retorna PHC string $argon2id$v=19$m=..,t=..,p=..$salt$hash
} as const;

// ============================================================================
// Helpers crypto (sem dep — Web Crypto nativo do workerd)
// ============================================================================

function normalizeEmail(raw: string): string {
	return raw.trim().toLowerCase();
}

function randomBase64UrlBytes(n: number): string {
	const buf = new Uint8Array(n);
	crypto.getRandomValues(buf);
	return base64UrlEncode(buf);
}

function base64UrlEncode(bytes: Uint8Array): string {
	let str = "";
	for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]!);
	return btoa(str).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function sha256Hex(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const hash = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

// ============================================================================
// JWT HS256 custom — Web Crypto direto pra evitar dep hono/jwt (boundary services).
// Formato: header.payload.signature, todos base64url.
// ============================================================================

async function getHmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

function base64UrlEncodeString(s: string): string {
	return base64UrlEncode(new TextEncoder().encode(s));
}

function base64UrlDecodeToString(s: string): string {
	const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
	const b64 = s.replaceAll("-", "+").replaceAll("_", "/") + pad;
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return new TextDecoder().decode(bytes);
}

async function signJwtHS256(payload: object, secret: string): Promise<string> {
	const header = base64UrlEncodeString(JSON.stringify({ alg: "HS256", typ: "JWT" }));
	const body = base64UrlEncodeString(JSON.stringify(payload));
	const signingInput = `${header}.${body}`;
	const key = await getHmacKey(secret);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
	return `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`;
}

async function verifyJwtHS256<T>(token: string, secret: string): Promise<T> {
	const parts = token.split(".");
	if (parts.length !== 3) throw new Error("Invalid JWT format");
	const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
	const signingInput = `${headerB64}.${payloadB64}`;
	const key = await getHmacKey(secret);

	// Decodifica assinatura.
	const padded = sigB64 + "=".repeat((4 - (sigB64.length % 4)) % 4);
	const sigBin = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
	const sigBytes = new Uint8Array(sigBin.length);
	for (let i = 0; i < sigBin.length; i++) sigBytes[i] = sigBin.charCodeAt(i);

	const valid = await crypto.subtle.verify(
		"HMAC",
		key,
		sigBytes,
		new TextEncoder().encode(signingInput),
	);
	if (!valid) throw new Error("Invalid JWT signature");

	const payload = JSON.parse(base64UrlDecodeToString(payloadB64)) as T & { exp?: number };
	if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
		throw new Error("JWT expired");
	}
	return payload;
}

function deriveRole(email: string, adminEmail: string | undefined): "user" | "admin" {
	if (adminEmail && normalizeEmail(adminEmail) === normalizeEmail(email)) return "admin";
	return "user";
}

// ============================================================================
// Factory
// ============================================================================

export function createAuthService(deps: AuthServiceDeps): AuthService {
	const {
		db,
		jwtSecret,
		adminEmail,
		now = () => new Date(),
		mailer,
		appBaseUrl = DEFAULT_APP_BASE_URL,
	} = deps;

	async function hashPassword(plain: string): Promise<string> {
		const salt = new Uint8Array(16);
		crypto.getRandomValues(salt);
		// `outputType: "encoded"` já devolve o PHC string $argon2id$v=19$m=..,t=..,p=..$salt$hash.
		return argon2id({ ...ARGON2_OPTS, password: plain, salt });
	}

	async function verifyPassword(encoded: string, plain: string): Promise<boolean> {
		try {
			// argon2Verify parseia o PHC string, re-deriva com os mesmos params e
			// compara internamente. Retorna false se o formato não bater.
			return await argon2Verify({ password: plain, hash: encoded });
		} catch {
			return false;
		}
	}

	async function generateAccessToken(
		userId: string,
		sessionId: string,
		role: "user" | "admin",
	): Promise<string> {
		const nowSec = Math.floor(now().getTime() / 1000);
		return signJwtHS256(
			{
				sub: userId,
				sid: sessionId,
				role,
				iat: nowSec,
				exp: nowSec + ACCESS_TOKEN_TTL_S,
			},
			jwtSecret,
		);
	}

	async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
		return verifyJwtHS256<AccessTokenPayload>(token, jwtSecret);
	}

	async function createSession(
		userId: string,
		// id pré-computado (Story 2.6): a rotação precisa setar `replacedBy` na sessão
		// antiga ANTES de criar a nova, então o id do sucessor é calculado antes.
		sessionId: string = crypto.randomUUID(), // UUID v4 ok p/ session id
	): Promise<{ sessionId: string; refreshToken: string }> {
		const refreshToken = randomBase64UrlBytes(32); // ≥128 bits ✓
		const refreshTokenHash = await sha256Hex(refreshToken);
		await db.insert(sessions).values({
			id: sessionId,
			userId,
			refreshTokenHash,
			createdAt: now(),
		});
		return { sessionId, refreshToken };
	}

	async function signup(args: SignupArgs): Promise<SignupResult> {
		const email = normalizeEmail(args.email);

		// Disposable check cheap-first (antes do hash, antes do INSERT).
		if (isDisposableEmail(email)) {
			throw new DisposableEmailError();
		}

		// Dedup case-insensitive: já normalizamos pra lowercase. Index unique aplica.
		const existing = await db.select().from(users).where(eq(users.email, email));
		if (existing.length > 0) {
			throw new EmailAlreadyExistsError();
		}

		const passwordHash = await hashPassword(args.password);

		const userId = crypto.randomUUID();
		const displayName = args.displayName.trim();
		const role = deriveRole(email, adminEmail);

		await db.insert(users).values({
			id: userId,
			email,
			passwordHash,
			displayName,
			termsAcceptedAt: now(),
			createdAt: now(),
		});

		const { sessionId, refreshToken } = await createSession(userId);
		const accessToken = await generateAccessToken(userId, sessionId, role);

		return {
			user: { id: userId, email, displayName, role },
			sessionId,
			accessToken,
			refreshToken,
		};
	}

	async function login(emailRaw: string, password: string): Promise<SignupResult> {
		const email = normalizeEmail(emailRaw);

		const rows = await db.select().from(users).where(eq(users.email, email));
		const row = rows[0];

		// Anti-enumeração: email inexistente OU senha errada → MESMO erro.
		// (Sem verifyPassword quando o user não existe; o jitter na rota mascara
		// o delta de timing entre as duas branches — não distinguir é o objetivo.)
		if (!row) {
			throw new InvalidCredentialsError();
		}

		const ok = await verifyPassword(row.passwordHash, password);
		if (!ok) {
			throw new InvalidCredentialsError();
		}

		const role = deriveRole(row.email, adminEmail);
		const { sessionId, refreshToken } = await createSession(row.id);
		const accessToken = await generateAccessToken(row.id, sessionId, role);

		return {
			user: { id: row.id, email: row.email, displayName: row.displayName, role },
			sessionId,
			accessToken,
			refreshToken,
		};
	}

	async function rotateRefresh(refreshTokenPlain: string): Promise<RotateRefreshResult> {
		const refreshTokenHash = await sha256Hex(refreshTokenPlain);

		// Id do sucessor pré-computado: gravamos `replacedBy` na sessão antiga no MESMO
		// UPDATE atômico que a revoga, deixando a lineage de rotação rastreável (R-002).
		const newSessionId = crypto.randomUUID();

		// Lê a atividade PRÉVIA antes do UPDATE — o `.returning()` do Drizzle devolve os
		// valores PÓS-update (lastUsedAt já seria now()), inúteis pro check de inatividade.
		// Esta leitura é só pro timeout de inatividade (não-concorrente); a decisão de
		// vencedor do race continua atômica no UPDATE abaixo.
		const priorRows = await db
			.select({ lastUsedAt: sessions.lastUsedAt, createdAt: sessions.createdAt })
			.from(sessions)
			.where(
				and(
					eq(sessions.refreshTokenHash, refreshTokenHash),
					isNull(sessions.revokedAt),
				),
			);
		const priorActivity = priorRows[0]
			? (priorRows[0].lastUsedAt ?? priorRows[0].createdAt)
			: null;

		// Race protection (R-002): UPDATE atomic com WHERE exigindo revoked_at IS NULL.
		// SQLite serializa transações concorrentes; só 1 vencedor terá uma linha afetada.
		const result = await db
			.update(sessions)
			.set({ revokedAt: now(), lastUsedAt: now(), replacedBy: newSessionId })
			.where(
				and(
					eq(sessions.refreshTokenHash, refreshTokenHash),
					isNull(sessions.revokedAt),
				),
			)
			.returning({
				id: sessions.id,
				userId: sessions.userId,
				createdAt: sessions.createdAt,
			});

		if (result.length === 0) {
			// 0 linhas afetadas: ou o token nunca existiu, ou já estava revogado.
			const existing = await db
				.select()
				.from(sessions)
				.where(eq(sessions.refreshTokenHash, refreshTokenHash));
			const sess = existing[0];
			if (!sess || sess.revokedAt === null) {
				// Não existe (ou estado impossível) → token desconhecido.
				throw new SessionNotFoundError();
			}

			// Já revogado. Modelo de leeway (IETF OAuth Security BCP / Auth0): a idade
			// desde a revogação distingue race benigno de reuse/roubo real.
			const ageSinceRevokeS = (now().getTime() - sess.revokedAt.getTime()) / 1000;
			if (ageSinceRevokeS <= REUSE_LEEWAY_S) {
				// Race concorrente benigno (2 abas): o irmão vencedor revogou esta sessão
				// há poucos segundos. 401, mas NÃO matamos a família — a sessão nova do
				// vencedor precisa sobreviver.
				throw new ConcurrentRotationError();
			}
			// Reuse/roubo real: token superado reapresentado bem depois → mata a família
			// (kill all devices), revogando todas as sessões vivas do usuário.
			await db
				.update(sessions)
				.set({ revokedAt: now() })
				.where(and(eq(sessions.userId, sess.userId), isNull(sessions.revokedAt)));
			throw new SessionRevokedError();
		}

		const oldSession = result[0]!;

		// Checa expiração 30d (sessão criada há mais de TTL → tratada como revogada).
		const ageSec = (now().getTime() - oldSession.createdAt.getTime()) / 1000;
		if (ageSec > REFRESH_TOKEN_TTL_S) {
			throw new SessionRevokedError();
		}

		// Inatividade (NFR62): última atividade PRÉVIA (lastUsedAt da rotação anterior,
		// ou createdAt no 1º uso) mais velha que INACTIVITY_TIMEOUT_S → expira ANTES de
		// emitir novos tokens. `priorActivity` é o valor lido pré-UPDATE.
		const lastActivity = priorActivity ?? oldSession.createdAt;
		const idleSec = (now().getTime() - lastActivity.getTime()) / 1000;
		if (idleSec > INACTIVITY_TIMEOUT_S) {
			throw new InactivityTimeoutError();
		}

		const user = await getUserById(oldSession.userId);
		if (!user) {
			throw new SessionNotFoundError();
		}

		// TODO Story 4.9: privilege-change rotation (NFR62). Hoje `role` é derivado de
		// ADMIN_EMAIL (sem coluna `users.role`), então não há mutação de privilégio a
		// detectar aqui — a sessão sempre carrega o role corrente. Quando a coluna
		// `role` chegar na migração da 4.9, comparar o role da sessão antiga com o
		// atual e forçar rotação (já é o caminho natural, pois recriamos a sessão).
		const { sessionId: createdSessionId, refreshToken: newRefreshToken } = await createSession(
			oldSession.userId,
			newSessionId,
		);
		const accessToken = await generateAccessToken(oldSession.userId, createdSessionId, user.role);

		return {
			user,
			sessionId: createdSessionId,
			accessToken,
			refreshToken: newRefreshToken,
		};
	}

	async function logout(sessionId: string): Promise<void> {
		await db
			.update(sessions)
			.set({ revokedAt: now() })
			.where(eq(sessions.id, sessionId));
	}

	async function logoutAllForUser(userId: string): Promise<void> {
		await db
			.update(sessions)
			.set({ revokedAt: now() })
			.where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
	}

	async function requestPasswordReset(emailRaw: string): Promise<void> {
		const email = normalizeEmail(emailRaw);

		const rows = await db.select().from(users).where(eq(users.email, email));
		const row = rows[0];

		// Anti-enumeração (FR65): se não existe, retorna void silenciosamente — sem
		// token, sem email, sem throw. A rota aplica jitter pra timing constante.
		if (!row) return;

		// Token ≥128 bits (32 bytes), armazenado só como SHA-256 hex (plain só no link).
		const token = randomBase64UrlBytes(32);
		const tokenHash = await sha256Hex(token);
		const expiresAt = new Date(now().getTime() + RESET_TOKEN_TTL_S * 1000);

		await db.insert(passwordResetTokens).values({
			id: crypto.randomUUID(),
			userId: row.id,
			tokenHash,
			expiresAt,
			createdAt: now(),
		});

		const resetUrl = `${appBaseUrl}/auth/reset-confirm?token=${token}`;
		// mailer é opcional na tipagem (deps); em rotas reais sempre vem injetado.
		await mailer?.sendPasswordReset({ to: email, resetUrl });
	}

	async function confirmPasswordReset(token: string, newPassword: string): Promise<void> {
		const tokenHash = await sha256Hex(token);

		// Token válido = existe, não usado, não expirado. Genérico: qualquer falha → mesmo erro.
		const rows = await db
			.select()
			.from(passwordResetTokens)
			.where(
				and(
					eq(passwordResetTokens.tokenHash, tokenHash),
					isNull(passwordResetTokens.usedAt),
				),
			);
		const tokenRow = rows[0];
		if (!tokenRow || tokenRow.expiresAt.getTime() <= now().getTime()) {
			throw new InvalidResetTokenError();
		}

		const newHash = await hashPassword(newPassword);

		// Atualiza senha, marca single-use e revoga todas as sessões (NFR43).
		await db
			.update(users)
			.set({ passwordHash: newHash })
			.where(eq(users.id, tokenRow.userId));
		await db
			.update(passwordResetTokens)
			.set({ usedAt: now() })
			.where(eq(passwordResetTokens.id, tokenRow.id));
		await logoutAllForUser(tokenRow.userId);
	}

	async function getUserById(userId: string): Promise<SignupResult["user"] | null> {
		const rows = await db.select().from(users).where(eq(users.id, userId));
		const row = rows[0];
		if (!row) return null;
		return {
			id: row.id,
			email: row.email,
			displayName: row.displayName,
			role: deriveRole(row.email, adminEmail),
		};
	}

	return {
		hashPassword,
		verifyPassword,
		signup,
		login,
		rotateRefresh,
		verifyAccessToken,
		logout,
		logoutAllForUser,
		getUserById,
		requestPasswordReset,
		confirmPasswordReset,
	};
}
