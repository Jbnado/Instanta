import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDB } from "../db/client";
import { eventMissions, events } from "../db/schema";
import { createAuthService } from "./auth-service";
import {
	ActiveEventLimitError,
	createEventService,
	type EventService,
} from "./event-service";
import type { CreateEventInput } from "../../lib/shared/schemas/event";

const TEST_JWT_SECRET = "test-secret-aaaa-bbbb-cccc-dddd-eeee-ffff-32-bytes";

// Cria um host real via auth-service.signup e devolve o id.
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

function baseInput(overrides: Partial<CreateEventInput> = {}): CreateEventInput {
	return {
		name: "Festa da Ana",
		eventDate: new Date("2026-07-15T20:00:00Z"),
		description: "Aniversário de 30 anos",
		password: "festa2026",
		colorAccent: "#A855F7",
		presetMissionIds: [],
		customMissions: [],
		...overrides,
	};
}

describe("event-service", () => {
	let db: ReturnType<typeof getDB>;
	let service: EventService;

	beforeEach(() => {
		db = getDB(env);
		service = createEventService({ db });
	});

	describe("createEvent", () => {
		it("persiste o evento com defaults da Story 3.1", async () => {
			const hostId = await makeHost(db, "host-persist@example.com");
			const result = await service.createEvent({
				hostUserId: hostId,
				input: baseInput(),
			});

			expect(result.id).toBeTruthy();
			expect(result.slug).toBeTruthy();
			expect(result.status).toBe("Inativo");
			expect(result.colorAccent).toBe("#A855F7");
			expect(result.name).toBe("Festa da Ana");

			const [row] = await db.select().from(events).where(eq(events.id, result.id));
			expect(row).toBeDefined();
			expect(row!.status).toBe("Inativo");
			expect(row!.slug).toBe(result.slug);
			expect(row!.slug.length).toBeGreaterThanOrEqual(8);
			expect(row!.cap).toBe(10_737_418_240);
			expect(row!.bytesUsed).toBe(0);
			expect(row!.hostUserId).toBe(hostId);
			expect(row!.passwordHash).toMatch(/^\$argon2id\$/);
			expect(row!.eventDate).toBeInstanceOf(Date);
			expect(row!.eventDate.getTime()).toBe(
				new Date("2026-07-15T20:00:00Z").getTime(),
			);
			expect(row!.description).toBe("Aniversário de 30 anos");
		});

		it("persiste description null quando omitida", async () => {
			const hostId = await makeHost(db, "host-nodesc@example.com");
			const result = await service.createEvent({
				hostUserId: hostId,
				input: baseInput({ description: undefined }),
			});
			const [row] = await db.select().from(events).where(eq(events.id, result.id));
			expect(row!.description).toBeNull();
		});

		it("insere missões preset (isPreset=true, label resolvido) + customs (isPreset=false)", async () => {
			const hostId = await makeHost(db, "host-missions@example.com");
			const result = await service.createEvent({
				hostUserId: hostId,
				input: baseInput({
					presetMissionIds: ["selfie-anfitriao", "brinde"],
					customMissions: ["Foto com o bolo gigante", "Dança do pinguim"],
				}),
			});

			const rows = await db
				.select()
				.from(eventMissions)
				.where(eq(eventMissions.eventId, result.id));
			expect(rows).toHaveLength(4);

			const presets = rows.filter((r) => r.isPreset);
			const customs = rows.filter((r) => !r.isPreset);
			expect(presets).toHaveLength(2);
			expect(customs).toHaveLength(2);

			const presetLabels = presets.map((r) => r.label).sort();
			expect(presetLabels).toEqual(
				["Hora do brinde 🥂", "Selfie com o anfitrião"].sort(),
			);

			const customLabels = customs.map((r) => r.label).sort();
			expect(customLabels).toEqual(
				["Dança do pinguim", "Foto com o bolo gigante"].sort(),
			);
		});

		it("não insere missões quando nenhuma é selecionada", async () => {
			const hostId = await makeHost(db, "host-nomission@example.com");
			const result = await service.createEvent({
				hostUserId: hostId,
				input: baseInput(),
			});
			const rows = await db
				.select()
				.from(eventMissions)
				.where(eq(eventMissions.eventId, result.id));
			expect(rows).toHaveLength(0);
		});

		it("gera slugs random distintos e NÃO derivados do nome (R-019)", async () => {
			const hostId = await makeHost(db, "host-slug@example.com");
			const a = await service.createEvent({
				hostUserId: hostId,
				input: baseInput({ name: "Festa Idêntica" }),
			});
			const b = await service.createEvent({
				hostUserId: hostId,
				input: baseInput({ name: "Festa Idêntica" }),
			});
			// Mesmo nome → slugs diferentes (não derivados do nome).
			expect(a.slug).not.toBe(b.slug);
			// Slug não contém o nome normalizado.
			expect(a.slug.toLowerCase()).not.toContain("festa");
			expect(b.slug.toLowerCase()).not.toContain("identica");
		});

		it("4º evento não-Encerrado → ActiveEventLimitError", async () => {
			const hostId = await makeHost(db, "host-limit@example.com");
			for (let i = 0; i < 3; i++) {
				await service.createEvent({
					hostUserId: hostId,
					input: baseInput({ name: `Evento ${i}` }),
				});
			}
			await expect(
				service.createEvent({ hostUserId: hostId, input: baseInput({ name: "Quarto" }) }),
			).rejects.toBeInstanceOf(ActiveEventLimitError);
		});

		it("evento Encerrado NÃO conta pro limite — 4º criável após encerrar 1", async () => {
			const hostId = await makeHost(db, "host-encerrado@example.com");
			const first = await service.createEvent({
				hostUserId: hostId,
				input: baseInput({ name: "Será encerrado" }),
			});
			await service.createEvent({ hostUserId: hostId, input: baseInput({ name: "B" }) });
			await service.createEvent({ hostUserId: hostId, input: baseInput({ name: "C" }) });

			// Encerra o primeiro → libera 1 slot.
			await db
				.update(events)
				.set({ status: "Encerrado" })
				.where(eq(events.id, first.id));

			const fourth = await service.createEvent({
				hostUserId: hostId,
				input: baseInput({ name: "Novo permitido" }),
			});
			expect(fourth.id).toBeTruthy();
		});
	});
});
