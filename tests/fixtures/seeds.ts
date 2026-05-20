import { Faker, pt_BR } from "@faker-js/faker";

import { uuidv7 } from "../../src/lib/uuid";

// Faker pt_BR pra fixtures parecerem dados reais do produto (Brasil-first).
// Seed 42 fixo: runs paralelos produzem os mesmos valores, debug fica reproduzível.
// Se um test precisar de variabilidade, importa `Faker` direto e cria instância própria.
export const faker = new Faker({ locale: [pt_BR], seed: 42 });

// Factories puras: retornam o objeto pronto pra `db.insert(...).values(makeUser())`.
// Cada factory aceita `overrides` parciais — caller customiza só o que importa pro test.

export function makeUser(overrides: Partial<NewUser> = {}): NewUser {
	return {
		id: uuidv7(),
		email: faker.internet.email().toLowerCase(),
		passwordHash: "$argon2id$v=19$placeholder",
		displayName: faker.person.fullName(),
		totalInstantes: 0,
		currentLevel: 1,
		createdAt: new Date(),
		...overrides,
	};
}

export function makeEvent(overrides: Partial<NewEvent> & { hostUserId: string }): NewEvent {
	return {
		id: uuidv7(),
		slug: faker.lorem.slug({ min: 2, max: 3 }),
		name: faker.lorem.words({ min: 2, max: 4 }),
		passwordHash: "$argon2id$v=19$placeholder",
		colorAccent: "#7c3aed",
		status: "Inativo",
		bytesUsed: 0,
		createdAt: new Date(),
		...overrides,
	};
}

export function makeEventPhoto(overrides: Partial<NewEventPhoto> & { eventId: string; uploaderUserId: string }): NewEventPhoto {
	return {
		id: uuidv7(),
		cfImageId: faker.string.alphanumeric(20),
		telaoVisible: true,
		reportsCount: 0,
		createdAt: new Date(),
		...overrides,
	};
}

// Tipos derivados do schema Drizzle — colocados aqui pra factories não importarem
// schema diretamente (evita ciclo). Atualizar se schema crescer.
type NewUser = {
	id: string;
	email: string;
	passwordHash: string;
	displayName?: string | null;
	totalInstantes: number;
	currentLevel: number;
	deletedAt?: Date | null;
	createdAt: Date;
};

type NewEvent = {
	id: string;
	slug: string;
	name: string;
	passwordHash: string;
	colorAccent: string;
	status: "Inativo" | "Ativo" | "Encerrado";
	hostUserId: string;
	bytesUsed: number;
	scheduledVisibility?: Date | null;
	endedAt?: Date | null;
	photosPurgedAt?: Date | null;
	createdAt: Date;
};

type NewEventPhoto = {
	id: string;
	eventId: string;
	uploaderUserId: string;
	cfImageId: string;
	telaoVisible: boolean;
	hiddenAt?: Date | null;
	hiddenBy?: string | null;
	reportsCount: number;
	createdAt: Date;
};
