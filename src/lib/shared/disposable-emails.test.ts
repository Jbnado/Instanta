import { describe, expect, it } from "vitest";

import { isDisposableEmail } from "./disposable-emails";

describe("isDisposableEmail", () => {
	it.each([
		["user@mailinator.com", true],
		["foo@guerrillamail.com", true],
		["bar@10minutemail.com", true],
		["someone@yopmail.com", true],
		["x@trashmail.com", true],
		// Variações de case devem ser detectadas (normalize lowercase).
		["USER@MAILINATOR.COM", true],
		["user@Mailinator.Com", true],
		// Emails reais não devem ser bloqueados.
		["alice@gmail.com", false],
		["bob@protonmail.com", false],
		["carlos@uol.com.br", false],
		["dani@empresa.com.br", false],
		// Edge cases.
		["nodomain", false],
		["@mailinator.com", true], // technically invalid mas vazio antes do @ — checa só dominio
		["double@@mailinator.com", true], // pega o último @
	])("isDisposableEmail(%j) === %j", (input, expected) => {
		expect(isDisposableEmail(input)).toBe(expected);
	});
});
