// Mede o tamanho gzip do bundle de entrada do cliente e falha se exceder
// `MAX_GZIP_BYTES` (NFR3: 200 KB). Story 1.4 — versão simples; Story 1.5 expande
// com Worker bundle + comentário no PR.
//
// Uso: `pnpm build && pnpm check:bundle-size`.
import { gzipSync } from "node:zlib";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const MAX_GZIP_BYTES = 200 * 1024;
const ASSETS_DIR = join(process.cwd(), "dist", "client", "assets");

function formatKB(bytes) {
	return `${(bytes / 1024).toFixed(2)} KB`;
}

async function findEntry() {
	let files;
	try {
		files = await readdir(ASSETS_DIR);
	} catch (err) {
		if (err.code === "ENOENT") {
			console.error(
				`✗ ${ASSETS_DIR} não existe. Rode \`pnpm build\` antes.`,
			);
			process.exit(2);
		}
		throw err;
	}
	const entry = files.find((name) => /^index-.*\.js$/.test(name));
	if (!entry) {
		console.error("✗ Não achei entry `index-*.js` em dist/client/assets/.");
		process.exit(2);
	}
	return join(ASSETS_DIR, entry);
}

const entryPath = await findEntry();
const raw = await readFile(entryPath);
const gz = gzipSync(raw);

const rel = entryPath.replace(`${process.cwd()}/`, "").replace(/\\/g, "/");
const ok = gz.byteLength <= MAX_GZIP_BYTES;

console.log("");
console.log("Bundle size check (NFR3 ≤ 200 KB gzip)");
console.log("─".repeat(60));
console.log(`File:      ${rel}`);
console.log(`Raw:       ${formatKB(raw.byteLength)}`);
console.log(`Gzip:      ${formatKB(gz.byteLength)}`);
console.log(`Limit:     ${formatKB(MAX_GZIP_BYTES)}`);
console.log(`Headroom:  ${formatKB(MAX_GZIP_BYTES - gz.byteLength)}`);
console.log(`Status:    ${ok ? "✓ OK" : "✗ EXCEEDED"}`);
console.log("");

if (!ok) {
	process.exit(1);
}
