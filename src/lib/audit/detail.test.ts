import { describe, expect, it } from "vitest";
import { describeAuditDetail } from "./detail";
import { summarizeAuditMeta } from "./presentation";

// Protect the action DTO boundary: historical gaps must not become invented facts,
// and arbitrary metadata must never escape through the newly accessible dialog.
describe("audit detail safe projection", () => {
  it("retains historical gaps and explains revoke without reconstructing current data", () => {
    const detail = describeAuditDetail("postmatch.report.revoke", { currentVideoUrl: "https://private.test", token: "private-token" }, new Map());
    expect(detail.fields.every(field => field.value === "未记录")).toBe(true);
    expect(detail.description).toContain("比分、Demo、录像和解说名单保留");
    expect(JSON.stringify(detail)).not.toContain("private");
  });

  it("projects saved submission history and hides URLs in the optional reason", () => {
    const id = "10000000-0000-4000-8000-000000000001";
    const detail = describeAuditDetail("postmatch.report.revoke", {
      submittedByUserId: id, originalSubmittedAt: "2026-10-10T14:42:00Z",
      before: { submitted: true, hasVideoUrl: false }, after: { submitted: false, hasVideoUrl: false },
      reason: "补充资料 https://private.test/file?token=secret", raw: "private-payload",
    }, new Map([[id, "提交人甲"]]));
    expect(detail.fields).toContainEqual({ label: "原提交人", value: "提交人甲" });
    expect(detail.fields).toContainEqual({ label: "操作前", value: "已提交 · 未关联录像" });
    expect(detail.fields).toContainEqual({ label: "操作后", value: "待整理 · 未关联录像" });
    expect(detail.fields).toContainEqual({ label: "撤销原因", value: "补充资料 [链接已隐藏]" });
    expect(JSON.stringify(detail)).not.toMatch(/private|secret|10000000/);
  });

  it("shows video-only snapshots without inventing a report state", () => {
    const detail = describeAuditDetail("postmatch.video.update", { before: { hasVideoUrl: true }, after: { hasVideoUrl: true }, videoChange: "replaced" }, new Map());
    expect(detail.fields).toContainEqual({ label: "操作前", value: "已关联录像" });
    expect(detail.fields.find(field => field.label === "录像变更")?.value).not.toBe("未记录");
  });

  it.each(["constructor", "__proto__", "private-token"])("rejects non-allowlisted enum %s", value => {
    expect(describeAuditDetail("mizar.reliable.accept", { kind: value, outcome: value }, new Map()).fields.every(field => field.value === "未记录")).toBe(true);
    expect(describeAuditDetail("postmatch.video.update", { videoChange: value }, new Map()).fields.every(field => field.value === "未记录")).toBe(true);
    expect(summarizeAuditMeta("postmatch.video.update", { videoChange: value })).not.toContain(value);
  });

  it("shows a received event requiring attention as requiring attention", () => {
    expect(describeAuditDetail("mizar.reliable.accept", { kind: "map_ended", outcome: "needs_attention", reason: "private" }, new Map()).fields).toEqual([
      { label: "事件", value: "地图结束" }, { label: "处理结果", value: "需要人工核对" },
    ]);
  });
});
