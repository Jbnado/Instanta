// Valida que cada FR marcado `implemented` em docs/fr-mapping.md tem comentário
// `// FR-NN` em pelo menos 1 dos arquivos listados.
// Story 1.10. ESM puro, sem deps externas.
//
// Uso: `pnpm fr:check`. Exit 0 se tudo OK, 1 se algum implemented falha.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const MAPPING_PATH = resolve(process.cwd(), "docs", "fr-mapping.md");

const ROW_RE = /^\|\s*FR(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(planned|implemented)\s*\|/;

async function loadMapping() {
	let text;
	try {
		text = await readFile(MAPPING_PATH, "utf8");
	} catch (err) {
		console.error(`✗ Não achei ${MAPPING_PATH}: ${err.message}`);
		process.exit(2);
	}

	const rows = [];
	for (const line of text.split("\n")) {
		const m = ROW_RE.exec(line);
		if (!m) continue;
		const [, num, description, filesStr, status] = m;
		const files = filesStr
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		rows.push({
			fr: `FR${num}`,
			frNum: Number(num),
			description,
			files,
			status,
		});
	}
	return rows;
}

function frCommentRe(num) {
	// Aceita `// FR-23`, `// FR23`, `//FR-23` (case-insensitive).
	return new RegExp(`\\/\\/\\s*FR-?${num}(?!\\d)`, "i");
}

async function fileHasFr(filePath, num) {
	if (!existsSync(filePath)) return { exists: false, hasComment: false };
	const content = await readFile(filePath, "utf8");
	return { exists: true, hasComment: frCommentRe(num).test(content) };
}

async function validateImplemented(row) {
	const failures = [];
	let anyFileHasComment = false;

	for (const file of row.files) {
		const filePath = resolve(process.cwd(), file);
		const { exists, hasComment } = await fileHasFr(filePath, row.frNum);
		if (!exists) {
			failures.push(`${row.fr}: file não existe → ${file}`);
		} else if (hasComment) {
			anyFileHasComment = true;
		}
	}

	if (!anyFileHasComment && row.files.length > 0) {
		const allFilesExist = row.files.every((f) => existsSync(resolve(process.cwd(), f)));
		if (allFilesExist) {
			failures.push(
				`${row.fr}: nenhum dos arquivos listados tem comentário \`// ${row.fr}\` → ${row.files.join(", ")}`,
			);
		}
	}

	return failures;
}

const rows = await loadMapping();
if (rows.length === 0) {
	console.error("✗ Nenhuma linha FR encontrada no mapping. Confira formato da tabela.");
	process.exit(2);
}

let okCount = 0;
let plannedCount = 0;
const allFailures = [];

for (const row of rows) {
	if (row.status === "planned") {
		plannedCount += 1;
		continue;
	}
	const failures = await validateImplemented(row);
	if (failures.length === 0) {
		okCount += 1;
	} else {
		allFailures.push(...failures);
	}
}

console.log("");
console.log("FR mapping check");
console.log("─".repeat(60));
console.log(`Total:        ${rows.length}`);
console.log(`planned:      ${plannedCount}`);
console.log(`implemented:  ${okCount + Math.ceil(allFailures.length / 2)} (${okCount} OK)`);
console.log(`failures:     ${allFailures.length}`);
console.log("");

if (allFailures.length > 0) {
	console.error("Failures:");
	for (const f of allFailures) console.error(`  ✗ ${f}`);
	console.error("");
	process.exit(1);
}

console.log("✓ Todos os FRs implementados têm comentário no código.");
