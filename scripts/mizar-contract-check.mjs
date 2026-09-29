import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Rebuild the chosen local Mizar checkout and execute its real adapter/parsers.
// Report the exact HEAD for this run without making rapid Mizar development a version gate.
const mizarRoot = resolve(process.argv[2] ?? "../Mizar");
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: mizarRoot, encoding: "utf8" }).trim();
const dirty = Boolean(execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: mizarRoot, encoding: "utf8" }).trim());
try {
  execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["install", "--frozen-lockfile"], { cwd: mizarRoot, stdio: "pipe" });
  execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["--filter", "@mizar/rivalhub...", "build"], { cwd: mizarRoot, stdio: "pipe" });
  process.stdout.write(`Mizar compatibility commit: ${sha}${dirty ? " + local changes" : ""} (rebuilt adapter/parser)\n`);
} catch {
  process.stdout.write(`Mizar compatibility commit: ${sha}${dirty ? " + local changes" : ""} (using existing build/source)\n`);
}
const pick = (...candidates) => candidates.find((candidate) => existsSync(candidate));
const adapterPath = pick(
  resolve(mizarRoot, "packages/rivalhub/dist/index.js"),
  resolve(mizarRoot, "packages/rivalhub/src/index.ts"),
);
const protocolPath = pick(
  resolve(mizarRoot, "packages/protocol/dist/context.js"),
  resolve(mizarRoot, "packages/protocol/src/context.ts"),
);
const outputPath = pick(
  resolve(mizarRoot, "packages/protocol/dist/output.js"),
  resolve(mizarRoot, "packages/protocol/src/output.ts"),
);
if (!adapterPath) throw new Error(`Cannot find Mizar adapter in ${mizarRoot}`);
if (!protocolPath) throw new Error(`Cannot find Mizar protocol context in ${mizarRoot}`);
if (!outputPath) throw new Error(`Cannot find Mizar protocol output in ${mizarRoot}`);
const adapter = await import(pathToFileURL(adapterPath).href);
const protocol = await import(pathToFileURL(protocolPath).href);
const output = await import(pathToFileURL(outputPath).href);
const rivalhubProtocol = await import(pathToFileURL(resolve("src/lib/mizar/protocol.ts")).href);
const fixture = async (name) => JSON.parse(await readFile(resolve("tests/fixtures/contracts", name), "utf8"));

// RivalHub vendor copy must agree with the producer-owned parser, not merely exist.
for (const key of ["LIVE_SNAPSHOT_SCHEMA_VERSION", "RELIABLE_EVENT_SCHEMA_VERSION", "LIVE_SNAPSHOT_MAX_BYTES"]) {
  if (output[key] !== rivalhubProtocol[key]) {
    throw new Error(`protocol drift: ${key} is ${rivalhubProtocol[key]} in RivalHub but ${output[key]} in Mizar`);
  }
}
process.stdout.write("mizar protocol constants: RivalHub vendor copy matches the producer\n");

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

// Provider edge matrix: the DTO must stay valid across null branding, absent start time,
// every owned status/format, and must never smuggle persistence or review facts.
const manifestBase = await fixture("rivalhub-provider-manifest-v1.json");
const scheduleBase = await fixture("rivalhub-provider-schedule-window-v1.json");
const manifestVariants = [
  ["competition logoUrl null", { ...manifestBase, match: { ...manifestBase.match, competition: { ...manifestBase.match.competition, logoUrl: null } } }],
  ["startedAt null", { ...manifestBase, match: { ...manifestBase.match, startedAt: null } }],
  ["scheduled", { ...manifestBase, match: { ...manifestBase.match, status: "scheduled", startedAt: null, scoreA: null, scoreB: null } }],
  ["finished", { ...manifestBase, match: { ...manifestBase.match, status: "finished", scoreA: 2, scoreB: 1 } }],
  ["cancelled", { ...manifestBase, match: { ...manifestBase.match, status: "cancelled" } }],
  ["bo1", { ...manifestBase, match: { ...manifestBase.match, format: "bo1" }, maps: manifestBase.maps.slice(0, 1) }],
  ["bo5", { ...manifestBase, match: { ...manifestBase.match, format: "bo5" } }],
];
for (const [label, variant] of manifestVariants) {
  const result = adapter.validateBroadcastManifest(variant);
  if (!result.ok) throw new Error("provider manifest " + label + ": " + JSON.stringify(result.diagnostics));
  protocol.parseMatchDocumentV1(adapter.toMatchDocumentV1(variant));
}
const scheduleVariants = [
  ["scheduledAt null", { ...scheduleBase, matches: scheduleBase.matches.map((match) => ({ ...match, scheduledAt: null })) }],
  ["empty window", { ...scheduleBase, matches: [] }],
];
for (const [label, variant] of scheduleVariants) {
  const result = adapter.validateBroadcastScheduleWindow(variant);
  if (!result.ok) throw new Error("provider schedule " + label + ": " + JSON.stringify(result.diagnostics));
  protocol.parseScheduleWindowV1(adapter.toScheduleWindowV1(variant));
}
if (adapter.validateBroadcastManifest({ ...manifestBase, schemaVersion: "rivalhub.broadcast-manifest.v2" }).ok) {
  throw new Error("provider manifest accepted an unsupported schemaVersion");
}
if (adapter.validateBroadcastScheduleWindow({ ...scheduleBase, schemaVersion: "rivalhub.broadcast-schedule-window.v2" }).ok) {
  throw new Error("provider schedule accepted an unsupported schemaVersion");
}
const smuggledManifest = {
  ...manifestBase,
  match: { ...manifestBase.match, credentialHash: "smuggled-credential", reviewNote: "smuggled-review" },
  entrants: { a: { ...manifestBase.entrants.a, email: "smuggled@example.test" }, b: manifestBase.entrants.b },
};
const smuggledDocument = adapter.toMatchDocumentV1(smuggledManifest);
if (JSON.stringify(smuggledDocument).includes("smuggled")) {
  throw new Error("Mizar document carried RivalHub private fields across the adapter");
}
process.stdout.write("rivalhub provider edge matrix: logo/startedAt/status/format variants and private-field smuggling refused\n");

