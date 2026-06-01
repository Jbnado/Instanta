import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import app from "../../src/server/app";
import { getDB } from "../../src/server/db/client";
import { eventMissions, events } from "../../src/server/db/schema";

// Integration end-to-end do POST /api/events dentro do workerd real.
// CSRF/assertOrigin exigem Origin allowlisted (localhost:5173). Autentica fazendo
// um signup e reusando o cookie `instanta_access` (path "/" → enviado a /api/events).
// Rate limit chaveado por user.id (bucket event-create, 5/dia).

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

// Para CSRF double-submit precisamos do cookie CSRF + header correspondente. Na
// prática deste app, assertOrigin + Origin allowlisted já satisfaz o middleware de
// mutation; replicamos exatamente o que os testes de auth fazem (só Origin + cookies).
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

const validBody = {
	name: "Festa da Ana",
	eventDate: "2026-07-15T20:00:00.000Z",
	description: "Aniversário",
	password: "festa2026",
	colorAccent: "#A855F7",
	presetMissionIds: ["selfie-anfitriao"],
	customMissions: ["Foto com o bolo"],
};

async function signupAndJar(email: string): Promise<Record<string, string>> {
	const res = await app.request(signupRequest(email), {}, env);
	expect(res.status).toBe(201);
	return readCookies(res);
}

describe("POST /api/events", () => {
	let db: ReturnType<typeof getDB>;

	beforeEach(() => {
		db = getDB(env);
	});

	it("happy path → 201 + linhas de evento e missões no DB", async () => {
		const jar = await signupAndJar("ev-happy@example.com");
		const res = await app.request(createEventRequest(jar, validBody), {}, env);
		expect(res.status).toBe(201);

		const json = (await res.json()) as {
			event: { id: string; slug: string; name: string; status: string; colorAccent: string };
		};
		expect(json.event.id).toBeTruthy();
		expect(json.event.slug).toBeTruthy();
		expect(json.event.status).toBe("Inativo");
		expect(json.event.colorAccent).toBe("#A855F7");

		const [row] = await db.select().from(events).where(eq(events.id, json.event.id));
		expect(row).toBeDefined();
		expect(row!.status).toBe("Inativo");
		expect(row!.cap).toBe(10_737_418_240);
		expect(row!.bytesUsed).toBe(0);
		expect(row!.passwordHash).toMatch(/^\$argon2id\$/);

		const missions = await db
			.select()
			.from(eventMissions)
			.where(eq(eventMissions.eventId, json.event.id));
		expect(missions).toHaveLength(2);
		expect(missions.some((m) => m.isPreset && m.label === "Selfie com o anfitrião")).toBe(true);
		expect(missions.some((m) => !m.isPreset && m.label === "Foto com o bolo")).toBe(true);
	});

	it("sem autenticação → 401", async () => {
		const res = await app.request(createEventRequest({}, validBody), {}, env);
		expect(res.status).toBe(401);
	});

	it("validação Zod (sem name) → 400", async () => {
		const jar = await signupAndJar("ev-zod@example.com");
		const { name: _omit, ...noName } = validBody;
		const res = await app.request(createEventRequest(jar, noName), {}, env);
		expect(res.status).toBe(400);
	});

	it("limite de 3 ativos → 4º retorna 403 ACTIVE_LIMIT_REACHED", async () => {
		const jar = await signupAndJar("ev-limit@example.com");
		for (let i = 0; i < 3; i++) {
			const r = await app.request(
				createEventRequest(jar, { ...validBody, name: `Evento ${i}` }),
				{},
				env,
			);
			expect(r.status).toBe(201);
		}
		const res = await app.request(
			createEventRequest(jar, { ...validBody, name: "Quarto" }),
			{},
			env,
		);
		expect(res.status).toBe(403);
		const json = (await res.json()) as { error: string };
		expect(json.error).toBe("ACTIVE_LIMIT_REACHED");
	});

	it("rate limit → 6ª criação no mesmo usuário/dia retorna 429 com Retry-After", async () => {
		const jar = await signupAndJar("ev-rl@example.com");
		// 5 criações permitidas. Da 4ª em diante batem no limite de eventos ativos (403),
		// mas o rate limit conta TODAS as requisições que passam pelo middleware (antes do
		// service), então a 6ª passa do bucket de 5 → 429.
		for (let i = 0; i < 5; i++) {
			await app.request(
				createEventRequest(jar, { ...validBody, name: `RL ${i}` }),
				{},
				env,
			);
		}
		const res = await app.request(
			createEventRequest(jar, { ...validBody, name: "RL sexta" }),
			{},
			env,
		);
		expect(res.status).toBe(429);
		expect(res.headers.get("Retry-After")).toBeTruthy();
	});
});
