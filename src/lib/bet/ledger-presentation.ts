/** Reads future ledger grants without treating them as a settlement. */
export function betLedgerLabel(kind: string, stage: string | null, state: string | null): string {
  switch (kind) {
    case "initial": return "初始积分";
    case "stage": return `${stage ?? "正赛阶段"} 补给`;
    case "relief": return "低保补给";
    case "stake": return "投入";
    case "reversal": return "官方赛果更正，撤销原结算";
    case "settlement": return state === "refunded" ? "退款：盘口作废或奖池不满足分配条件" : "结算";
    default: return "积分变动";
  }
}