// Provider DTO may never leak internal persistence or review facts.
const manifestFixture = await fixture("rivalhub-provider-manifest-v1.json");
const manifestJson = JSON.stringify(manifestFixture);
for (const forbidden of ["private-review-marker", "private-perfect-marker", "credentialHash", "reviewNote", "@example.test"]) {
  if (manifestJson.includes(forbidden)) throw new Error(`provider manifest leaked ${forbidden}`);
}
process.stdout.write("rivalhub provider fixtures: no private-field leakage\n");

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

// LiveSnapshot: the producer parser and the RivalHub vendor copy must agree on accept and reject.
const liveFixture = await fixture("mizar-live-snapshot-v1.radar.json");
output.parseLiveSnapshotV1(liveFixture);
rivalhubProtocol.parseLiveSnapshotV1(liveFixture);
const liveRejections = [
  ["unsupported version", { ...liveFixture, schemaVersion: "mizar.live-snapshot.v2" }],
  ["radar map mismatch", { ...liveFixture, radar: { ...liveFixture.radar, mapName: "de_mirage" } }],
  ["stale radar", { ...liveFixture, capability: { ...liveFixture.capability, radarCurrent: false } }],
  ["round history map mismatch", { ...liveFixture, series: { ...liveFixture.series, currentMapOrder: 2 } }],
];
for (const [label, payload] of liveRejections) {
  for (const [owner, parse] of [["Mizar", output.parseLiveSnapshotV1], ["RivalHub", rivalhubProtocol.parseLiveSnapshotV1]]) {
    let rejected = false;
    try { parse(payload); } catch { rejected = true; }
    if (!rejected) throw new Error(`live snapshot disagreement: ${owner} accepted ${label}`);
  }
}
const oversized = { ...liveFixture, oversized: "x".repeat(output.LIVE_SNAPSHOT_MAX_BYTES) };
for (const [owner, parse] of [["Mizar", output.parseLiveSnapshotV1], ["RivalHub", rivalhubProtocol.parseLiveSnapshotV1]]) {
  let message = "";
  try { parse(oversized); } catch (error) { message = error instanceof Error ? error.message : String(error); }
  if (!message.includes("output_payload_too_large")) throw new Error(`live snapshot disagreement: ${owner} oversized body => ${message || "accepted"}`);
}
process.stdout.write("mizar-live-snapshot-v1: producer and RivalHub parsers agree (multi-layer Radar, oversize, staleness)\n");

