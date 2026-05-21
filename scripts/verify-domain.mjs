// Verifica registros DNS de autenticação email (SPF/DKIM/DMARC) em
// instanta.jbnado.dev e DMARC em _dmarc.instanta.jbnado.dev.
// Story 1.11. ESM puro, sem deps externas. Validação pattern-level.
//
// Uso:
//   pnpm verify:domain                  → usa resolver do sistema.
//   pnpm verify:domain --server=1.1.1.1 → força CF DNS público (bypass cache local).
import { Resolver } from "node:dns/promises";

const DOMAIN = "instanta.jbnado.dev";
const RECORDS = [
	{
		label: "SPF",
		host: DOMAIN,
		validate: (records) => {
			const flat = records.flat().join(" ");
			const ok = /v=spf1/i.test(flat) && /include:_spf\.resend\.com/i.test(flat) && /[-~]all/i.test(flat);
			return { ok, detail: ok ? "SPF Resend OK" : `Faltando: ${!/v=spf1/i.test(flat) ? "v=spf1 " : ""}${!/include:_spf\.resend\.com/i.test(flat) ? "include:_spf.resend.com " : ""}${!/[-~]all/i.test(flat) ? "-all|~all" : ""}` };
		},
	},
	{
		label: "DKIM",
		host: `resend._domainkey.${DOMAIN}`,
		validate: (records) => {
			const ok = records.length > 0;
			return { ok, detail: ok ? `${records.length} record(s)` : "Nenhum DKIM TXT em resend._domainkey" };
		},
	},
	{
		label: "DMARC",
		host: `_dmarc.${DOMAIN}`,
		validate: (records) => {
			const flat = records.flat().join(" ");
			const hasV = /v=DMARC1/i.test(flat);
			const hasPolicy = /p=(quarantine|reject)/i.test(flat);
			const hasRua = /rua=/i.test(flat);
			const ok = hasV && hasPolicy && hasRua;
			return { ok, detail: ok ? "DMARC quarantine/reject + rua OK" : `Faltando: ${!hasV ? "v=DMARC1 " : ""}${!hasPolicy ? "p=quarantine|reject " : ""}${!hasRua ? "rua= " : ""}` };
		},
	},
];

const customServer = process.argv.find((a) => a.startsWith("--server="))?.split("=")[1];
const resolver = new Resolver();
if (customServer) resolver.setServers([customServer]);

async function resolveTxt(host) {
	try {
		return { records: await resolver.resolveTxt(host), error: null };
	} catch (err) {
		return { records: [], error: err.code ?? err.message };
	}
}

console.log("");
console.log(`Domain DNS check — ${DOMAIN}`);
if (customServer) console.log(`Resolver: ${customServer}`);
console.log("─".repeat(72));

let anyFailure = false;
for (const rec of RECORDS) {
	const { records, error } = await resolveTxt(rec.host);
	let status;
	let detail;
	if (error) {
		status = "✗";
		detail = `${error} (${rec.host})`;
		anyFailure = true;
	} else {
		const v = rec.validate(records);
		status = v.ok ? "✓" : "✗";
		detail = v.detail;
		if (!v.ok) anyFailure = true;
	}
	console.log(`${rec.label.padEnd(6)} ${status} ${detail}`);
}

console.log("");
if (anyFailure) {
	console.error("Algum registro falhou. Veja o runbook § Domain DNS + Email Auth pra passos.");
	process.exit(1);
}
console.log("Todos os registros válidos.");
