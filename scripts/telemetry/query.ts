/** Read-only operator client. No secrets in arguments, output, URLs, or browser configuration. */
import { accountKey } from "../../src/lib/telemetry/ticket";
import { UUID } from "../../src/lib/telemetry/protocol";

async function main() {
  const args = process.argv.slice(2);
  const endpoint = new URL(process.env.PRODUCT_TELEMETRY_ENDPOINT ?? "");
  const admin = process.env.PRODUCT_TELEMETRY_ADMIN_KEY ?? "";
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || admin.length < 32) throw new Error("Missing approved HTTPS endpoint or operator credential");
  const [mode, value, end] = args;
  const query = new URL("/admin/events", endpoint);
  if (mode === "session" && UUID.test(value ?? "")) query.searchParams.set("session", value);
  else if (mode === "account" && UUID.test(value ?? "")) {
    const key = process.env.PRODUCT_TELEMETRY_ACCOUNT_KEY ?? "";
    if (key.length < 32) throw new Error("Missing product-scoped account key");
    query.searchParams.set("account", await accountKey(value, key));
  } else if (mode === "summary" && /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(end ?? "")) {
    query.pathname = "/admin/summary"; query.searchParams.set("from", value); query.searchParams.set("to", end);
  } else if (mode === "usage") query.pathname = "/admin/usage";
  else throw new Error("Usage: telemetry:query session UUID | account UUID | summary YYYY-MM-DD YYYY-MM-DD | usage");
  const response = await fetch(query, { headers: { authorization: `Bearer ${admin}` }, redirect: "error", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Telemetry query failed (${response.status})`);
  // Result is the receiver's bounded safe schema. Keep it in the private operator session.
  process.stdout.write(`${JSON.stringify(await response.json(), null, 2)}\n`);
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : "Query failed"}\n`); process.exitCode = 1; });
