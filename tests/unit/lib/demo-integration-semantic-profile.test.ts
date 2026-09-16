import { describe, expect, it } from "vitest";
import {
  CURRENT_DAK_SEMANTIC_PROFILE,
  dakSemanticProfileIssueMessage,
  isCurrentDakSemanticProfile,
  isRetiredDakSemanticProfile,
  RETIRED_DAK_SEMANTIC_PROFILES,
} from "@/lib/demo-integration/semantic-profile";

describe("DAK semantic profile policy", () => {
  it("promotes /3 and retires /1 and /2", () => {
    expect(CURRENT_DAK_SEMANTIC_PROFILE).toBe("dak-stable/3");
    expect(RETIRED_DAK_SEMANTIC_PROFILES).toEqual(["dak-stable/1", "dak-stable/2"]);
    expect(isCurrentDakSemanticProfile("dak-stable/3")).toBe(true);
    expect(isCurrentDakSemanticProfile("dak-stable/2")).toBe(false);
    expect(isRetiredDakSemanticProfile("dak-stable/1")).toBe(true);
    expect(isRetiredDakSemanticProfile("dak-stable/2")).toBe(true);
    expect(isRetiredDakSemanticProfile("dak-stable/3")).toBe(false);
  });

  it("explains that retired profiles remain historical only", () => {
    expect(dakSemanticProfileIssueMessage("dak-stable/2")).toBe(
      "当前 RivalHub 只接受 dak-stable/3；dak-stable/2 仅可读取历史，不能重新确认。",
    );
    expect(dakSemanticProfileIssueMessage("dak-stable/4")).toBe(
      "当前 RivalHub 只接受 dak-stable/3。",
    );
  });
});
