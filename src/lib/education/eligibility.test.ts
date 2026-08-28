import { describe, expect, it } from "vitest";
import { evaluateRosterEducationEligibility, resolveSeasonEducationVerification } from "./eligibility";
import { emailDomain, normalizeChsiEvidenceUrl } from "./validation";

const njuRule = [{ institutionCode: "4132010284", eligibleAcademicStatuses: ["enrolled", "graduated"] as const, minRosterMembers: 3, minStartingMembers: 3 }];
const member = (userId: string, options: { verified?: boolean; code?: string; status?: "pending" | "approved" | "rejected" } = {}) => ({ userId, email: `${userId}@example.test`, emailVerifiedAt: options.verified === false ? null : new Date(), verification: options.status === "pending" || options.status === "rejected" ? { id: `${userId}-verification`, institutionCode: options.code ?? "4132010284", institutionName: "南京大学", academicStatus: "enrolled" as const, status: options.status } : { id: `${userId}-verification`, institutionCode: options.code ?? "4132010284", institutionName: "南京大学", academicStatus: "enrolled" as const, status: "approved" as const } });

describe("education eligibility", () => {
  it("requires verified email, approved education and three NJU affiliations", () => {
    const result = evaluateRosterEducationEligibility([member("a"), member("b"), member("c", { verified: false })], njuRule);
    expect(result.eligible).toBe(false);
    expect(result.blockers.join(" ")).toContain("邮箱尚未验证");
    expect(result.blockers.join(" ")).toContain("当前已认证南京大学成员 2 人");
  });

  it("accepts exactly three approved NJU affiliations and records references", () => {
    const result = evaluateRosterEducationEligibility([member("a"), member("b"), member("c")], njuRule);
    expect(result.eligible).toBe(true);
    expect(result.selectedVerificationIds.size).toBe(3);
  });

  it("selects the older approved assertion when it is the one matching this season", () => {
    const result = resolveSeasonEducationVerification([
      { id: "newer-other", institutionCode: "999", institutionName: "外校", academicStatus: "enrolled", status: "approved", submittedAt: new Date("2026-08-02") },
      { id: "older-nju", institutionCode: "4132010284", institutionName: "南京大学", academicStatus: "enrolled", status: "approved", submittedAt: new Date("2026-08-01") },
    ], njuRule);
    expect(result.selectedVerification?.id).toBe("older-nju");
    expect(result.matchedRule?.institutionCode).toBe("4132010284");
    expect(result.eligibilityState).toBe("approved");
  });

  it("uses the newest approved assertion when none matches the season rule", () => {
    const result = resolveSeasonEducationVerification([
      { id: "older", institutionCode: "998", institutionName: "外校甲", academicStatus: "enrolled", status: "approved", submittedAt: new Date("2026-08-01") },
      { id: "newer", institutionCode: "999", institutionName: "外校乙", academicStatus: "graduated", status: "approved", submittedAt: new Date("2026-08-02") },
    ], njuRule);
    expect(result.selectedVerification?.id).toBe("newer");
    expect(result.eligibilityState).toBe("unmatched");
  });

  it("uses exact official CHSI URL and exact email domain parsing", () => {
    expect(normalizeChsiEvidenceUrl("https://www.chsi.com.cn/x?y=1")).toBe("https://www.chsi.com.cn/x?y=1");
    expect(normalizeChsiEvidenceUrl("https://evil-chsi.com.cn/x")).toBeNull();
    expect(normalizeChsiEvidenceUrl("http://www.chsi.com.cn/x")).toBeNull();
    expect(emailDomain("a@smail.nju.edu.cn")).toBe("smail.nju.edu.cn");
    expect(emailDomain("a@smail.nju.edu.cn.attacker.com")).toBe("smail.nju.edu.cn.attacker.com");
  });
});
