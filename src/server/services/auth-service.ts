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
import { sessions, users } from "../db/schema";
import { isDisposableEmail } from "../../lib/shared/disposable-emails";

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
}

export interface AuthService {
	hashPassword(plain: string): Promise<string>;
	verifyPassword(hash: string, plain: string): Promise<boolean>;
	signup(args: SignupArgs): Promise<SignupResult>;
	rotateRefresh(refreshTokenPlain: string): Promise<RotateRefreshResult>;
	verifyAccessToken(token: string): Promise<AccessTokenPayload>;
	logout(sessionId: string): Promise<void>;
	logoutAllForUser(userId: string): Promise<void>;
	getUserById(userId: string): Promise<SignupResult["user"] | null>;
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

// ============================================================================
// Constantes
// ============================================================================

const ACCESS_TOKEN_TTL_S = 15 * 60; // 15min
const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60; // 30 dias
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
	const { db, jwtSecret, adminEmail, now = () => new Date() } = deps;

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
	): Promise<{ sessionId: string; refreshToken: string }> {
		const refreshToken = randomBase64UrlBytes(32); // ≥128 bits ✓
		const refreshTokenHash = await sha256Hex(refreshToken);
		const sessionId = crypto.randomUUID(); // UUID v4 ok p/ session id
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

	async function rotateRefresh(refreshTokenPlain: string): Promise<RotateRefreshResult> {
		const refreshTokenHash = await sha256Hex(refreshTokenPlain);

		// Race protection (R-002): UPDATE atomic com WHERE exigindo revoked_at IS NULL.
		// SQLite serializa transações concorrentes; só 1 vencedor terá `meta.changes === 1`.
		const result = await db
			.update(sessions)
			.set({ revokedAt: now(), lastUsedAt: now() })
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
			// 2 cenários: (a) token nunca existiu → SessionNotFoundError;
			// (b) já foi revogado (reuse ou race perdedora) → SessionRevokedError + revoke all.
			const existsRevoked = await db
				.select()
				.from(sessions)
				.where(eq(sessions.refreshTokenHash, refreshTokenHash));
			if (existsRevoked.length === 0) {
				throw new SessionNotFoundError();
			}
			// Reuse detection: revogar TODAS as sessões do usuário (kill all devices).
			const sess = existsRevoked[0]!;
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

		const user = await getUserById(oldSession.userId);
		if (!user) {
			throw new SessionNotFoundError();
		}

		const { sessionId: newSessionId, refreshToken: newRefreshToken } = await createSession(
			oldSession.userId,
		);
		const accessToken = await generateAccessToken(oldSession.userId, newSessionId, user.role);

		return {
			user,
			sessionId: newSessionId,
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
		rotateRefresh,
		verifyAccessToken,
		logout,
		logoutAllForUser,
		getUserById,
	};
}