// ReliableEvent: exact eight-kind union, version gate and entrant-relative score semantics.
const reliableCorpus = await fixture("mizar-reliable-event-v1.corpus.json");
if (reliableCorpus.events.length !== 8) throw new Error("reliable corpus must cover exactly the eight owned kinds");
for (const event of reliableCorpus.events) {
  const fromMizar = output.parseReliableEventV1(event);
  const fromRivalHub = rivalhubProtocol.parseReliableEventV1(event);
  if (JSON.stringify(fromMizar) !== JSON.stringify(fromRivalHub)) {
    throw new Error(`reliable event drift for ${event.kind}: RivalHub and Mizar parsed differently`);
  }
}
const mapEnded = reliableCorpus.events.find((event) => event.kind === "map_ended");
if (mapEnded.payload.scoreA !== 13 || mapEnded.payload.scoreB !== 9 || mapEnded.payload.scoreCT !== 4 || mapEnded.payload.scoreT !== 9) {
  throw new Error("reliable corpus must keep scoreA/scoreB entrant-relative and CT/T evidence-only");
}
const reliableRejections = [
  ["unknown kind", { ...reliableCorpus.events[0], kind: "map_paused", payload: {} }],
  ["unsupported version", { ...reliableCorpus.events[0], schemaVersion: "mizar.reliable-event.v2" }],
  ["unknown top-level field", { ...reliableCorpus.events[0], extra: true }],
  ["negative map score", { ...mapEnded, payload: { ...mapEnded.payload, scoreA: -1 } }],
  ["payload mismatch", { ...reliableCorpus.events[1], payload: { scoreA: 1 } }],
];
for (const [label, payload] of reliableRejections) {
  for (const [owner, parse] of [["Mizar", output.parseReliableEventV1], ["RivalHub", rivalhubProtocol.parseReliableEventV1]]) {
    let rejected = false;
    try { parse(payload); } catch { rejected = true; }
    if (!rejected) throw new Error(`reliable event disagreement: ${owner} accepted ${label}`);
  }
}
process.stdout.write("mizar-reliable-event-v1: eight kinds, version gate and score semantics agree\n");

// Verify against real Mizar companion consumer
const connUrl = pathToFileURL(resolve(mizarRoot, "apps/companion/src/match-context/rivalhub-connection.ts")).href;
const { RivalHubConnection } = await import(connUrl);
const tmpPath = resolve("/tmp", `test-mizar-connection-${Date.now()}.json`);
try {
  let pollCount = 0;
  const recordedRequests = [];
  const mockFetch = async (url, init = {}) => {
    const rawUrl = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    const u = new URL(rawUrl);
    const headers = new Headers(init.headers ?? (typeof url === "object" && "headers" in url ? url.headers : undefined));
    recordedRequests.push({
      url: rawUrl,
      pathname: u.pathname,
      method: (init.method ?? "GET").toUpperCase(),
      headers,
    });
    if (u.pathname === "/api/mizar/pairing/start") {
      return new Response(JSON.stringify(startRes), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.pathname === "/api/mizar/pairing/poll") {
      pollCount++;
      const payload = pollCount === 1 ? pollPending : pollAuth;
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.pathname === "/api/mizar/release") {
      return new Response(JSON.stringify({ released: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.pathname === "/api/mizar/disconnect") {
      return new Response(JSON.stringify({ revoked: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected url: ${rawUrl}`);
  };

  const conn = new RivalHubConnection(tmpPath, mockFetch, "https://match.starfie1d.top");
  const started = await conn.startPairing();
  if (!started.authorizeUrl || !started.expiresAt) throw new Error("Mizar startPairing failed to return authorizeUrl/expiresAt");
  const firstPoll = await conn.pollPairing();
  if (firstPoll !== "pending") throw new Error(`Mizar pollPairing expected pending, got ${firstPoll}`);
  const secondPoll = await conn.pollPairing();
  if (secondPoll !== "authorized") throw new Error(`Mizar pollPairing expected authorized, got ${secondPoll}`);
  const view = conn.view();
  if (!view.paired || view.competitionId !== pollAuth.competitionId || view.displayName !== pollAuth.displayName.trim()) {
    throw new Error(`Mizar connection view mismatch: ${JSON.stringify(view)}`);
  }
  await conn.disconnect();
  const disconnectReqs = recordedRequests.filter(r => r.pathname === "/api/mizar/disconnect");
  if (disconnectReqs.length !== 1) {
    throw new Error(`Expected exactly 1 call to /api/mizar/disconnect, got ${disconnectReqs.length}`);
  }
  const disconnectReq = disconnectReqs[0];
  if (disconnectReq.method !== "POST") {
    throw new Error(`Expected POST method for /api/mizar/disconnect, got ${disconnectReq.method}`);
  }
  const authHeader = disconnectReq.headers.get("authorization");
  if (authHeader !== `Bearer ${pollAuth.credential}`) {
    throw new Error(`Expected authorization 'Bearer ${pollAuth.credential}', got '${authHeader}'`);
  }
  const finalView = conn.view();
  if (finalView.paired !== false) {
    throw new Error(`Mizar connection expected unpaired after disconnect, got: ${JSON.stringify(finalView)}`);
  }
  if (existsSync(tmpPath)) {
    throw new Error(`Mizar connection file expected unlinked after disconnect: ${tmpPath}`);
  }
  process.stdout.write("Mizar consumer RivalHubConnection verified against pairing and canonical disconnect contract\n");
} finally {
  await rm(tmpPath, { force: true }).catch(() => null);
}
