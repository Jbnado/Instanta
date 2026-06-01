import { env } from "cloudflare:test";
import * as OTPAuth from "otpauth";
import { beforeAll, describe, expect, it } from "vitest";

import app from "../../src/server/app";
import { getDB } from "../../src/server/db/client";

// Fluxo HTTP completo de MFA (Stories 2.7 setup + 2.8 verify) no workerd real.
// Admin = email === ADMIN_EMAIL de teste (vitest.workers.config.ts → admin@instanta.test),
// pra que deriveRole devolva "admin" e as rotas admin-only liberem.
// A lógica de cripto/TOTP/replay tem cobertura isolada em mfa-service.test.ts; aqui
// exercitamos o caminho rota → middleware → service end-to-end.

const ORIGIN = "http://localhost:5173";
const ADMIN_EMAIL = "admin@instanta.test";

function readCookies(res: Response): Record<string, string> {
	const raw = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
	const jar: Record<string, string> = {};
	for (const line of raw) {
		const [pair] = line.split(";");
		const eqIdx = pair?.indexOf("=") ?? -1;
		if (pair && eqIdx > 0) jar[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
	}
	return jar;
}

function cookieHeader(jar: Record<string, string>): string {
	return Object.entries(jar)
		.map(([k, v]) => `${k}=${v}`)
		.join("; ");
}

function signupRequest(email: string): Request {
	return new Request("http://localhost/api/auth/signup", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: ORIGIN,
			"cf-connecting-ip": `ip-${email}`,
		},
		body: JSON.stringify({
			email,
			password: "senha123abc",
			displayName: "Tester",
			termsAccepted: true,
		}),
	});
}

function jsonPost(path: string, jar: Record<string, string>, body?: unknown): Request {
	return new Request(`http://localhost${path}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: ORIGIN,
			cookie: cookieHeader(jar),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

function get(path: string, jar: Record<string, string>): Request {
	return new Request(`http://localhost${path}`, {
		method: "GET",
		headers: { origin: ORIGIN, cookie: cookieHeader(jar) },
	});
}

// Código TOTP atual pro secret base32 (mesmo relógio que o workerd usa nas rotas).
function totpNow(secretBase32: string, label: string): string {
	const totp = new OTPAuth.TOTP({
		issuer: "Instanta",
		label,
		secret: OTPAuth.Secret.fromBase32(secretBase32),
	});
	return totp.generate();
}

describe("MFA TOTP HTTP flow", () => {
	// isolatedStorage isola por ARQUIVO: o admin (email único == ADMIN_EMAIL) é criado
	// UMA vez e a jar é compartilhada entre os `it`s admin. O teste de código errado roda
	// ANTES do happy path e deixa só um setup pendente — o happy path refaz o setup
	// (overwrite) antes de confirmar, então não há interferência.
	let adminJar: Record<string, string>;

	beforeAll(async () => {
		getDB(env);
		const res = await app.request(signupRequest(ADMIN_EMAIL), {}, env);
		expect(res.status).toBe(201);
		adminJar = readCookies(res);
	});

	it("confirm com código errado → 400 MFA_INVALID_CODE", async () => {
		await app.request(jsonPost("/api/auth/mfa/setup", adminJar), {}, env);
		const res = await app.request(
			jsonPost("/api/auth/mfa/confirm", adminJar, { code: "000000" }),
			{},
			env,
		);
		expect(res.status).toBe(400);
		expect((await res.json()) as { error: string }).toEqual({ error: "MFA_INVALID_CODE" });
	});

	it("admin: setup → confirm → verify → status reflete configured+verified", async () => {
		const jar = adminJar;

		// /me confirma role admin.
		const meRes = await app.request(get("/api/auth/me", jar), {}, env);
		expect(meRes.status).toBe(200);
		const me = (await meRes.json()) as { user: { role: string; email: string } };
		expect(me.user.role).toBe("admin");

		// status inicial: nada configurado.
		const s0 = (await (await app.request(get("/api/auth/mfa/status", jar), {}, env)).json()) as {
			configured: boolean;
			verified: boolean;
		};
		expect(s0).toEqual({ configured: false, verified: false });

		// setup → otpauthUri + secret.
		const setupRes = await app.request(jsonPost("/api/auth/mfa/setup", jar), {}, env);
		expect(setupRes.status).toBe(200);
		const setup = (await setupRes.json()) as { otpauthUri: string; secret: string };
		expect(setup.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
		expect(setup.secret).toMatch(/^[A-Z2-7]+$/);

		// confirm com código válido → recovery codes.
		const confirmRes = await app.request(
			jsonPost("/api/auth/mfa/confirm", jar, { code: totpNow(setup.secret, ADMIN_EMAIL) }),
			{},
			env,
		);
		expect(confirmRes.status).toBe(200);
		const confirm = (await confirmRes.json()) as { recoveryCodes: string[] };
		expect(confirm.recoveryCodes).toHaveLength(10);

		// status: configured=true, verified ainda false.
		const s1 = (await (await app.request(get("/api/auth/mfa/status", jar), {}, env)).json()) as {
			configured: boolean;
			verified: boolean;
		};
		expect(s1.configured).toBe(true);
		expect(s1.verified).toBe(false);

		// verify → ok.
		const verifyRes = await app.request(
			jsonPost("/api/auth/mfa/verify", jar, { code: totpNow(setup.secret, ADMIN_EMAIL) }),
			{},
			env,
		);
		expect(verifyRes.status).toBe(200);
		expect((await verifyRes.json()) as { ok: boolean }).toEqual({ ok: true });

		// status: verified=true.
		const s2 = (await (await app.request(get("/api/auth/mfa/status", jar), {}, env)).json()) as {
			configured: boolean;
			verified: boolean;
		};
		expect(s2.verified).toBe(true);
	});

	it("não-admin → 403 em /mfa/setup", async () => {
		const res = await app.request(signupRequest("guest@example.com"), {}, env);
		expect(res.status).toBe(201);
		const jar = readCookies(res);

		const setupRes = await app.request(jsonPost("/api/auth/mfa/setup", jar), {}, env);
		expect(setupRes.status).toBe(403);
	});

	it("sem cookies → 401 em /mfa/status", async () => {
		const res = await app.request(get("/api/auth/mfa/status", {}), {}, env);
		expect(res.status).toBe(401);
	});
});
