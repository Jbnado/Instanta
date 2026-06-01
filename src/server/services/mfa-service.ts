/**
 * MFA service — Stories 2.7 (setup) + 2.8 (verify + replay protection).
 *
 * Serviço puro: não importa hono, c.env ou middleware. Recebe deps via factory
 * pra teste isolado (clock `now` injetável → TOTP determinístico). Toda a lógica de
 * cripto do secret, geração/validação TOTP, recovery codes e replay guard vive aqui;
 * os handlers HTTP (`routes/auth.ts`) só traduzem erro → HTTP.
 *
 * Cripto (NFR45/NFR25):
 * - O secret base32 do TOTP é cifrado em AES-GCM com `MFA_ENCRYPTION_KEY` (chave de
 *   32 bytes em base64, SEPARADA do AUTH_JWT_SECRET) e só assim toca o banco.
 * - Recovery codes guardam só o SHA-256 hex (JSON array); o plaintext é exibido UMA vez.
 * - NUNCA logamos secret, código, recovery code ou a chave.
 *
 * Replay protection (Story 2.8): guardamos o último código aceito + timestamp. Mesmo
 * código reapresentado dentro de 30s → MfaReplayError (TOTP é válido por ~90s na janela
 * ±1, então sem isso o mesmo código passaria várias vezes).
 */
import { eq } from "drizzle-orm";
import * as OTPAuth from "otpauth";

import type { DB } from "../db/client";
import { sessions, userMfaSecrets } from "../db/schema";

// ============================================================================
// Tipos
// ============================================================================

export interface MfaServiceDeps {
	db: DB;
	/** MFA_ENCRYPTION_KEY — chave AES-GCM em base64 (32 bytes). Separada do JWT secret. */
	encryptionKey: string;
	/** Clock injetável para testes determinísticos (TOTP + replay guard). */
	now?: () => Date;
}

export interface BeginSetupResult {
	/** URI otpauth:// pro QR Code do app authenticator. */
	otpauthUri: string;
	/** Secret base32 pra entrada manual (quando o usuário não pode escanear o QR). */
	secret: string;
}

export interface MfaStatus {
	/** true = secret confirmado (setup concluído). */
	configured: boolean;
	/** true = a sessão atual já satisfez o 2º fator. */
	verified: boolean;
}

export interface MfaService {
	beginSetup(userId: string, accountLabel: string): Promise<BeginSetupResult>;
	confirmSetup(userId: string, code: string): Promise<{ recoveryCodes: string[] }>;
	verify(userId: string, code: string, sessionId: string): Promise<void>;
	getStatus(userId: string, sessionId: string): Promise<MfaStatus>;
}

// ============================================================================
// Erros tipados — handlers de rota traduzem pra HTTP code + microcopy.
// ============================================================================

/** Código TOTP (ou recovery) inválido. Genérico: não distingue qual falhou. */
export class InvalidMfaCodeError extends Error {
	readonly code = "MFA_INVALID_CODE";
	constructor() {
		super("Invalid MFA code");
	}
}

/** Mesmo código aceito reapresentado dentro da janela de replay (30s). */
export class MfaReplayError extends Error {
	readonly code = "MFA_REPLAY";
	constructor() {
		super("MFA code already used recently (replay)");
	}
}

/** Setup não iniciado / não confirmado quando uma operação exigia. */
export class MfaNotConfiguredError extends Error {
	readonly code = "MFA_NOT_CONFIGURED";
	constructor() {
		super("MFA secret not found or not confirmed");
	}
}

// ============================================================================
// Constantes
// ============================================================================

const ISSUER = "Instanta";
// Janela de replay (Story 2.8): mesmo código aceito de novo dentro disso → rejeita.
const REPLAY_WINDOW_S = 30;
// Tolerância de clock skew RFC 6238: ±1 step (cada step = 30s).
const TOTP_WINDOW = 1;
// Recovery codes: 10 códigos, cada um 10 chars base32-ish em 2 grupos (legível).
const RECOVERY_CODE_COUNT = 10;
const GCM_IV_BYTES = 12;

