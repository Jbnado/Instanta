import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import app from "../../src/server/app";
import { getDB } from "../../src/server/db/client";

// Integration end-to-end do ciclo de vida do evento (Stories 3.4 + 3.5) no workerd real:
// state machine (Inativo→Ativo→Encerrado), ativação admin, gate público de existência.
// Espelha o setup de auth/cookie de event-edit-list.test.ts. ADMIN = email === ADMIN_EMAIL
// de teste (vitest.workers.config.ts → admin@instanta.test) pra deriveRole devolver "admin".

const ORIGIN = "http://localhost:5173";
const ADMIN_EMAIL = "admin@instanta.test";

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
			displayName: "Host",
			termsAccepted: true,
		}),
	});
}

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

function get(path: string, jar: Record<string, string> = {}): Request {
	return new Request(`http://localhost${path}`, {
		method: "GET",
		headers: { origin: ORIGIN, cookie: cookieHeader(jar) },
	});
}

function eventBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		name: "Festa da Ana",
		eventDate: "2026-07-15T20:00:00.000Z",
		description: "Aniversário",
		colorAccent: "#A855F7",
		presetMissionIds: ["selfie-anfitriao"],
		customMissions: ["Foto com o bolo"],
		...overrides,
	};
}

async function signupAndJar(email: string): Promise<Record<string, string>> {
	const res = await app.request(signupRequest(email), {}, env);
	expect(res.status).toBe(201);
	return readCookies(res);
}

async function createEvent(jar: Record<string, string>): Promise<{ id: string; slug: string }> {
	const res = await app.request(jsonPost("/api/events", jar, eventBody()), {}, env);
	expect(res.status).toBe(201);
	const json = (await res.json()) as { event: { id: string; slug: string } };
	return json.event;
}

describe("event lifecycle (Stories 3.4 + 3.5)", () => {
	// isolatedStorage isola por ARQUIVO (não por teste): o admin (email único ==
	// ADMIN_EMAIL) é criado UMA vez no beforeAll e a jar é reusada entre os `it`s, senão
	// o 2º signup do mesmo email cai na branch anti-enumeração (200 EMAIL_EXISTS). Os
	// hosts/intrusos usam emails únicos por teste pra não colidir entre si.
	let adminJar: Record<string, string>;

	beforeAll(async () => {
		getDB(env);
		adminJar = await signupAndJar(ADMIN_EMAIL);
	});

	it("ciclo completo: Inativo gate 404 → admin ativa → público 200 → host encerra", async () => {
		const hostJar = await signupAndJar("life-host@example.com");
		const created = await createEvent(hostJar);

		// Inativo: gate público → 404 (R-019, não revela existência).
		const pub0 = await app.request(get(`/api/events/${created.slug}/public`), {}, env);
		expect(pub0.status).toBe(404);
		expect((await pub0.json()) as { error: string }).toEqual({ error: "NOT_FOUND" });

		// Non-admin tenta ativar → 403.
		const denied = await app.request(
			jsonPost(`/api/admin/events/${created.slug}/activate`, hostJar),
			{},
			env,
		);
		expect(denied.status).toBe(403);

		// Admin ativa → 200 Ativo.
		const act = await app.request(
			jsonPost(`/api/admin/events/${created.slug}/activate`, adminJar),
			{},
			env,
		);
		expect(act.status).toBe(200);
		const actJson = (await act.json()) as { event: { status: string } };
		expect(actJson.event.status).toBe("Ativo");

		// Agora público → 200 com dados mínimos.
		const pub1 = await app.request(get(`/api/events/${created.slug}/public`), {}, env);
		expect(pub1.status).toBe(200);
		const pub1Json = (await pub1.json()) as {
			event: { slug: string; name: string; status: string; colorAccent: string };
		};
		expect(pub1Json.event.status).toBe("Ativo");
		expect(pub1Json.event.slug).toBe(created.slug);
		expect(pub1Json.event.name).toBe("Festa da Ana");

		// Host encerra → 200 Encerrado.
		const close = await app.request(
			jsonPost(`/api/events/${created.slug}/close`, hostJar),
			{},
			env,
		);
		expect(close.status).toBe(200);
		expect(((await close.json()) as { event: { status: string } }).event.status).toBe(
			"Encerrado",
		);

		// Encerrar de novo → 400 INVALID_STATE.
		const closeAgain = await app.request(
			jsonPost(`/api/events/${created.slug}/close`, hostJar),
			{},
			env,
		);
		expect(closeAgain.status).toBe(400);
		expect((await closeAgain.json()) as { error: string }).toEqual({
			error: "INVALID_STATE",
		});

		// Encerrado → gate público volta a 404.
		const pub2 = await app.request(get(`/api/events/${created.slug}/public`), {}, env);
		expect(pub2.status).toBe(404);
	});

	it("close por não-dono → 404 (não vaza posse)", async () => {
		const hostJar = await signupAndJar("life-owner@example.com");
		const intruderJar = await signupAndJar("life-intruder@example.com");
		const created = await createEvent(hostJar);

		await app.request(
			jsonPost(`/api/admin/events/${created.slug}/activate`, adminJar),
			{},
			env,
		);

		const res = await app.request(
			jsonPost(`/api/events/${created.slug}/close`, intruderJar),
			{},
			env,
		);
		expect(res.status).toBe(404);
		expect((await res.json()) as { error: string }).toEqual({ error: "NOT_FOUND" });
	});

	it("ativar evento inexistente → 404; non-admin lista pendentes → 403", async () => {
		const userJar = await signupAndJar("life-listdenied@example.com");

		const missing = await app.request(
			jsonPost("/api/admin/events/nao-existe-xyz/activate", adminJar),
			{},
			env,
		);
		expect(missing.status).toBe(404);

		const listDenied = await app.request(get("/api/admin/events", userJar), {}, env);
		expect(listDenied.status).toBe(403);

		const listOk = await app.request(get("/api/admin/events", adminJar), {}, env);
		expect(listOk.status).toBe(200);
	});
});
