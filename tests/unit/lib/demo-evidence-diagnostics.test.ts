import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";
import { DAK_DIAGNOSTICS_EXTENSION, validateDakDiagnostics, type DakDiagnostics } from "@/lib/demo-evidence/diagnostics";
import { sha256Json } from "@/lib/demo-integration/revision";
import { projectAdminDemoQuality } from "@/lib/admin/matches/demo-quality";
import type { matchDemoImports } from "@/db/schema";

const fixture = JSON.parse(readFileSync("tests/fixtures/demo-evidence/normal-map-v1.json", "utf8"));
function withDiagnostics(issueCount = 1) {
  const evidence = parseRivalHubDemoEvidenceV1(structuredClone(fixture));
  evidence.quality.qa = { ok: true, issueCount, warningCount: issueCount, errorCount: 0 };
  evidence.quality.capabilities.richKills = "partial";
  const diagnostics: DakDiagnostics = {
    version: 1,
    qa: { issues: Array.from({ length: Math.min(issueCount, 64) }, () => ({ severity: "warning", code: "future.check", path: "kills[0]", message: "Source coverage is incomplete." })), omittedIssueCount: Math.max(0, issueCount - 64) },
    richKills: { eventCount: evidence.sourceFacts.kills.length, flagsEventCount: evidence.sourceFacts.kills.length, namedActiveWeaponEventCount: 0, reason: "no_named_active_weapon" },
  };
  evidence.extensions[DAK_DIAGNOSTICS_EXTENSION] = diagnostics;
  return { evidence, diagnostics };
}
function stored(evidence: ReturnType<typeof parseRivalHubDemoEvidenceV1>) {
  return {
    id: "test-import", payload: evidence, payloadSha256: sha256Json(evidence),
    demoSha256: evidence.source.demoSha256, seasonId: evidence.target.seasonId, matchId: evidence.target.matchId,
    matchMapId: evidence.target.matchMapId, contractVersion: evidence.contract.contractVersion,
    semanticProfile: evidence.contract.semanticProfile, analysisVersion: evidence.contract.analysisVersion,
    evidenceRevision: evidence.target.evidenceRevision,
  } as typeof matchDemoImports.$inferSelect;
}

