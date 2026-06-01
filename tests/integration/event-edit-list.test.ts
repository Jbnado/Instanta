import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import app from "../../src/server/app";
import { getDB } from "../../src/server/db/client";
import { events } from "../../src/server/db/schema";

// Integration end-to-end de GET/PATCH /api/events dentro do workerd real (Stories 3.2 + 3.3).
// Espelha o setup de auth/cookie do event-create.test.ts: signup → cookie instanta_access
// (path "/" → enviado a /api/events). CSRF/assertOrigin satisfeitos pelo Origin allowlisted.

const ORIGIN = "http://localhost:5173";

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

// Extrai `name=value` (sem atributos) dos Set-Cookie de uma response.
function readCookies(res: Response): Record<string, string> {
	const raw = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
	const jar: Record<string, string> = {};
	for (const line of raw) {
		const [pair] = line.split(";");
		const eqIdx = pair?.indexOf("=") ?? -1;
		if (pair && eqIdx > 0) {
			jar[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
		}
	}
	return jar;
}

function cookieHeader(jar: Record<string, string>): string {
	return Object.entries(jar)
		.map(([k, v]) => `${k}=${v}`)
		.join("; ");
}

function createEventRequest(
	jar: Record<string, string>,
	body: Record<string, unknown>,
): Request {
	return new Request("http://localhost/api/events", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: ORIGIN,
			cookie: cookieHeader(jar),
		},
		body: JSON.stringify(body),
	});
}

function listEventsRequest(jar: Record<string, string>): Request {
	return new Request("http://localhost/api/events", {
		method: "GET",
		headers: { origin: ORIGIN, cookie: cookieHeader(jar) },
	});
}

function getEventRequest(jar: Record<string, string>, slug: string): Request {
	return new Request(`http://localhost/api/events/${slug}`, {
		method: "GET",
		headers: { origin: ORIGIN, cookie: cookieHeader(jar) },
	});
}

function patchEventRequest(
	jar: Record<string, string>,
	slug: string,
	body: Record<string, unknown>,
): Request {
	return new Request(`http://localhost/api/events/${slug}`, {
		method: "PATCH",
		headers: {
			"content-type": "application/json",
			origin: ORIGIN,
			cookie: cookieHeader(jar),
		},
		body: JSON.stringify(body),
	});
}

function eventBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		name: "Festa da Ana",
		eventDate: "2026-07-15T20:00:00.000Z",
		description: "Aniversário",
		password: "festa2026",
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

async function createEvent(
	jar: Record<string, string>,
	overrides: Record<string, unknown> = {},
): Promise<{ id: string; slug: string }> {
	const res = await app.request(createEventRequest(jar, eventBody(overrides)), {}, env);
	expect(res.status).toBe(201);
	const json = (await res.json()) as { event: { id: string; slug: string } };
	return json.event;
}

describe("GET/PATCH /api/events (Stories 3.2 + 3.3)", () => {
	let db: ReturnType<typeof getDB>;

	beforeEach(() => {
		db = getDB(env);
	});

	it("GET /api/events → 200 lista só os eventos do anfitrião", async () => {
		const jar = await signupAndJar("el-list@example.com");
		await createEvent(jar, { name: "Evento A", eventDate: "2026-05-01T20:00:00.000Z" });
		await createEvent(jar, { name: "Evento B", eventDate: "2026-07-01T20:00:00.000Z" });

		const res = await app.request(listEventsRequest(jar), {}, env);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { events: Array<{ name: string }> };
		expect(json.events).toHaveLength(2);
		expect(json.events.map((e) => e.name)).toEqual(["Evento A", "Evento B"]);
	});

	it("GET /api/events → não vaza eventos de outro anfitrião", async () => {
		const jarA = await signupAndJar("el-isolA@example.com");
		const jarB = await signupAndJar("el-isolB@example.com");
		await createEvent(jarA, { name: "Só do A" });

		const res = await app.request(listEventsRequest(jarB), {}, env);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { events: unknown[] };
		expect(json.events).toHaveLength(0);
	});

	it("GET /api/events/:slug → 200 com missões pro dono", async () => {
		const jar = await signupAndJar("el-detail@example.com");
		const created = await createEvent(jar);

		const res = await app.request(getEventRequest(jar, created.slug), {}, env);
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			event: { id: string; missions: Array<{ label: string; isPreset: boolean }> };
		};
		expect(json.event.id).toBe(created.id);
		expect(json.event.missions).toHaveLength(2);
		expect(
			json.event.missions.some((m) => m.isPreset && m.label === "Selfie com o anfitrião"),
		).toBe(true);
	});

	it("GET /api/events/:slug por outro usuário → 404", async () => {
		const jarA = await signupAndJar("el-owner@example.com");
		const jarB = await signupAndJar("el-intruder@example.com");
		const created = await createEvent(jarA);

		const res = await app.request(getEventRequest(jarB, created.slug), {}, env);
		expect(res.status).toBe(404);
		const json = (await res.json()) as { error: string };
		expect(json.error).toBe("NOT_FOUND");
	});

	it("PATCH /api/events/:slug → 200 + persiste o novo nome", async () => {
		const jar = await signupAndJar("el-patch@example.com");
		const created = await createEvent(jar);

		const res = await app.request(
			patchEventRequest(jar, created.slug, { name: "Nome Editado" }),
			{},
			env,
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { event: { name: string } };
		expect(json.event.name).toBe("Nome Editado");

		const [row] = await db.select().from(events).where(eq(events.id, created.id));
		expect(row!.name).toBe("Nome Editado");
	});

	it("PATCH /api/events/:slug por outro usuário → 404 (não 403)", async () => {
		const jarA = await signupAndJar("el-patchowner@example.com");
		const jarB = await signupAndJar("el-patchintruder@example.com");
		const created = await createEvent(jarA);

		const res = await app.request(
			patchEventRequest(jarB, created.slug, { name: "Hack" }),
			{},
			env,
		);
		expect(res.status).toBe(404);
		const json = (await res.json()) as { error: string };
		expect(json.error).toBe("NOT_FOUND");
	});

	it("GET /api/events sem autenticação → 401", async () => {
		const res = await app.request(listEventsRequest({}), {}, env);
		expect(res.status).toBe(401);
	});
});
