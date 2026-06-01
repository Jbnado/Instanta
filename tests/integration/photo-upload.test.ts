import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import app from "../../src/server/app";
import { getDB } from "../../src/server/db/client";
import { eventPhotos, events } from "../../src/server/db/schema";

// Integration end-to-end do pipeline de upload (Epic 6, Stories 6.5-6.7) no workerd real,
// pivotado pra R2: POST dos BYTES da imagem pelo Worker (valida magic bytes → cap atomic
// → insert event_photos → PHOTOS.put). Depois GET /photos/:id/file serve do R2.
// Espelha o setup de auth/cookie + ativação admin de event-lifecycle.test.ts.

const ORIGIN = "http://localhost:5173";
const ADMIN_EMAIL = "admin@instanta.test";

// JPEG real (SOI + APP0/JFIF) — file-type reconhece como image/jpeg.
const JPEG_BYTES = new Uint8Array([
	0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
	0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
]);
// Texto puro — não é imagem reconhecível (mas mandado com content-type de imagem
// pra passar o gate de header e bater no magic-bytes do service → 415).
const TEXT_BYTES = new TextEncoder().encode("isto definitivamente não é uma imagem");

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

// POST de bytes de imagem (upload através do Worker). content-type = mime da imagem.
function imagePost(
	path: string,
	jar: Record<string, string>,
	bytes: Uint8Array,
	contentType = "image/jpeg",
): Request {
	return new Request(`http://localhost${path}`, {
		method: "POST",
		headers: {
			"content-type": contentType,
			origin: ORIGIN,
			cookie: cookieHeader(jar),
		},
		body: bytes,
	});
}

function eventBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		name: "Festa da Ana",
		eventDate: "2026-07-15T20:00:00.000Z",
		description: "Aniversário",
		password: "festa2026",
		colorAccent: "#A855F7",
		presetMissionIds: [],
		customMissions: [],
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

// Cria evento + ativa (admin). Retorna { id, slug }.
async function createActiveEvent(
	hostJar: Record<string, string>,
	adminJar: Record<string, string>,
): Promise<{ id: string; slug: string }> {
	const created = await createEvent(hostJar);
	const act = await app.request(
		jsonPost(`/api/admin/events/${created.slug}/activate`, adminJar),
		{},
		env,
	);
	expect(act.status).toBe(200);
	return created;
}

const QS = "?width=4000&height=3000";

