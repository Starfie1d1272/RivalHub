import type { PublicStage } from "./types";

export type PickEmTaskState = "complete" | "submitted" | "active" | "upcoming" | "missed" | "failed" | "void";
export interface PickEmTask { key: string; label: string; state: PickEmTaskState; progress: number | null; target: number }
export function stageTasks(input: {
  type: PublicStage["type"]; target: number; submitted: boolean; locked: boolean;
  closed: boolean; available: boolean; voided: boolean;
  result: { hits: number; challenges: boolean[] } | null;
}): PickEmTask[] {
  const { result } = input;
  const base: PickEmTaskState = input.voided ? "void" : input.closed && !input.submitted ? "missed" : input.available ? "active" : "upcoming";
  const submission: PickEmTask = { key: "submission", label: "赛前完整提交预测", target: 1,
    state: input.voided ? "void" : input.locked ? "complete" : input.submitted && !input.closed ? "submitted" : base,
    progress: input.locked ? 1 : 0 };
  const goals = input.type === "swiss"
    ? [{ key: "hits", label: `猜对至少 ${input.target} 项`, target: input.target, achieved: result ? result.hits >= input.target : false, progress: result?.hits ?? null }]
    : [{ key: "quarter", label: "八强猜对至少 2 场", target: 2 }, { key: "semi", label: "四强猜对至少 1 场", target: 1 }, { key: "champion", label: "猜中冠军", target: 1 }].map((goal, index) => ({ ...goal, achieved: result?.challenges[index] ?? false, progress: null }));
  return [submission, ...goals.map(({ achieved, ...goal }): PickEmTask => ({ ...goal,
    state: input.voided ? "void" : result ? achieved ? "complete" : "failed" : base,
  }))];
}

/** Primary score owns shared rank; hits only order viewers within a tied rank. */
export function rankPickEmAchievements(rows: readonly { accountId: string; name: string; challenges: number; hits: number; coin: string }[], me?: string) {
  const ordered = [...rows].sort((a, b) => b.challenges - a.challenges || b.hits - a.hits || a.name.localeCompare(b.name) || a.accountId.localeCompare(b.accountId));
  let previous = -1, rank = 0;
  return ordered.map((row, index) => {
    if (row.challenges !== previous) { rank = index + 1; previous = row.challenges; }
    return { name: row.name, value: String(row.challenges), coin: row.coin, rank, isMe: row.accountId === me };
  });
}
