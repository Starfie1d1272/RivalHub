import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Rebuild the chosen local Mizar checkout and execute its real adapter/parsers.
// Report the exact HEAD for this run without making rapid Mizar development a version gate.
const mizarRoot = resolve(process.argv[2] ?? "../Mizar");
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: mizarRoot, encoding: "utf8" }).trim();
const dirty = Boolean(execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: mizarRoot, encoding: "utf8" }).trim());
try {
  execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["--filter", "@mizar/rivalhub...", "build"], { cwd: mizarRoot, stdio: "pipe" });
  process.stdout.write(`Mizar compatibility commit: ${sha}${dirty ? " + local changes" : ""} (rebuilt adapter/parser)\n`);
} catch {
  process.stdout.write(`Mizar compatibility commit: ${sha}${dirty ? " + local changes" : ""} (using existing build)\n`);
}
const adapter = await import(pathToFileURL(resolve(mizarRoot, "packages/rivalhub/dist/index.js")).href);
const protocol = await import(pathToFileURL(resolve(mizarRoot, "packages/protocol/dist/context.js")).href);
const fixture = async (name) => JSON.parse(await readFile(resolve("tests/fixtures/contracts", name), "utf8"));

for (const [name, validate, convert, parse] of [
  ["rivalhub-provider-manifest-v1.json", adapter.validateBroadcastManifest, adapter.toMatchDocumentV1, protocol.parseMatchDocumentV1],
  ["rivalhub-provider-schedule-window-v1.json", adapter.validateBroadcastScheduleWindow, adapter.toScheduleWindowV1, protocol.parseScheduleWindowV1],
]) {
  const result = validate(await fixture(name));
  if (!result.ok) throw new Error(`${name}: ${JSON.stringify(result.diagnostics)}`);
  const document = parse(convert(result.value));
  if (!document || typeof document !== "object") throw new Error(`${name}: Mizar conversion returned no document`);
  process.stdout.write(`${name}: Mizar adapter and owned parser passed\n`);
}

// Mizar browser pairing contract validation
const startRes = await fixture("mizar-pairing-start-response-v1.json");
if (!/^[0-9a-f-]{36}$/i.test(startRes.pairingId)) throw new Error("pairing-start-response: pairingId must be UUID");
if (!/^[0-9a-f]{64}$/.test(startRes.pollToken)) throw new Error("pairing-start-response: pollToken must be 64 hex chars");
const authorizeUrl = new URL(startRes.authorizeUrl);
if (authorizeUrl.pathname !== "/integrations/mizar/connect" || authorizeUrl.searchParams.get("pairingId") !== startRes.pairingId) {
  throw new Error("pairing-start-response: authorizeUrl must point to /integrations/mizar/connect?pairingId=<id>");
}
if (!Number.isFinite(Date.parse(startRes.expiresAt))) throw new Error("pairing-start-response: expiresAt must be ISO date");
process.stdout.write("mizar-pairing-start-response-v1.json: verified\n");

const pollReq = await fixture("mizar-pairing-poll-request-v1.json");
if (!/^[0-9a-f-]{36}$/i.test(pollReq.pairingId)) throw new Error("pairing-poll-request: pairingId must be UUID");
if (!/^[0-9a-f]{64}$/.test(pollReq.pollToken)) throw new Error("pairing-poll-request: pollToken must be 64 hex chars");
process.stdout.write("mizar-pairing-poll-request-v1.json: verified\n");

const pollPending = await fixture("mizar-pairing-poll-pending-response-v1.json");
if (pollPending.status !== "pending") throw new Error("pairing-poll-pending: status must be pending");
if (!Number.isFinite(Date.parse(pollPending.expiresAt))) throw new Error("pairing-poll-pending: expiresAt must be ISO date");
process.stdout.write("mizar-pairing-poll-pending-response-v1.json: verified\n");

const pollAuth = await fixture("mizar-pairing-poll-authorized-response-v1.json");
if (pollAuth.status !== "authorized") throw new Error("pairing-poll-authorized: status must be authorized");
if (!/^[0-9a-f-]{36}$/i.test(pollAuth.installationId)) throw new Error("pairing-poll-authorized: installationId must be UUID");
if (!/^[0-9a-f-]{36}$/i.test(pollAuth.competitionId)) throw new Error("pairing-poll-authorized: competitionId must be UUID");
if (!/^rh_mizar_[0-9a-f-]{36}_[0-9a-f]{64}$/.test(pollAuth.credential)) throw new Error("pairing-poll-authorized: credential must be rh_mizar_<id>_<proof>");
if (typeof pollAuth.displayName !== "string" || !pollAuth.displayName.trim()) throw new Error("pairing-poll-authorized: displayName must be non-empty string");
if (!Number.isFinite(Date.parse(pollAuth.expiresAt))) throw new Error("pairing-poll-authorized: expiresAt must be ISO date");
process.stdout.write("mizar-pairing-poll-authorized-response-v1.json: verified\n");
process.stdout.write("Mizar browser pairing contract (start + pending/authorized poll) passed\n");