describe("photo upload pipeline R2 (Epic 6, Stories 6.5-6.7)", () => {
	let adminJar: Record<string, string>;

	beforeAll(async () => {
		getDB(env);
		adminJar = await signupAndJar(ADMIN_EMAIL);
	});

	it("happy path: POST bytes JPEG → 201 + row + bytesUsed bump → GET /file serve do R2", async () => {
		const hostJar = await signupAndJar("up-happy@example.com");
		const { id, slug } = await createActiveEvent(hostJar, adminJar);

		const res = await app.request(
			imagePost(`/api/events/${slug}/photos${QS}`, hostJar, JPEG_BYTES),
			{},
			env,
		);
		expect(res.status).toBe(201);
		const json = (await res.json()) as {
			photo: { id: string; storageKey: string; createdAt: string };
		};
		expect(json.photo.id).toBeTruthy();
		expect(json.photo.storageKey).toBe(`events/${id}/${json.photo.id}`);

		const db = getDB(env);
		const [photo] = await db
			.select()
			.from(eventPhotos)
			.where(eq(eventPhotos.id, json.photo.id));
		expect(photo).toBeDefined();
		expect(photo!.sizeBytes).toBe(JPEG_BYTES.byteLength);
		expect(photo!.cfImageId).toBe(json.photo.storageKey);

		const [ev] = await db.select().from(events).where(eq(events.id, id));
		expect(ev!.bytesUsed).toBe(JPEG_BYTES.byteLength);

		// Serve do R2 (público, sem auth). Content-Type + cache imutável.
		const fileRes = await app.request(
			new Request(`http://localhost/api/events/${slug}/photos/${json.photo.id}/file`),
			{},
			env,
		);
		expect(fileRes.status).toBe(200);
		expect(fileRes.headers.get("content-type")).toBe("image/jpeg");
		expect(fileRes.headers.get("cache-control")).toContain("immutable");
		const served = new Uint8Array(await fileRes.arrayBuffer());
		expect(served).toEqual(JPEG_BYTES);
	});

	it("POST de não-imagem (content-type image, bytes texto) → 415 INVALID_IMAGE", async () => {
		const hostJar = await signupAndJar("up-badtype@example.com");
		const { slug } = await createActiveEvent(hostJar, adminJar);

		const res = await app.request(
			imagePost(`/api/events/${slug}/photos${QS}`, hostJar, TEXT_BYTES),
			{},
			env,
		);
		expect(res.status).toBe(415);
		expect((await res.json()) as { error: string }).toEqual({ error: "INVALID_IMAGE" });
	});

	it("POST com content-type não permitido (text/plain) → 415", async () => {
		const hostJar = await signupAndJar("up-ct@example.com");
		const { slug } = await createActiveEvent(hostJar, adminJar);

		const res = await app.request(
			imagePost(`/api/events/${slug}/photos${QS}`, hostJar, JPEG_BYTES, "text/plain"),
			{},
			env,
		);
		expect(res.status).toBe(415);
	});

	it("cap estourado → 409 CAP_EXCEEDED", async () => {
		const hostJar = await signupAndJar("up-cap@example.com");
		const { id, slug } = await createActiveEvent(hostJar, adminJar);

		// Aperta o cap: cap=25, usado=10 → JPEG (20 bytes) estoura (30 > 25).
		const db = getDB(env);
		await db.update(events).set({ cap: 25, bytesUsed: 10 }).where(eq(events.id, id));

		const res = await app.request(
			imagePost(`/api/events/${slug}/photos${QS}`, hostJar, JPEG_BYTES),
			{},
			env,
		);
		expect(res.status).toBe(409);
		expect((await res.json()) as { error: string }).toEqual({ error: "CAP_EXCEEDED" });
	});

	it("sem auth → 401", async () => {
		const hostJar = await signupAndJar("up-owner@example.com");
		const { slug } = await createActiveEvent(hostJar, adminJar);

		const res = await app.request(
			imagePost(`/api/events/${slug}/photos${QS}`, {}, JPEG_BYTES),
			{},
			env,
		);
		expect(res.status).toBe(401);
	});

	it("upload pra evento de outro dono → 404 NOT_FOUND", async () => {
		const hostJar = await signupAndJar("up-realowner@example.com");
		const intruderJar = await signupAndJar("up-intruder@example.com");
		const { slug } = await createActiveEvent(hostJar, adminJar);

		const res = await app.request(
			imagePost(`/api/events/${slug}/photos${QS}`, intruderJar, JPEG_BYTES),
			{},
			env,
		);
		expect(res.status).toBe(404);
		expect((await res.json()) as { error: string }).toEqual({ error: "NOT_FOUND" });
	});

	it("upload pra evento Inativo → 400 INVALID_STATE", async () => {
		const hostJar = await signupAndJar("up-inactive@example.com");
		const created = await createEvent(hostJar); // NÃO ativa → Inativo.

		const res = await app.request(
			imagePost(`/api/events/${created.slug}/photos${QS}`, hostJar, JPEG_BYTES),
			{},
			env,
		);
		expect(res.status).toBe(400);
		expect((await res.json()) as { error: string }).toEqual({ error: "INVALID_STATE" });
	});

	it("GET /file de foto inexistente → 404 NOT_FOUND", async () => {
		const hostJar = await signupAndJar("up-getmissing@example.com");
		const { slug } = await createActiveEvent(hostJar, adminJar);

		const res = await app.request(
			new Request(`http://localhost/api/events/${slug}/photos/${crypto.randomUUID()}/file`),
			{},
			env,
		);
		expect(res.status).toBe(404);
	});
});
