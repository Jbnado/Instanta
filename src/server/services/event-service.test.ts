import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDB } from "../db/client";
import { eventMissions, events } from "../db/schema";
import { createAuthService } from "./auth-service";
import {
	ActiveEventLimitError,
	EventNotFoundError,
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

	// ========================================================================
	// Story 3.3 — listEventsForHost
	// ========================================================================
	describe("listEventsForHost", () => {
		it("retorna só os eventos do anfitrião, ordenados por data", async () => {
			const hostId = await makeHost(db, "list-owner@example.com");
			const otherId = await makeHost(db, "list-other@example.com");

			// Cria fora de ordem pra validar o orderBy.
			await service.createEvent({
				hostUserId: hostId,
				input: baseInput({ name: "Julho", eventDate: new Date("2026-07-15T20:00:00Z") }),
			});
			await service.createEvent({
				hostUserId: hostId,
				input: baseInput({ name: "Maio", eventDate: new Date("2026-05-01T20:00:00Z") }),
			});
			// Evento de OUTRO host — não deve aparecer.
			await service.createEvent({
				hostUserId: otherId,
				input: baseInput({ name: "De outro" }),
			});

			const list = await service.listEventsForHost(hostId);
			expect(list).toHaveLength(2);
			expect(list.map((e) => e.name)).toEqual(["Maio", "Julho"]);
			expect(list.every((e) => typeof e.eventDate === "string")).toBe(true);
			expect(list.some((e) => e.name === "De outro")).toBe(false);
		});

		it("retorna lista vazia quando o anfitrião não tem eventos", async () => {
			const hostId = await makeHost(db, "list-empty@example.com");
			expect(await service.listEventsForHost(hostId)).toEqual([]);
		});
	});

	// ========================================================================
	// Story 3.2 — getEventForHost
	// ========================================================================
	describe("getEventForHost", () => {
		it("retorna evento + missões pro dono", async () => {
			const hostId = await makeHost(db, "get-owner@example.com");
			const created = await service.createEvent({
				hostUserId: hostId,
				input: baseInput({
					presetMissionIds: ["brinde"],
					customMissions: ["Foto custom"],
				}),
			});

			const detail = await service.getEventForHost(created.slug, hostId);
			expect(detail).not.toBeNull();
			expect(detail!.id).toBe(created.id);
			expect(detail!.slug).toBe(created.slug);
			expect(typeof detail!.eventDate).toBe("string");
			expect(detail!.missions).toHaveLength(2);
			expect(detail!.missions.some((m) => m.isPreset && m.label === "Hora do brinde 🥂")).toBe(true);
			expect(detail!.missions.some((m) => !m.isPreset && m.label === "Foto custom")).toBe(true);
		});

		it("retorna null pra evento de outro anfitrião (não vaza posse)", async () => {
			const hostId = await makeHost(db, "get-owner2@example.com");
			const otherId = await makeHost(db, "get-other2@example.com");
			const created = await service.createEvent({
				hostUserId: hostId,
				input: baseInput(),
			});
			expect(await service.getEventForHost(created.slug, otherId)).toBeNull();
		});

		it("retorna null pra slug inexistente", async () => {
			const hostId = await makeHost(db, "get-missing@example.com");
			expect(await service.getEventForHost("nao-existe-xyz", hostId)).toBeNull();
		});
	});

	// ========================================================================
	// Story 3.2 — updateEvent
	// ========================================================================
	describe("updateEvent", () => {
		it("altera name/colorAccent/eventDate/description", async () => {
			const hostId = await makeHost(db, "upd-fields@example.com");
			const created = await service.createEvent({
				hostUserId: hostId,
				input: baseInput(),
			});

			const detail = await service.updateEvent(created.slug, hostId, {
				name: "Festa Renomeada",
				colorAccent: "#22C55E",
				eventDate: new Date("2026-08-20T18:00:00Z"),
				description: "Nova descrição",
			});

			expect(detail.name).toBe("Festa Renomeada");
			expect(detail.colorAccent).toBe("#22C55E");
			expect(detail.eventDate).toBe(new Date("2026-08-20T18:00:00Z").toISOString());
			expect(detail.description).toBe("Nova descrição");

			const [row] = await db.select().from(events).where(eq(events.id, created.id));
			expect(row!.name).toBe("Festa Renomeada");
			expect(row!.colorAccent).toBe("#22C55E");
		});

		it("com password rotaciona o passwordHash (novo $argon2id$, diferente do antigo)", async () => {
			const hostId = await makeHost(db, "upd-pwd@example.com");
			const created = await service.createEvent({
				hostUserId: hostId,
				input: baseInput(),
			});
			const [before] = await db.select().from(events).where(eq(events.id, created.id));

			await service.updateEvent(created.slug, hostId, { password: "novasenha456" });

			const [after] = await db.select().from(events).where(eq(events.id, created.id));
			expect(after!.passwordHash).toMatch(/^\$argon2id\$/);
			expect(after!.passwordHash).not.toBe(before!.passwordHash);
		});

		it("substitui o conjunto de missões (antigas somem, novas com isPreset correto)", async () => {
			const hostId = await makeHost(db, "upd-missions@example.com");
			const created = await service.createEvent({
				hostUserId: hostId,
				input: baseInput({
					presetMissionIds: ["selfie-anfitriao"],
					customMissions: ["Antiga"],
				}),
			});

			await service.updateEvent(created.slug, hostId, {
				presetMissionIds: ["brinde"],
				customMissions: ["Nova custom"],
			});

			const rows = await db
				.select()
				.from(eventMissions)
				.where(eq(eventMissions.eventId, created.id));
			expect(rows).toHaveLength(2);
			const labels = rows.map((r) => r.label).sort();
			expect(labels).toEqual(["Hora do brinde 🥂", "Nova custom"].sort());
			expect(rows.some((r) => r.isPreset && r.label === "Hora do brinde 🥂")).toBe(true);
			expect(rows.some((r) => !r.isPreset && r.label === "Nova custom")).toBe(true);
			// Antigas removidas.
			expect(rows.some((r) => r.label === "Antiga")).toBe(false);
			expect(rows.some((r) => r.label === "Selfie com o anfitrião")).toBe(false);
		});

		it("evento de outro anfitrião → EventNotFoundError", async () => {
			const hostId = await makeHost(db, "upd-owner@example.com");
			const otherId = await makeHost(db, "upd-other@example.com");
			const created = await service.createEvent({
				hostUserId: hostId,
				input: baseInput(),
			});
			await expect(
				service.updateEvent(created.slug, otherId, { name: "Hack" }),
			).rejects.toBeInstanceOf(EventNotFoundError);
		});
	});
});
