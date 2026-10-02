import { describe, expect, it } from "vitest";
import { getAuditActorLabel, getAuditContextUserReferences, summarizeAuditPeople } from "./people";

const alice = "10000000-0000-4000-8000-000000000001";
const bob = "10000000-0000-4000-8000-000000000002";
const names = new Map([[alice, "Alice"], [bob, "Bob"], ["legacy@example.test", "老用户"]]);

describe("audit people presentation", () => {
  it.each([
    [alice, "Alice"], ["legacy@example.test", "老用户"],
    ["missing@example.test", "未知用户"], [null, "系统"], ["system", "系统"],
    ["system:timeout", "系统"], ["dak:private-pairing-id", "DAK Studio"],
    ["release:private-deployment-token", "发布流程"], ["future:private-token", "未知来源"],
    ["constructor", "未知来源"],
  ])("labels actor %s without exposing machine or email identifiers", (id, label) => {
    expect(getAuditActorLabel(id, names)).toBe(label);
  });

  it("looks up only UUIDs from the action-specific reference allowlist", () => {
    const meta = { fromUserId: alice, toUserId: bob, subjectUserId: alice, token: bob, email: "private@example.test" };
    expect([...getAuditContextUserReferences("team.captain.transfer", meta)]).toEqual([["fromUserId", alice], ["toUserId", bob]]);
    expect([...getAuditContextUserReferences("sanction.issue", meta)]).toEqual([["subjectUserId", alice]]);
    for (const action of ["future.action", "constructor"]) expect(getAuditContextUserReferences(action, meta).size).toBe(0);
    for (const value of [null, [], { fromUserId: "secret-token", toUserId: "private@example.test" }]) {
      expect(getAuditContextUserReferences("team.captain.transfer", value).size).toBe(0);
    }
  });

  it("resolves transfer, sanction and merge context without serializing other metadata", () => {
    const meta = { fromUserId: alice, toUserId: bob, subjectUserId: bob, mergedUserId: alice, reason: "private reason", evidence: "secret evidence" };
    expect(summarizeAuditPeople("team.captain.transfer", meta, names)).toBe("队长：Alice → Bob");
    expect(summarizeAuditPeople("competition_entry.representative.transfer", meta, names)).toBe("赛事代表：Alice → Bob");
    expect(summarizeAuditPeople("sanction.issue", meta, names)).toBe("处罚对象：Bob");
    expect(summarizeAuditPeople("user_identity.merge", meta, names)).toBe("合并来源：Alice");
    expect(summarizeAuditPeople("team.captain.transfer", meta, new Map([[bob, "Bob"]]))).toBe("队长：未知用户 → Bob");
  });
});
