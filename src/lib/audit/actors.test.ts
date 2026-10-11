import { describe, expect, it } from "vitest";
import { dakPairings, mizarInstallations } from "@/db/schema";
import { auditActorKey, resolveAuditActors, type AuditActorRef } from "./actors";
import type { AuditDatabaseExecutor } from "./targets";

const installationId = "10000000-0000-4000-8000-000000000001";
const pairingId = "10000000-0000-4000-8000-000000000002";

function fakeExecutor() {
  const tables: unknown[] = [];
  const projections: string[][] = [];
  const executor = {
    select(columns: Record<string, unknown>) {
      projections.push(Object.keys(columns));
      let table: unknown;
      const builder = {
        from(value: unknown) { table = value; tables.push(value); return builder; },
        leftJoin() { return builder; },
        where() { return builder; },
        then(resolve: (rows: unknown[]) => unknown) {
          return Promise.resolve(table === mizarInstallations
            ? [{ id: installationId, competitionId: "season-a", displayName: "授权者甲" }]
            : [{ id: pairingId, seasonIds: ["season-a"], displayName: null, email: "secret@example.test" }]).then(resolve);
        },
      };
      return builder;
    },
  } as unknown as AuditDatabaseExecutor;
  return { executor, tables, projections };
}

describe("canonical audit machine actors", () => {
  it("resolves shared Mizar actions in scope without claiming its authorizer operated the device", async () => {
    const { executor, tables, projections } = fakeExecutor();
    const refs: AuditActorRef[] = ["match.start", "match.map.start", "match.record_map_result", "mizar.reliable.accept", "mizar.installation.revoke"].map(action => ({ actorId: installationId, action, seasonId: "season-a" }));
    const actors = await resolveAuditActors([...refs, ...refs], new Map([[installationId, "同 ID 用户"]]), executor);
    for (const ref of refs) expect(actors.get(auditActorKey(ref))).toEqual({ label: "Mizar", kind: "machine", authorizedByLabel: "授权者甲" });
    expect(tables).toEqual([mizarInstallations]);
    expect(projections.flat()).not.toContain("credentialHash");
    expect(projections.flat()).not.toContain("email");
  });

  it("does not reinterpret human actions or leak authorizers across competition scope", async () => {
    const { executor } = fakeExecutor();
    const refs: AuditActorRef[] = [
      { actorId: installationId, action: "mizar.installation.paired", seasonId: "season-a" },
      { actorId: installationId, action: "match.map.start", seasonId: "season-b" },
      { actorId: installationId, action: "match.map.start", seasonId: null },
      { actorId: installationId, action: "mizar.source.claim", seasonId: "season-b" },
    ];
    const actors = await resolveAuditActors(refs, new Map([[installationId, "人类用户"]]), executor);
    for (const ref of refs.slice(0, 3)) expect(actors.get(auditActorKey(ref))).toEqual({ label: "人类用户", kind: "user" });
    expect(actors.get(auditActorKey(refs[3]))).toEqual({ label: "Mizar", kind: "machine" });
  });

  it("keeps human revocations distinct from device disconnects and rejects cross-scope attribution", async () => {
    const { executor } = fakeExecutor();
    const refs: AuditActorRef[] = [
      { actorId: installationId, action: "mizar.installation.revoke", seasonId: "season-a" },
      { actorId: pairingId, action: "mizar.installation.revoke", seasonId: "season-a" },
      { actorId: installationId, action: "mizar.installation.revoke", seasonId: "season-b" },
    ];
    const actors = await resolveAuditActors(refs, new Map([[pairingId, "管理员"], [installationId, "同 ID 用户"]]), executor);
    expect(actors.get(auditActorKey(refs[0]))).toEqual({ label: "Mizar", kind: "machine", authorizedByLabel: "授权者甲" });
    expect(actors.get(auditActorKey(refs[1]))).toEqual({ label: "管理员", kind: "user" });
    expect(actors.get(auditActorKey(refs[2]))).toEqual({ label: "同 ID 用户", kind: "user" });
  });

  it("recognizes DAK and system identities while suppressing secrets and unknown references", async () => {
    const { executor, tables, projections } = fakeExecutor();
    const refs: AuditActorRef[] = [
      { actorId: `dak:${pairingId}`, action: "match.demo.submit", seasonId: "season-a" },
      { actorId: `dak:${pairingId}`, action: "match.demo.submit", seasonId: "season-b" },
      { actorId: "dak:private-token", action: "match.demo.submit", seasonId: null },
      { actorId: "veto-system", action: "match.veto", seasonId: null },
    ];
    const actors = await resolveAuditActors(refs, new Map(), executor);
    expect(actors.get(auditActorKey(refs[0]))).toEqual({ label: "DAK Studio", kind: "machine", authorizedByLabel: "未知用户" });
    for (const ref of refs.slice(1, 3)) expect(actors.get(auditActorKey(ref))).toEqual({ label: "DAK Studio", kind: "machine" });
    expect(actors.get(auditActorKey(refs[3]))).toEqual({ label: "系统", kind: "system" });
    expect(tables).toEqual([dakPairings]);
    expect(projections.flat()).not.toContain("tokenHash");
    expect(JSON.stringify([...actors.values()])).not.toMatch(/secret|private|10000000/);
  });
});
