import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDB } from "../db/client";
import { eventPhotos, events } from "../db/schema";
import type { CfImages } from "../adapters/cf-images";
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

// ── Amostras de cabeçalho ────────────────────────────────────────────────────
// JPEG real: SOI (FF D8) + APP0/JFIF (FF E0 ... "JFIF\0") — file-type reconhece.
const JPEG_HEADER = new Uint8Array([
	0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
	0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
]);
// SVG é XML (texto) — file-type detecta como image/svg+xml (não permitido) ou nada.
const SVG_BYTES = new TextEncoder().encode(
	'<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
);
// Texto puro — file-type não reconhece formato → undefined.
const TEXT_BYTES = new TextEncoder().encode("isto não é uma imagem de verdade");

interface FakeImages extends CfImages {
	createdIds: string[];
	deletedIds: string[];
}

// Fake adapter de CF Images que captura chamadas (createSignedUploadURL + delete).
function makeFakeImages(): FakeImages {
	const createdIds: string[] = [];
	const deletedIds: string[] = [];
	return {
		createdIds,
		deletedIds,
		async createSignedUploadURL() {
			const imageId = crypto.randomUUID();
			createdIds.push(imageId);
			return { imageId, uploadUrl: `https://upload.test/${imageId}` };
		},
		async delete(imageId: string) {
			deletedIds.push(imageId);
		},
		deliveryUrl(imageId, variant) {
			return `https://imagedelivery.net/test/${imageId}/${variant}`;
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
			password: "festa2026",
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
	let images: ReturnType<typeof makeFakeImages>;
	let service: PhotoService;

	beforeEach(() => {
		db = getDB(env);
		images = makeFakeImages();
		service = createPhotoService({ db, images });
	});

	describe("requestUpload", () => {
		it("amostra JPEG válida → devolve uploadUrl + imageId", async () => {
			const hostId = await makeHost(db, "req-jpeg@example.com");
			const { slug } = await makeActiveEvent(db, hostId);

			const res = await service.requestUpload({
				eventSlug: slug,
				uploaderUserId: hostId,
				headerSample: JPEG_HEADER,
				sizeBytes: 1_000_000,
				width: 4000,
				height: 3000,
			});

			expect(res.imageId).toBeTruthy();
			expect(res.uploadUrl).toContain(res.imageId);
			expect(images.createdIds).toHaveLength(1);
		});

		it("amostra SVG → InvalidImageError (não emite URL)", async () => {
			const hostId = await makeHost(db, "req-svg@example.com");
			const { slug } = await makeActiveEvent(db, hostId);

			await expect(
				service.requestUpload({
					eventSlug: slug,
					uploaderUserId: hostId,
					headerSample: SVG_BYTES,
					sizeBytes: 1000,
					width: 100,
					height: 100,
				}),
			).rejects.toBeInstanceOf(InvalidImageError);
			expect(images.createdIds).toHaveLength(0);
		});

		it("texto puro (não-imagem) → InvalidImageError", async () => {
			const hostId = await makeHost(db, "req-text@example.com");
			const { slug } = await makeActiveEvent(db, hostId);

			await expect(
				service.requestUpload({
					eventSlug: slug,
					uploaderUserId: hostId,
					headerSample: TEXT_BYTES,
					sizeBytes: 1000,
					width: 100,
					height: 100,
				}),
			).rejects.toBeInstanceOf(InvalidImageError);
		});

		it("tamanho > 20MB → InvalidImageError", async () => {
			const hostId = await makeHost(db, "req-big@example.com");
			const { slug } = await makeActiveEvent(db, hostId);

			await expect(
				service.requestUpload({
					eventSlug: slug,
					uploaderUserId: hostId,
					headerSample: JPEG_HEADER,
					sizeBytes: 21 * 1024 * 1024,
					width: 4000,
					height: 3000,
				}),
			).rejects.toBeInstanceOf(InvalidImageError);
		});

		it("dimensões > 12k px → InvalidImageError", async () => {
			const hostId = await makeHost(db, "req-dim@example.com");
			const { slug } = await makeActiveEvent(db, hostId);

			await expect(
				service.requestUpload({
					eventSlug: slug,
					uploaderUserId: hostId,
					headerSample: JPEG_HEADER,
					sizeBytes: 1000,
					width: 13_000,
					height: 100,
				}),
			).rejects.toBeInstanceOf(InvalidImageError);
		});

		it("evento não Ativo (Inativo) → InvalidEventStateError", async () => {
			const hostId = await makeHost(db, "req-inactive@example.com");
			const eventService = createEventService({ db });
			const created = await eventService.createEvent({
				hostUserId: hostId,
				input: {
					name: "Festa",
					eventDate: new Date("2026-07-15T20:00:00Z"),
					description: undefined,
					password: "festa2026",
					colorAccent: "#A855F7",
					presetMissionIds: [],
					customMissions: [],
				},
			});
			// NÃO ativa → continua Inativo.
			await expect(
				service.requestUpload({
					eventSlug: created.slug,
					uploaderUserId: hostId,
					headerSample: JPEG_HEADER,
					sizeBytes: 1000,
					width: 100,
					height: 100,
				}),
			).rejects.toBeInstanceOf(InvalidEventStateError);
		});

		it("uploader não-host → EventNotFoundError (não revela posse)", async () => {
			const hostId = await makeHost(db, "req-owner@example.com");
			const intruderId = await makeHost(db, "req-intruder@example.com");
			const { slug } = await makeActiveEvent(db, hostId);

			await expect(
				service.requestUpload({
					eventSlug: slug,
					uploaderUserId: intruderId,
					headerSample: JPEG_HEADER,
					sizeBytes: 1000,
					width: 100,
					height: 100,
				}),
			).rejects.toBeInstanceOf(EventNotFoundError);
		});

		it("cap pré-check: já cheio → StorageCapExceededError", async () => {
			const hostId = await makeHost(db, "req-cap@example.com");
			const { slug, id } = await makeActiveEvent(db, hostId, 1000);
			// Seta bytesUsed perto do cap (cap=1000, usado=900, novo=200 → estoura).
			await db.update(events).set({ bytesUsed: 900 }).where(eq(events.id, id));

			await expect(
				service.requestUpload({
					eventSlug: slug,
					uploaderUserId: hostId,
					headerSample: JPEG_HEADER,
					sizeBytes: 200,
					width: 100,
					height: 100,
				}),
			).rejects.toBeInstanceOf(StorageCapExceededError);
		});
	});

	describe("confirmUpload", () => {
		it("insere event_photos + bump de bytesUsed", async () => {
			const hostId = await makeHost(db, "conf-ok@example.com");
			const { slug, id } = await makeActiveEvent(db, hostId);

			const res = await service.confirmUpload({
				eventSlug: slug,
				uploaderUserId: hostId,
				imageId: "img-abc",
				sizeBytes: 500_000,
			});

			expect(res.id).toBeTruthy();
			expect(res.cfImageId).toBe("img-abc");

			const [photo] = await db
				.select()
				.from(eventPhotos)
				.where(eq(eventPhotos.id, res.id));
			expect(photo).toBeDefined();
			expect(photo!.cfImageId).toBe("img-abc");
			expect(photo!.sizeBytes).toBe(500_000);
			expect(photo!.eventId).toBe(id);
			expect(photo!.uploaderUserId).toBe(hostId);
			expect(photo!.telaoVisible).toBe(true);

			const [ev] = await db.select().from(events).where(eq(events.id, id));
			expect(ev!.bytesUsed).toBe(500_000);
		});

		it("R-001: Promise.all de N confirms perto do cap → só os que cabem vencem; bytesUsed nunca passa do cap", async () => {
			const hostId = await makeHost(db, "conf-race@example.com");
			// cap=1000; cada upload=300 → cabem 3 (900 ≤ 1000), o 4º estouraria.
			const { slug, id } = await makeActiveEvent(db, hostId, 1000);
			const SIZE = 300;
			const N = 6;

			const results = await Promise.allSettled(
				Array.from({ length: N }, (_, i) =>
					service.confirmUpload({
						eventSlug: slug,
						uploaderUserId: hostId,
						imageId: `img-race-${i}`,
						sizeBytes: SIZE,
					}),
				),
			);

			const fulfilled = results.filter((r) => r.status === "fulfilled");
			const rejected = results.filter((r) => r.status === "rejected");

			// Exatamente 3 cabem (3*300=900 ≤ 1000); os outros 3 estouram.
			expect(fulfilled).toHaveLength(3);
			expect(rejected).toHaveLength(3);
			for (const r of rejected) {
				expect((r as PromiseRejectedResult).reason).toBeInstanceOf(
					StorageCapExceededError,
				);
			}

			// bytesUsed final = 900 (nunca passa do cap 1000).
			const [ev] = await db.select().from(events).where(eq(events.id, id));
			expect(ev!.bytesUsed).toBe(900);
			expect(ev!.bytesUsed).toBeLessThanOrEqual(ev!.cap);

			// Só 3 rows de foto persistiram (as que estouraram foram limpas).
			const photos = await db
				.select()
				.from(eventPhotos)
				.where(eq(eventPhotos.eventId, id));
			expect(photos).toHaveLength(3);

			// Cleanup de órfã: images.delete chamado pros 3 que falharam.
			expect(images.deletedIds).toHaveLength(3);
		});

		it("cap estoura → StorageCapExceededError + images.delete (cleanup órfã) + nenhuma row", async () => {
			const hostId = await makeHost(db, "conf-cap@example.com");
			const { slug, id } = await makeActiveEvent(db, hostId, 1000);
			await db.update(events).set({ bytesUsed: 900 }).where(eq(events.id, id));

			await expect(
				service.confirmUpload({
					eventSlug: slug,
					uploaderUserId: hostId,
					imageId: "img-orphan",
					sizeBytes: 200, // 900+200=1100 > 1000.
				}),
			).rejects.toBeInstanceOf(StorageCapExceededError);

			expect(images.deletedIds).toContain("img-orphan");

			const photos = await db
				.select()
				.from(eventPhotos)
				.where(eq(eventPhotos.eventId, id));
			expect(photos).toHaveLength(0);

			// bytesUsed inalterado.
			const [ev] = await db.select().from(events).where(eq(events.id, id));
			expect(ev!.bytesUsed).toBe(900);
		});
	});
});
