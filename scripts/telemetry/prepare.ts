/** Local disabled config generation or read-only provider inventory. Never deploys or creates keys. */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { UUID } from "../../src/lib/telemetry/protocol";

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    account: { type: "string" }, database: { type: "string" }, origin: { type: "string" },
    environment: { type: "string" }, output: { type: "string" },
  } });
  const [mode] = positionals;
  const account = values.account;
  if (!account || !/^[a-f0-9]{32}$/.test(account)) throw new Error("Supply --account with the approved Cloudflare account ID");
  if (mode === "inventory") {
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!token) throw new Error("CLOUDFLARE_API_TOKEN unavailable; resource existence, Free plan and headroom remain unverified. No login attempted.");
    // Read metadata only; no SQL, scripts, secret values, billing changes or provider writes.
    for (const resource of ["d1/database", "workers/scripts"]) {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${resource}?per_page=100`, {
        headers: { authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`Cloudflare ${resource} metadata HTTP ${response.status}; inventory incomplete`);
      const body = await response.json() as { success: boolean; result: { uuid?: string; id?: string; name?: string; file_size?: number }[]; result_info?: { total_pages?: number } };
      if (!body.success || !Array.isArray(body.result)) throw new Error("Invalid Cloudflare inventory response");
      console.log(JSON.stringify({ account, resource, items: body.result.map(item => ({
        id: item.uuid ?? item.id, name: item.name, fileSize: item.file_size,
      })), incomplete: (body.result_info?.total_pages ?? 1) > 1 || body.result.length >= 100 }));
    }
    console.log("Metadata inventory does not establish Workers Free subscription or shared daily usage; verify both in account dashboard before any deployment.");
    return;
  }
  if (mode !== "config" || !values.database || !UUID.test(values.database) || !values.origin || !["preview", "production"].includes(values.environment ?? "") || !values.output) {
    throw new Error("Usage: prepare.ts config --account ID --database UUID --origin HTTPS_ORIGIN --environment preview|production --output .agent-tmp/telemetry/NAME.json");
  }
  const origin = new URL(values.origin);
  if (origin.protocol !== "https:" || origin.href !== `${origin.origin}/` || origin.username || origin.password) throw new Error("Supply a bare HTTPS origin");
  const output = resolve(values.output);
  const directory = resolve(".agent-tmp/telemetry");
  if (!output.startsWith(`${directory}/`)) throw new Error("Output must be inside ignored .agent-tmp/telemetry/");
  const name = `rivalhub-product-telemetry-${values.environment}`;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify({
    name, account_id: account, main: resolve("workers/telemetry/index.ts"), compatibility_date: "2026-07-30",
    workers_dev: true, preview_urls: false, observability: { enabled: false },
    vars: { ACCEPTING: "0", RETENTION_APPROVED: "0", SUMMARY_RETENTION_DAYS: "0", ALLOWED_ORIGIN: origin.origin },
    d1_databases: [{ binding: "DB", database_name: name, database_id: values.database }],
    triggers: { crons: ["0 * * * *"] },
  }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ output, name, account, database: values.database, origin: origin.origin, accepting: false, retentionApproved: false, summaryRetentionDays: 0 }));
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Preparation failed"); process.exitCode = 1; });