// New evidence is untrusted. Existing golden fixtures do not cover diagnostics limits,
// secrets, summary integrity or legacy absence; these are parser/projection contracts.
describe("DAK deterministic diagnostics boundary", () => {
  it.each([0, 4, 70])("preserves %i warnings, unknown codes and explicit truncation", (count) => {
    const { evidence, diagnostics } = withDiagnostics(count);
    const parsed = parseRivalHubDemoEvidenceV1(evidence);
    expect(parsed.extensions[DAK_DIAGNOSTICS_EXTENSION]).toEqual(diagnostics);
    expect(sha256Json(parsed)).toBe(sha256Json(evidence));
    const projected = projectAdminDemoQuality(stored(parsed), { mapOrder: 1, mapName: "de_ancient" });
    expect(projected.issues).toHaveLength(Math.min(count, 64));
    expect(projected.summary).toContain(`${count} 条警告`);
    expect(projected.capabilityReason).toContain("未观察到可识别的当前武器");
    if (count > 64) expect(projected.notice).toContain("6 条未传送");
  });

  it("reads legacy counts without manufacturing details or changing its hash", () => {
    const evidence = parseRivalHubDemoEvidenceV1(structuredClone(fixture));
    const hash = sha256Json(evidence);
    const projected = projectAdminDemoQuality(stored(evidence), { mapOrder: 1, mapName: "de_ancient" });
    expect(projected.issues).toEqual([]);
    expect(projected.notice).toContain("未提供");
    expect(sha256Json(parseRivalHubDemoEvidenceV1(evidence))).toBe(hash);
    expect(evidence.extensions).toEqual({});
  });

  it.each([
    { attemptId: "run-1" }, { cause: "network" }, { requestId: "request-1" }, { version: 2 },
  ])("rejects runtime metadata and unsupported versions: %j", (extra) => {
    const { evidence, diagnostics } = withDiagnostics();
    evidence.extensions[DAK_DIAGNOSTICS_EXTENSION] = { ...diagnostics, ...extra } as DakDiagnostics;
    expect(() => parseRivalHubDemoEvidenceV1(evidence)).toThrow();
  });

  it.each([
    "Bearer secret-value", "accessToken=secret-value", "https://user:pass@example.test/a?key=value",
    "C:\\Users\\Alice\\demo.dem", "/home/alice/demo.dem", "Cookie: session=secret", "player@example.test",
    "76561198000000001", "at fn (file.ts:1)", "token\n=secret", "bad\u202etext",
  ])("rejects unsafe diagnostic text without silently altering hashed input: %s", (message) => {
    const { evidence, diagnostics } = withDiagnostics();
    diagnostics.qa.issues[0]!.message = message;
    const before = structuredClone(evidence);
    expect(() => parseRivalHubDemoEvidenceV1(evidence)).toThrow();
    expect(evidence).toEqual(before);
  });

  it("rejects unbounded issues, unsafe identifiers and inconsistent summaries", () => {
    const { evidence, diagnostics } = withDiagnostics(65);
    diagnostics.qa.issues.push(diagnostics.qa.issues[0]!);
    expect(() => parseRivalHubDemoEvidenceV1(evidence)).toThrow();
    diagnostics.qa.issues.pop();
    diagnostics.qa.issues[0]!.code = "accessToken.secret";
    expect(() => parseRivalHubDemoEvidenceV1(evidence)).toThrow();
    diagnostics.qa.issues[0]!.code = "future.valid";
    diagnostics.qa.issues[0]!.path = "/private/demo";
    expect(() => parseRivalHubDemoEvidenceV1(evidence)).toThrow();
    diagnostics.qa.issues[0]!.path = null;
    diagnostics.qa.omittedIssueCount = 0;
    expect(() => parseRivalHubDemoEvidenceV1(evidence)).toThrow("摘要不一致");
  });

  it("keeps QA errors distinct from warnings and capability limitations", () => {
    const { evidence, diagnostics } = withDiagnostics();
    evidence.quality.qa = { ok: false, issueCount: 1, errorCount: 1, warningCount: 0 };
    diagnostics.qa.issues[0]!.severity = "error";
    const parsed = parseRivalHubDemoEvidenceV1(evidence);
    const projected = projectAdminDemoQuality(stored(parsed), { mapOrder: 1, mapName: "de_ancient" });
    expect(projected.summary).toContain("未通过：1 条错误，0 条警告");
    expect(projected.issues[0]).toMatchObject({ label: "错误", path: "kills[0]", code: "future.check" });
    expect(projected.capability).toContain("部分可用");
  });

  it("binds deterministic diagnostics to payload identity while preserving gameplay facts", () => {
    const { evidence } = withDiagnostics();
    const legacy = structuredClone(evidence);
    delete legacy.extensions[DAK_DIAGNOSTICS_EXTENSION];
    expect(sha256Json(evidence)).not.toBe(sha256Json(legacy));
    const parsed = parseRivalHubDemoEvidenceV1(evidence);
    expect(parsed.sourceFacts).toEqual(legacy.sourceFacts);
    expect(parsed.semanticFacts).toEqual(legacy.semanticFacts);
    expect(parsed.summaries).toEqual(legacy.summaries);
    expect(parsed.participants).toEqual(legacy.participants);
  });

  it("checks reason/count relationships, including legal empty events", () => {
    const { evidence, diagnostics } = withDiagnostics(0);
    const empty = { ...diagnostics, richKills: { eventCount: 0, flagsEventCount: 0, namedActiveWeaponEventCount: 0, reason: "no_kill_events" as const } };
    const quality = { ...evidence.quality, capabilities: { ...evidence.quality.capabilities, richKills: "available" as const } };
    expect(() => validateDakDiagnostics(empty, quality, 0)).not.toThrow();
    expect(() => validateDakDiagnostics(empty, quality, 1)).toThrow("计数不一致");
    diagnostics.richKills.namedActiveWeaponEventCount = 1;
    expect(() => parseRivalHubDemoEvidenceV1(evidence)).toThrow("能力摘要不一致");
    diagnostics.richKills.reason = "flags_and_named_active_weapon";
    evidence.quality.capabilities.richKills = "available";
    expect(() => parseRivalHubDemoEvidenceV1(evidence)).not.toThrow();
    diagnostics.richKills.flagsEventCount = 0;
    diagnostics.richKills.reason = "no_rich_kill_flags";
    evidence.quality.capabilities.richKills = "missing";
    expect(() => parseRivalHubDemoEvidenceV1(evidence)).not.toThrow();
  });

  it("preserves other namespaces and retains strict quality/diagnostic objects", () => {
    const { evidence, diagnostics } = withDiagnostics();
    evidence.extensions["vendor/feature"] = { future: true };
    expect(parseRivalHubDemoEvidenceV1(evidence).extensions["vendor/feature"]).toEqual({ future: true });
    const original = structuredClone(evidence);
    Object.assign(evidence.quality.qa, { issues: [] });
    expect(() => parseRivalHubDemoEvidenceV1(evidence)).toThrow();
    evidence.quality.qa = original.quality.qa;
    Object.assign(diagnostics.qa.issues[0]!, { cause: "runtime" });
    expect(() => parseRivalHubDemoEvidenceV1(evidence)).toThrow();
  });
});
