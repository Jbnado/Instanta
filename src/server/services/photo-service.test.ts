import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDB } from "../db/client";
import { eventPhotos, events } from "../db/schema";
import type { Storage, StorageObject } from "../adapters/r2-storage";
import { createAuthService } from "./auth-service";
import { createEventService } from "./event-service";
import {
	InvalidEventStateError,
	EventNotFoundError,
} from "./event-service";
import {
	InvalidImageError,
	StorageCapExceededError,
	createPhotoService,
	type PhotoService,
} from "./photo-service";

const TEST_JWT_SECRET = "test-secret-aaaa-bbbb-cccc-dddd-eeee-ffff-32-bytes";

// ── Bytes de imagem ───────────────────────────────────────────────────────────
// JPEG real: SOI (FF D8) + APP0/JFIF (FF E0 ... "JFIF\0") — file-type reconhece.
const JPEG_BYTES = new Uint8Array([
	0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
	0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
]);
// SVG é XML (texto) — file-type detecta como image/svg+xml (não permitido) ou nada.
const SVG_BYTES = new TextEncoder().encode(
	'<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
);
// Texto puro — file-type não reconhece formato → undefined.
const TEXT_BYTES = new TextEncoder().encode("isto não é uma imagem de verdade");

interface FakeStorage extends Storage {
	putKeys: string[];
	deletedKeys: string[];
	objects: Map<string, { bytes: Uint8Array; contentType: string }>;
}

// Fake adapter de R2 que captura puts/deletes e guarda os objetos in-memory.
function makeFakeStorage(): FakeStorage {
	const putKeys: string[] = [];
	const deletedKeys: string[] = [];
	const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
	return {
		putKeys,
		deletedKeys,
		objects,
		keyFor(eventId, imageId) {
			return `events/${eventId}/${imageId}`;
		},
		async put(key, bytes, contentType) {
			putKeys.push(key);
			objects.set(key, { bytes, contentType });
		},
		async get(key): Promise<StorageObject | null> {
			const obj = objects.get(key);
			if (!obj) return null;
			return {
				body: new Response(obj.bytes).body!,
				contentType: obj.contentType,
				size: obj.bytes.byteLength,
			};
		},
		async delete(key) {
			deletedKeys.push(key);
			objects.delete(key);
		},
	};
}

async function makeHost(
	db: ReturnType<typeof getDB>,
	email: string,
): Promise<string> {
	const auth = createAuthService({ db, jwtSecret: TEST_JWT_SECRET });
	const result = await auth.signup({
		email,
		password: "senha123abc",
		displayName: "Host",
		termsAccepted: true,
	});
	return result.user.id;
}

// Cria um evento e o deixa Ativo (ativação admin). Retorna { slug, id }.
async function makeActiveEvent(
	db: ReturnType<typeof getDB>,
	hostId: string,
	cap?: number,
): Promise<{ slug: string; id: string }> {
	const eventService = createEventService({ db });
	const created = await eventService.createEvent({
		hostUserId: hostId,
		input: {
			name: "Festa",
			eventDate: new Date("2026-07-15T20:00:00Z"),
			description: undefined,
			colorAccent: "#A855F7",
			presetMissionIds: [],
			customMissions: [],
		},
	});
	await eventService.activateEvent(created.slug);
	if (cap !== undefined) {
		await db.update(events).set({ cap }).where(eq(events.id, created.id));
	}
	return { slug: created.slug, id: created.id };
}

