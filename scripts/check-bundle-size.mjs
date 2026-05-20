// Mede os bundles cliente (gzip, NFR3) e Worker (raw, hard limit CF) e
// reporta status. Story 1.5: dois budgets + flag `--json` pro workflow.
//
// Uso:
//   pnpm check:bundle-size           → tabela human-readable
//   pnpm check:bundle-size --json    → JSON pra workflow consumir
//
// Limits:
//   Client: ≤ 200 KB gzip (NFR3)
//   Worker: hard 10 MB raw; warning ≥ 60%, fail ≥ 80% (Winston party mode)
import { gzipSync } from "node:zlib";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const CLIENT_MAX_GZIP = 200 * 1024;
const WORKER_HARD_LIMIT = 10 * 1024 * 1024;
const WORKER_WARN_PCT = 0.6;
const WORKER_FAIL_PCT = 0.8;

const CLIENT_ASSETS_DIR = join(process.cwd(), "dist", "client", "assets");
const WORKER_ENTRY = join(process.cwd(), "dist", "instanta", "index.js");

const wantJson = process.argv.includes("--json");

function kb(bytes) {
	return `${(bytes / 1024).toFixed(2)} KB`;
}

function mb(bytes) {
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function relativize(p) {
	return p.replace(`${process.cwd()}/`, "").replace(/\\/g, "/");
}

async function measureClient() {
	let files;
	try {
		files = await readdir(CLIENT_ASSETS_DIR);
	} catch (err) {
		if (err.code === "ENOENT") {
			throw new Error(
				`Client dir ${CLIENT_ASSETS_DIR} não existe — rode \`pnpm build\` antes.`,
			);
		}
		throw err;
	}
	const entry = files.find((name) => /^index-.*\.js$/.test(name));
	if (!entry) {
		throw new Error("Não achei entry `index-*.js` em dist/client/assets/.");
	}
	const filePath = join(CLIENT_ASSETS_DIR, entry);
	const raw = await readFile(filePath);
	const gzipped = gzipSync(raw);
	const status = gzipped.byteLength > CLIENT_MAX_GZIP ? "fail" : "ok";
	return {
		kind: "client",
		file: relativize(filePath),
		raw: raw.byteLength,
		gzip: gzipped.byteLength,
		limit: CLIENT_MAX_GZIP,
		headroom: CLIENT_MAX_GZIP - gzipped.byteLength,
		status,
	};
}

async function measureWorker() {
	let s;
	try {
		s = await stat(WORKER_ENTRY);
	} catch (err) {
		if (err.code === "ENOENT") {
			throw new Error(
				`Worker bundle ${WORKER_ENTRY} não existe — rode \`pnpm build\` antes.`,
			);
		}
		throw err;
	}
	const percent = s.size / WORKER_HARD_LIMIT;
	let status = "ok";
	if (percent >= WORKER_FAIL_PCT) status = "fail";
	else if (percent >= WORKER_WARN_PCT) status = "warn";
	return {
		kind: "worker",
		file: relativize(WORKER_ENTRY),
		raw: s.size,
		limit: WORKER_HARD_LIMIT,
		percent,
		status,
	};
}

function combinedExitCode(client, worker) {
	if (client.status === "fail" || worker.status === "fail") return 1;
	return 0;
}

function statusBadge(s) {
	if (s === "ok") return "✓ OK";
	if (s === "warn") return "⚠ WARN";
	return "✗ FAIL";
}

function renderText({ client, worker }) {
	const lines = [];
	lines.push("");
	lines.push("Bundle size check");
	lines.push("─".repeat(72));
	lines.push("Client (NFR3 — ≤ 200 KB gzip):");
	lines.push(`  File:     ${client.file}`);
	lines.push(`  Raw:      ${kb(client.raw)}`);
	lines.push(`  Gzip:     ${kb(client.gzip)}`);
	lines.push(`  Limit:    ${kb(client.limit)}`);
	lines.push(`  Headroom: ${kb(client.headroom)}`);
	lines.push(`  Status:   ${statusBadge(client.status)}`);
	lines.push("");
	lines.push("Worker (CF hard limit — warn 60% / fail 80% de 10 MB):");
	lines.push(`  File:     ${worker.file}`);
	lines.push(`  Raw:      ${mb(worker.raw)}`);
	lines.push(`  Limit:    ${mb(worker.limit)}`);
	lines.push(`  Used:     ${(worker.percent * 100).toFixed(1)}%`);
	lines.push(`  Status:   ${statusBadge(worker.status)}`);
	lines.push("");
	return lines.join("\n");
}

let client;
let worker;
try {
	[client, worker] = await Promise.all([measureClient(), measureWorker()]);
} catch (err) {
	console.error(`✗ ${err.message}`);
	process.exit(2);
}

if (wantJson) {
	const payload = {
		client,
		worker,
		generatedAt: new Date().toISOString(),
	};
	console.log(JSON.stringify(payload));
} else {
	console.log(renderText({ client, worker }));
}

process.exit(combinedExitCode(client, worker));