// ============================================================================
// Helpers crypto (Web Crypto nativo do workerd; sem dep extra)
// ============================================================================

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
	let str = "";
	for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]!);
	return btoa(str);
}

async function sha256Hex(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const hash = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

// Recovery code legível: 10 chars do alfabeto Crockford-ish em 2 grupos de 5
// (ex.: "A3F9K-2M7QX"). Entropia ~50 bits por código — suficiente como fallback
// single-use de 10 unidades. Sem caracteres ambíguos (0/O, 1/I/L).
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generateRecoveryCode(): string {
	const buf = new Uint8Array(10);
	crypto.getRandomValues(buf);
	let out = "";
	for (let i = 0; i < buf.length; i++) {
		if (i === 5) out += "-";
		out += RECOVERY_ALPHABET[buf[i]! % RECOVERY_ALPHABET.length];
	}
	return out;
}

// ============================================================================
// Factory
// ============================================================================

export function createMfaService(deps: MfaServiceDeps): MfaService {
	const { db, encryptionKey, now = () => new Date() } = deps;

	// Importa a chave AES-GCM uma vez (lazy + memoizada na closure). A chave em base64
	// decodifica pra 32 bytes (AES-256).
	let keyPromise: Promise<CryptoKey> | null = null;
	function getKey(): Promise<CryptoKey> {
		if (!keyPromise) {
			const raw = base64ToBytes(encryptionKey);
			keyPromise = crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
				"encrypt",
				"decrypt",
			]);
		}
		return keyPromise;
	}

	// encrypt → base64( iv(12) || ciphertext ). IV aleatório por operação (GCM exige).
	async function encrypt(plaintext: string): Promise<string> {
		const key = await getKey();
		const iv = new Uint8Array(GCM_IV_BYTES);
		crypto.getRandomValues(iv);
		const ct = await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv },
			key,
			new TextEncoder().encode(plaintext),
		);
		const ctBytes = new Uint8Array(ct);
		const blob = new Uint8Array(iv.byteLength + ctBytes.byteLength);
		blob.set(iv, 0);
		blob.set(ctBytes, iv.byteLength);
		return bytesToBase64(blob);
	}

	async function decrypt(blobB64: string): Promise<string> {
		const key = await getKey();
		const blob = base64ToBytes(blobB64);
		const iv = blob.subarray(0, GCM_IV_BYTES);
		const ct = blob.subarray(GCM_IV_BYTES);
		const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
		return new TextDecoder().decode(pt);
	}

	// Monta o objeto TOTP a partir do secret base32 + label da conta.
	function buildTotp(secretBase32: string, accountLabel: string): OTPAuth.TOTP {
		return new OTPAuth.TOTP({
			issuer: ISSUER,
			label: accountLabel,
			secret: OTPAuth.Secret.fromBase32(secretBase32),
		});
	}

	async function beginSetup(userId: string, accountLabel: string): Promise<BeginSetupResult> {
		const secret = new OTPAuth.Secret();
		const totp = new OTPAuth.TOTP({ issuer: ISSUER, label: accountLabel, secret });
		const otpauthUri = totp.toString();
		const secretEncrypted = await encrypt(secret.base32);

		// UPSERT: reiniciar o setup antes de confirmar sobrescreve o secret pendente e
		// zera confirmedAt/recovery/replay-guard. Após confirmado, beginSetup gera um
		// secret novo (re-setup) — o admin teria que reconfirmar.
		await db
			.insert(userMfaSecrets)
			.values({ userId, secretEncrypted, createdAt: now() })
			.onConflictDoUpdate({
				target: userMfaSecrets.userId,
				set: {
					secretEncrypted,
					confirmedAt: null,
					recoveryCodesHash: null,
					lastVerifiedCode: null,
					lastVerifiedAt: null,
				},
			});

		return { otpauthUri, secret: secret.base32 };
	}

	async function confirmSetup(
		userId: string,
		code: string,
	): Promise<{ recoveryCodes: string[] }> {
		const rows = await db
			.select()
			.from(userMfaSecrets)
			.where(eq(userMfaSecrets.userId, userId));
		const row = rows[0];
		if (!row) throw new MfaNotConfiguredError();

		const secretBase32 = await decrypt(row.secretEncrypted);
		const totp = buildTotp(secretBase32, ISSUER);
		const delta = totp.validate({
			token: code,
			window: TOTP_WINDOW,
			timestamp: now().getTime(),
		});
		if (delta === null) throw new InvalidMfaCodeError();

		// Gera os recovery codes (plaintext, exibidos uma vez), guarda só os hashes.
		const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
		const hashes = await Promise.all(recoveryCodes.map((c) => sha256Hex(c)));

		await db
			.update(userMfaSecrets)
			.set({ confirmedAt: now(), recoveryCodesHash: JSON.stringify(hashes) })
			.where(eq(userMfaSecrets.userId, userId));

		return { recoveryCodes };
	}

	async function verify(userId: string, code: string, sessionId: string): Promise<void> {
		const rows = await db
			.select()
			.from(userMfaSecrets)
			.where(eq(userMfaSecrets.userId, userId));
		const row = rows[0];
		// Só uma config CONFIRMADA pode ser verificada.
		if (!row || row.confirmedAt === null) throw new MfaNotConfiguredError();

		// Replay guard (Story 2.8): mesmo código aceito dentro de REPLAY_WINDOW_S → rejeita.
		if (
			row.lastVerifiedCode !== null &&
			row.lastVerifiedAt !== null &&
			code === row.lastVerifiedCode &&
			(now().getTime() - row.lastVerifiedAt.getTime()) / 1000 < REPLAY_WINDOW_S
		) {
			throw new MfaReplayError();
		}

		const secretBase32 = await decrypt(row.secretEncrypted);
		const totp = buildTotp(secretBase32, ISSUER);
		const delta = totp.validate({
			token: code,
			window: TOTP_WINDOW,
			timestamp: now().getTime(),
		});

		if (delta === null) {
			// Não bateu como TOTP: tenta como recovery code (single-use, consome no uso).
			const consumed = await tryConsumeRecoveryCode(row.recoveryCodesHash, userId, code);
			if (!consumed) throw new InvalidMfaCodeError();
			// Recovery codes NÃO entram no replay guard (são single-use e já consumidos).
		} else {
			// TOTP aceito: arma o replay guard com o código corrente.
			await db
				.update(userMfaSecrets)
				.set({ lastVerifiedCode: code, lastVerifiedAt: now() })
				.where(eq(userMfaSecrets.userId, userId));
		}

		// Marca a sessão como MFA-satisfeita (Story 2.8) — é por-sessão.
		await db
			.update(sessions)
			.set({ mfaVerifiedAt: now() })
			.where(eq(sessions.id, sessionId));
	}

	// Compara o código com os hashes guardados; se bater, remove o hash (consome) e
	// regrava o array. Retorna true se consumiu, false se não bateu nenhum.
	async function tryConsumeRecoveryCode(
		recoveryCodesHashJson: string | null,
		userId: string,
		code: string,
	): Promise<boolean> {
		if (!recoveryCodesHashJson) return false;
		let hashes: string[];
		try {
			hashes = JSON.parse(recoveryCodesHashJson) as string[];
		} catch {
			return false;
		}
		const codeHash = await sha256Hex(code.trim());
		const idx = hashes.indexOf(codeHash);
		if (idx === -1) return false;
		hashes.splice(idx, 1);
		await db
			.update(userMfaSecrets)
			.set({ recoveryCodesHash: JSON.stringify(hashes) })
			.where(eq(userMfaSecrets.userId, userId));
		return true;
	}

	async function getStatus(userId: string, sessionId: string): Promise<MfaStatus> {
		const rows = await db
			.select({ confirmedAt: userMfaSecrets.confirmedAt })
			.from(userMfaSecrets)
			.where(eq(userMfaSecrets.userId, userId));
		const configured = rows[0]?.confirmedAt != null;

		const sessRows = await db
			.select({ mfaVerifiedAt: sessions.mfaVerifiedAt })
			.from(sessions)
			.where(eq(sessions.id, sessionId));
		const verified = sessRows[0]?.mfaVerifiedAt != null;

		return { configured, verified };
	}

	return { beginSetup, confirmSetup, verify, getStatus };
}