describe("photo-service", () => {
	let db: ReturnType<typeof getDB>;
	let storage: ReturnType<typeof makeFakeStorage>;
	let service: PhotoService;

	beforeEach(() => {
		db = getDB(env);
		storage = makeFakeStorage();
		service = createPhotoService({ db, storage });
	});

	describe("uploadPhoto — validação (Story 6.5)", () => {
		it("JPEG válido → insere event_photos + put no R2 + bump de bytesUsed", async () => {
			const hostId = await makeHost(db, "up-jpeg@example.com");
			const { slug, id } = await makeActiveEvent(db, hostId);

			const res = await service.uploadPhoto({
				eventSlug: slug,
				uploaderUserId: hostId,
				bytes: JPEG_BYTES,
				width: 4000,
				height: 3000,
			});

			expect(res.id).toBeTruthy();
			expect(res.storageKey).toBe(`events/${id}/${res.id}`);
			expect(storage.putKeys).toEqual([res.storageKey]);

			const [photo] = await db
				.select()
				.from(eventPhotos)
				.where(eq(eventPhotos.id, res.id));
			expect(photo).toBeDefined();
			expect(photo!.cfImageId).toBe(res.storageKey);
			expect(photo!.sizeBytes).toBe(JPEG_BYTES.byteLength);
			expect(photo!.eventId).toBe(id);
			expect(photo!.uploaderUserId).toBe(hostId);
			expect(photo!.telaoVisible).toBe(true);

			const [ev] = await db.select().from(events).where(eq(events.id, id));
			expect(ev!.bytesUsed).toBe(JPEG_BYTES.byteLength);
		});

		it("bytes SVG → InvalidImageError (nada gravado no R2)", async () => {
			const hostId = await makeHost(db, "up-svg@example.com");
			const { slug } = await makeActiveEvent(db, hostId);

			await expect(
				service.uploadPhoto({
					eventSlug: slug,
					uploaderUserId: hostId,
					bytes: SVG_BYTES,
					width: 100,
					height: 100,
				}),
			).rejects.toBeInstanceOf(InvalidImageError);
			expect(storage.putKeys).toHaveLength(0);
		});

		it("texto puro (não-imagem) → InvalidImageError", async () => {
			const hostId = await makeHost(db, "up-text@example.com");
			const { slug } = await makeActiveEvent(db, hostId);

			await expect(
				service.uploadPhoto({
					eventSlug: slug,
					uploaderUserId: hostId,
					bytes: TEXT_BYTES,
					width: 100,
					height: 100,
				}),
			).rejects.toBeInstanceOf(InvalidImageError);
		});

		it("dimensões > 12k px → InvalidImageError", async () => {
			const hostId = await makeHost(db, "up-dim@example.com");
			const { slug } = await makeActiveEvent(db, hostId);

			await expect(
				service.uploadPhoto({
					eventSlug: slug,
					uploaderUserId: hostId,
					bytes: JPEG_BYTES,
					width: 13_000,
					height: 100,
				}),
			).rejects.toBeInstanceOf(InvalidImageError);
		});

		it("evento não Ativo (Inativo) → InvalidEventStateError", async () => {
			const hostId = await makeHost(db, "up-inactive@example.com");
			const eventService = createEventService({ db });
			const created = await eventService.createEvent({
				hostUserId: hostId,
				input: {
					name: "Festa",
					eventDate: new Date("2026-07-15T20:00:00Z"),
					description: undefined,
					colorAccent: "#A855F7",
					presetMissionIds: [],
					customMissions: [],
				},
			});
			await expect(
				service.uploadPhoto({
					eventSlug: created.slug,
					uploaderUserId: hostId,
					bytes: JPEG_BYTES,
					width: 100,
					height: 100,
				}),
			).rejects.toBeInstanceOf(InvalidEventStateError);
		});

		it("uploader não-host → EventNotFoundError (não revela posse)", async () => {
			const hostId = await makeHost(db, "up-owner@example.com");
			const intruderId = await makeHost(db, "up-intruder@example.com");
			const { slug } = await makeActiveEvent(db, hostId);

			await expect(
				service.uploadPhoto({
					eventSlug: slug,
					uploaderUserId: intruderId,
					bytes: JPEG_BYTES,
					width: 100,
					height: 100,
				}),
			).rejects.toBeInstanceOf(EventNotFoundError);
		});
	});

	describe("uploadPhoto — cap atomic (Story 6.6, R-001)", () => {
		it("cap já cheio → StorageCapExceededError + nenhuma row + nada no R2", async () => {
			const hostId = await makeHost(db, "up-cap@example.com");
			const { slug, id } = await makeActiveEvent(db, hostId, 25);
			// cap=25; JPEG_BYTES tem 20 bytes. usado=10 → 10+20=30 > 25 estoura.
			await db.update(events).set({ bytesUsed: 10 }).where(eq(events.id, id));

			await expect(
				service.uploadPhoto({
					eventSlug: slug,
					uploaderUserId: hostId,
					bytes: JPEG_BYTES,
					width: 100,
					height: 100,
				}),
			).rejects.toBeInstanceOf(StorageCapExceededError);

			// Cap estourou ANTES do put → nada gravado no R2, nenhuma row, bytesUsed intacto.
			expect(storage.putKeys).toHaveLength(0);
			const photos = await db
				.select()
				.from(eventPhotos)
				.where(eq(eventPhotos.eventId, id));
			expect(photos).toHaveLength(0);
			const [ev] = await db.select().from(events).where(eq(events.id, id));
			expect(ev!.bytesUsed).toBe(10);
		});

		it("R-001: Promise.all de N uploads perto do cap → só os que cabem vencem; bytesUsed nunca passa do cap", async () => {
			const hostId = await makeHost(db, "up-race@example.com");
			// JPEG_BYTES = 20 bytes. cap=60 → cabem 3 (3*20=60 ≤ 60), os outros estouram.
			const { slug, id } = await makeActiveEvent(db, hostId, 60);
			const N = 6;

			const results = await Promise.allSettled(
				Array.from({ length: N }, () =>
					service.uploadPhoto({
						eventSlug: slug,
						uploaderUserId: hostId,
						bytes: JPEG_BYTES,
						width: 100,
						height: 100,
					}),
				),
			);

			const fulfilled = results.filter((r) => r.status === "fulfilled");
			const rejected = results.filter((r) => r.status === "rejected");

			expect(fulfilled).toHaveLength(3);
			expect(rejected).toHaveLength(3);
			for (const r of rejected) {
				expect((r as PromiseRejectedResult).reason).toBeInstanceOf(
					StorageCapExceededError,
				);
			}

			// bytesUsed final = 60 (nunca passa do cap 60).
			const [ev] = await db.select().from(events).where(eq(events.id, id));
			expect(ev!.bytesUsed).toBe(60);
			expect(ev!.bytesUsed).toBeLessThanOrEqual(ev!.cap);

			// Só 3 rows de foto persistiram (as que estouraram não inseriram).
			const photos = await db
				.select()
				.from(eventPhotos)
				.where(eq(eventPhotos.eventId, id));
			expect(photos).toHaveLength(3);

			// Só 3 puts no R2 (os que estouraram nunca chegaram ao put).
			expect(storage.putKeys).toHaveLength(3);
		});
	});

	describe("getPhotoFile — serving (R2)", () => {
		it("foto existente → devolve o objeto do R2", async () => {
			const hostId = await makeHost(db, "get-ok@example.com");
			const { slug } = await makeActiveEvent(db, hostId);
			const up = await service.uploadPhoto({
				eventSlug: slug,
				uploaderUserId: hostId,
				bytes: JPEG_BYTES,
				width: 100,
				height: 100,
			});

			const obj = await service.getPhotoFile({ eventSlug: slug, photoId: up.id });
			expect(obj).not.toBeNull();
			expect(obj!.contentType).toBe("image/jpeg");
			expect(obj!.size).toBe(JPEG_BYTES.byteLength);
		});

		it("photoId inexistente → null", async () => {
			const hostId = await makeHost(db, "get-missing@example.com");
			const { slug } = await makeActiveEvent(db, hostId);
			const obj = await service.getPhotoFile({
				eventSlug: slug,
				photoId: crypto.randomUUID(),
			});
			expect(obj).toBeNull();
		});

		it("photoId de OUTRO evento → null (anti-IDOR cross-event)", async () => {
			const hostA = await makeHost(db, "get-a@example.com");
			const hostB = await makeHost(db, "get-b@example.com");
			const evA = await makeActiveEvent(db, hostA);
			const evB = await makeActiveEvent(db, hostB);
			const up = await service.uploadPhoto({
				eventSlug: evA.slug,
				uploaderUserId: hostA,
				bytes: JPEG_BYTES,
				width: 100,
				height: 100,
			});

			// Pede a foto de A usando o slug de B → não casa o innerJoin → null.
			const obj = await service.getPhotoFile({
				eventSlug: evB.slug,
				photoId: up.id,
			});
			expect(obj).toBeNull();
		});
	});
});
