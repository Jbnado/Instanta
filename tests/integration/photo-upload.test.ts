import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import app from "../../src/server/app";
import { getDB } from "../../src/server/db/client";
import { eventPhotos, events } from "../../src/server/db/schema";

// Integration end-to-end do pipeline de upload (Epic 6, Stories 6.5-6.7) no workerd real:
// emite URL assinada (validando magic bytes) → confirma (cap atomic + insert event_photos).
// Espelha o setup de auth/cookie + ativação admin de event-lifecycle.test.ts.

const ORIGIN = "http://localhost:5173";
const ADMIN_EMAIL = "admin@instanta.test";

// JPEG real (SOI + APP0/JFIF) em base64 — file-type reconhece como image/jpeg.
const JPEG_HEADER_B64 = btoa(
	String.fromCharCode(
		0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
		0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
	),
);
// Texto puro em base64 — não é imagem reconhecível.
const TEXT_B64 = btoa("isto definitivamente não é uma imagem");

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

function uploadUrlBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		headerSample: JPEG_HEADER_B64,
		sizeBytes: 1_000_000,
		width: 4000,
		height: 3000,
		...overrides,
	};
}

describe("photo upload pipeline (Epic 6, Stories 6.5-6.7)", () => {
	let adminJar: Record<string, string>;

	beforeAll(async () => {
		getDB(env);
		adminJar = await signupAndJar(ADMIN_EMAIL);
	});

	it("happy path: upload-url (JPEG) → 200 → confirm → 201 + row + bytesUsed bump", async () => {
		const hostJar = await signupAndJar("up-happy@example.com");
		const { id, slug } = await createActiveEvent(hostJar, adminJar);

		const urlRes = await app.request(
			jsonPost(`/api/events/${slug}/upload-url`, hostJar, uploadUrlBody()),
			{},
			env,
		);
		expect(urlRes.status).toBe(200);
		const urlJson = (await urlRes.json()) as { uploadUrl: string; imageId: string };
		expect(urlJson.uploadUrl).toBeTruthy();
		expect(urlJson.imageId).toBeTruthy();

		const confirmRes = await app.request(
			jsonPost(`/api/events/${slug}/photos`, hostJar, {
				imageId: urlJson.imageId,
				sizeBytes: 1_000_000,
			}),
			{},
			env,
		);
		expect(confirmRes.status).toBe(201);
		const confirmJson = (await confirmRes.json()) as {
			photo: { id: string; cfImageId: string; createdAt: string };
		};
		expect(confirmJson.photo.cfImageId).toBe(urlJson.imageId);

		const db = getDB(env);
		const [photo] = await db
			.select()
			.from(eventPhotos)
			.where(eq(eventPhotos.id, confirmJson.photo.id));
		expect(photo).toBeDefined();
		expect(photo!.sizeBytes).toBe(1_000_000);

		const [ev] = await db.select().from(events).where(eq(events.id, id));
		expect(ev!.bytesUsed).toBe(1_000_000);
	});

	it("upload-url com não-imagem → 415 INVALID_IMAGE", async () => {
		const hostJar = await signupAndJar("up-badtype@example.com");
		const { slug } = await createActiveEvent(hostJar, adminJar);

		const res = await app.request(
			jsonPost(
				`/api/events/${slug}/upload-url`,
				hostJar,
				uploadUrlBody({ headerSample: TEXT_B64 }),
			),
			{},
			env,
		);
		expect(res.status).toBe(415);
		expect((await res.json()) as { error: string }).toEqual({ error: "INVALID_IMAGE" });
	});

	it("confirm com cap estourado → 409 CAP_EXCEEDED", async () => {
		const hostJar = await signupAndJar("up-cap@example.com");
		const { id, slug } = await createActiveEvent(hostJar, adminJar);

		// Aperta o cap: cap=1000, usado=900 → upload de 200 estoura.
		const db = getDB(env);
		await db.update(events).set({ cap: 1000, bytesUsed: 900 }).where(eq(events.id, id));

		const res = await app.request(
			jsonPost(`/api/events/${slug}/photos`, hostJar, {
				imageId: "img-cap-int",
				sizeBytes: 200,
			}),
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
			jsonPost(`/api/events/${slug}/upload-url`, {}, uploadUrlBody()),
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
			jsonPost(`/api/events/${slug}/upload-url`, intruderJar, uploadUrlBody()),
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
			jsonPost(`/api/events/${created.slug}/upload-url`, hostJar, uploadUrlBody()),
			{},
			env,
		);
		expect(res.status).toBe(400);
		expect((await res.json()) as { error: string }).toEqual({ error: "INVALID_STATE" });
	});
});
