import { uuidv7 as generate } from "uuidv7";

// Time-sortable UUID v7 (RFC 9562). Usado como PK em todas as tabelas.
// Wrapper isolado para trocar implementação sem caçar imports espalhados.
export function uuidv7(): string {
	return generate();
}
