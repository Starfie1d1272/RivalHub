import { describe, expect, it } from "vitest";
import { betLedgerLabel } from "./ledger-presentation";
describe("BET ledger reader compatibility", () => {
  it("never labels a grant or unknown future kind as profit or settlement", () => {
    expect(betLedgerLabel("relief", null, null)).toBe("低保补给");
    expect(betLedgerLabel("future", null, "refunded")).toBe("积分变动");
    expect(betLedgerLabel("initial", null, null)).toBe("初始积分");
    expect(betLedgerLabel("stage", "传奇组", null)).toBe("传奇组 补给");
    expect(betLedgerLabel("settlement", null, "refunded")).toContain("退款");
    expect(betLedgerLabel("settlement", null, "settled")).toBe("结算");
    expect(betLedgerLabel("reversal", null, null)).toContain("撤销");
  });
});
