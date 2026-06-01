import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import * as OTPAuth from "otpauth";
import { beforeEach, describe, expect, it } from "vitest";

import { getDB } from "../db/client";
import { sessions, userMfaSecrets, users } from "../db/schema";
import {
	createMfaService,
	InvalidMfaCodeError,
	MfaReplayError,
	type MfaService,
} from "./mfa-service";

// Chave de teste (32 bytes base64) — mesma do vitest.workers.config.ts.
const TEST_KEY = "dGVzdC1tZmEta2V5LTMyLWJ5dGVzLWFhYWFhYWFhYWE=";

// Clock fixo injetável → TOTP determinístico. timestamp em ms.
const FIXED_MS = 1_700_000_000_000;
function fixedNow(ms = FIXED_MS): () => Date {
	return () => new Date(ms);
}

// Gera o código TOTP que o app authenticator produziria pra esse secret + instante.
function totpCodeFor(secretBase32: string, label: string, ms: number): string {
	const totp = new OTPAuth.TOTP({
		issuer: "Instanta",
		label,
		secret: OTPAuth.Secret.fromBase32(secretBase32),
	});
	return totp.generate({ timestamp: ms });
}

describe("mfa-service", () => {
	let db: ReturnType<typeof getDB>;
	// isolatedStorage isola por ARQUIVO, não por teste — `it`s do mesmo arquivo
	// compartilham o D1. Usamos ids únicos por teste pra não colidir em FK/unique.
	let seq = 0;
	let userId: string;
	let sessionId: string;
	let accountLabel: string;

	async function seedUserAndSession(): Promise<void> {
		await db.insert(users).values({
			id: userId,
			email: accountLabel,
			passwordHash: "x",
			displayName: "Admin",
		});
		await db.insert(sessions).values({
			id: sessionId,
			userId,
			refreshTokenHash: "deadbeef",
		});
	}

	beforeEach(async () => {
		db = getDB(env);
		seq += 1;
		userId = `user-mfa-${seq}`;
		sessionId = `sess-mfa-${seq}`;
		accountLabel = `admin${seq}@instanta.test`;
		await seedUserAndSession();
	});

	describe("encrypt/decrypt (via begin+confirm round-trip)", () => {
		it("o secret persistido é cifrado (≠ base32) e decifra de volta no confirm", async () => {
			const mfa = createMfaService({ db, encryptionKey: TEST_KEY, now: fixedNow() });
			const { secret } = await mfa.beginSetup(userId, accountLabel);

			const [row] = await db
				.select()
				.from(userMfaSecrets)
				.where(eq(userMfaSecrets.userId, userId));
			// O blob persistido NÃO é o base32 em claro.
			expect(row!.secretEncrypted).not.toContain(secret);
			expect(row!.secretEncrypted.length).toBeGreaterThan(0);

			// confirm com o código correto prova que o decrypt recuperou o secret.
			const code = totpCodeFor(secret, "Instanta", FIXED_MS);
			const { recoveryCodes } = await mfa.confirmSetup(userId, code);
			expect(recoveryCodes).toHaveLength(10);
		});
	});

	describe("beginSetup", () => {
		it("retorna otpauthUri + secret e persiste row pendente (confirmedAt null)", async () => {
			const mfa = createMfaService({ db, encryptionKey: TEST_KEY, now: fixedNow() });
			const res = await mfa.beginSetup(userId, accountLabel);

			expect(res.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
			expect(res.otpauthUri).toContain("issuer=Instanta");
			expect(res.secret).toMatch(/^[A-Z2-7]+$/); // base32

			const [row] = await db
				.select()
				.from(userMfaSecrets)
				.where(eq(userMfaSecrets.userId, userId));
			expect(row).toBeDefined();
			expect(row!.confirmedAt).toBeNull();
		});

		it("reiniciar setup antes de confirmar sobrescreve o secret pendente", async () => {
			const mfa = createMfaService({ db, encryptionKey: TEST_KEY, now: fixedNow() });
			const first = await mfa.beginSetup(userId, accountLabel);
			const second = await mfa.beginSetup(userId, accountLabel);
			expect(second.secret).not.toBe(first.secret);

			const rows = await db.select().from(userMfaSecrets).where(eq(userMfaSecrets.userId, userId));
			expect(rows).toHaveLength(1); // upsert, não duplica
		});
	});

	describe("confirmSetup", () => {
		it("código válido → recovery codes + confirmedAt setado", async () => {
			const mfa = createMfaService({ db, encryptionKey: TEST_KEY, now: fixedNow() });
			const { secret } = await mfa.beginSetup(userId, accountLabel);
			const code = totpCodeFor(secret, "Instanta", FIXED_MS);

			const { recoveryCodes } = await mfa.confirmSetup(userId, code);
			expect(recoveryCodes).toHaveLength(10);
			expect(recoveryCodes[0]).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);

			const [row] = await db
				.select()
				.from(userMfaSecrets)
				.where(eq(userMfaSecrets.userId, userId));
			expect(row!.confirmedAt).toBeInstanceOf(Date);
			expect(row!.recoveryCodesHash).toBeTruthy();
			// Persistimos hashes, não plaintext.
			expect(row!.recoveryCodesHash).not.toContain(recoveryCodes[0]);
		});

		it("código errado → InvalidMfaCodeError", async () => {
			const mfa = createMfaService({ db, encryptionKey: TEST_KEY, now: fixedNow() });
			await mfa.beginSetup(userId, accountLabel);
			await expect(mfa.confirmSetup(userId, "000000")).rejects.toBeInstanceOf(
				InvalidMfaCodeError,
			);
		});
	});

	describe("verify + replay protection", () => {
		async function setupConfirmed(mfa: MfaService): Promise<string> {
			const { secret } = await mfa.beginSetup(userId, accountLabel);
			const code = totpCodeFor(secret, "Instanta", FIXED_MS);
			await mfa.confirmSetup(userId, code);
			return secret;
		}

		it("código válido → ok + sessions.mfaVerifiedAt setado", async () => {
			const mfa = createMfaService({ db, encryptionKey: TEST_KEY, now: fixedNow() });
			const secret = await setupConfirmed(mfa);

			// Usa um instante distinto do confirm pra não colidir com o replay guard do confirm
			// (confirm não arma o guard, mas mantemos o teste limpo).
			const verifyMs = FIXED_MS + 60_000;
			const mfaVerify = createMfaService({
				db,
				encryptionKey: TEST_KEY,
				now: fixedNow(verifyMs),
			});
			const code = totpCodeFor(secret, "Instanta", verifyMs);
			await mfaVerify.verify(userId, code, sessionId);

			const [sess] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
			expect(sess!.mfaVerifiedAt).toBeInstanceOf(Date);
		});

		it("mesmo código de novo dentro de 30s → MfaReplayError", async () => {
			const verifyMs = FIXED_MS + 60_000;
			const mfaSetup = createMfaService({ db, encryptionKey: TEST_KEY, now: fixedNow() });
			const secret = await setupConfirmed(mfaSetup);

			const mfa = createMfaService({ db, encryptionKey: TEST_KEY, now: fixedNow(verifyMs) });
			const code = totpCodeFor(secret, "Instanta", verifyMs);
			await mfa.verify(userId, code, sessionId);

			// 10s depois, mesmo código → replay.
			const mfaReplay = createMfaService({
				db,
				encryptionKey: TEST_KEY,
				now: fixedNow(verifyMs + 10_000),
			});
			await expect(mfaReplay.verify(userId, code, sessionId)).rejects.toBeInstanceOf(
				MfaReplayError,
			);
		});

		it("código fora da janela ±1 → InvalidMfaCodeError", async () => {
			const mfaSetup = createMfaService({ db, encryptionKey: TEST_KEY, now: fixedNow() });
			const secret = await setupConfirmed(mfaSetup);

			// Código gerado 5 minutos à frente (10 steps) — bem fora de ±1.
			const farMs = FIXED_MS + 5 * 60_000;
			const staleCode = totpCodeFor(secret, "Instanta", FIXED_MS);
			const mfa = createMfaService({ db, encryptionKey: TEST_KEY, now: fixedNow(farMs) });
			await expect(mfa.verify(userId, staleCode, sessionId)).rejects.toBeInstanceOf(
				InvalidMfaCodeError,
			);
		});

		it("recovery code consome no uso (e não vale de novo)", async () => {
			const mfaSetup = createMfaService({ db, encryptionKey: TEST_KEY, now: fixedNow() });
			const { secret } = await mfaSetup.beginSetup(userId, accountLabel);
			const confirmCode = totpCodeFor(secret, "Instanta", FIXED_MS);
			const { recoveryCodes } = await mfaSetup.confirmSetup(userId, confirmCode);

			const verifyMs = FIXED_MS + 60_000;
			const mfa = createMfaService({ db, encryptionKey: TEST_KEY, now: fixedNow(verifyMs) });
			const rc = recoveryCodes[0]!;
			await mfa.verify(userId, rc, sessionId);

			// Consumido: o array guardado encolheu de 10 → 9.
			const [row] = await db
				.select()
				.from(userMfaSecrets)
				.where(eq(userMfaSecrets.userId, userId));
			const hashes = JSON.parse(row!.recoveryCodesHash!) as string[];
			expect(hashes).toHaveLength(9);

			// Reusar o mesmo recovery code → inválido.
			const mfa2 = createMfaService({
				db,
				encryptionKey: TEST_KEY,
				now: fixedNow(verifyMs + 60_000),
			});
			await expect(mfa2.verify(userId, rc, sessionId)).rejects.toBeInstanceOf(
				InvalidMfaCodeError,
			);
		});
	});

	describe("getStatus", () => {
		it("configured=false antes de confirmar; true depois", async () => {
			const mfa = createMfaService({ db, encryptionKey: TEST_KEY, now: fixedNow() });
			let status = await mfa.getStatus(userId, sessionId);
			expect(status.configured).toBe(false);
			expect(status.verified).toBe(false);

			const { secret } = await mfa.beginSetup(userId, accountLabel);
			status = await mfa.getStatus(userId, sessionId);
			expect(status.configured).toBe(false); // pendente, ainda não confirmado

			const code = totpCodeFor(secret, "Instanta", FIXED_MS);
			await mfa.confirmSetup(userId, code);
			status = await mfa.getStatus(userId, sessionId);
			expect(status.configured).toBe(true);
			expect(status.verified).toBe(false); // sessão ainda não verificou
		});

		it("verified=true após verify na sessão", async () => {
			const mfaSetup = createMfaService({ db, encryptionKey: TEST_KEY, now: fixedNow() });
			const { secret } = await mfaSetup.beginSetup(userId, accountLabel);
			await mfaSetup.confirmSetup(userId, totpCodeFor(secret, "Instanta", FIXED_MS));

			const verifyMs = FIXED_MS + 60_000;
			const mfa = createMfaService({ db, encryptionKey: TEST_KEY, now: fixedNow(verifyMs) });
			await mfa.verify(userId, totpCodeFor(secret, "Instanta", verifyMs), sessionId);

			const status = await mfa.getStatus(userId, sessionId);
			expect(status.verified).toBe(true);
		});
	});
});
