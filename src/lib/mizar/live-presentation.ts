import type { PublicLiveMatchProjection } from "./live-projection";

const PHASES: Record<string, string> = {
  live: "对局中", freezetime: "准备回合", freeze: "准备回合", warmup: "热身中",
  over: "回合结束", gameover: "地图结束", intermission: "中场休息",
  paused: "比赛暂停", paused_ct: "CT 暂停", paused_t: "T 暂停",
  timeout_ct: "CT 暂停", timeout_t: "T 暂停", bomb: "C4 倒计时", defuse: "正在拆除",
};
export function presentLivePhase(phase: string | null): string { return phase ? PHASES[phase] ?? "比赛进行中" : "比赛进行中"; }
export function presentBomb(bomb: PublicLiveMatchProjection["bomb"]): string | null {
  if (!bomb) return null;
  if (bomb.action?.kind === "plant") return "正在安放 C4";
  if (bomb.action?.kind === "defuse") return "正在拆除 C4";
  return ({ carried: "C4 携带中", dropped: "C4 已掉落", planted: "C4 已安放", defused: "C4 已拆除", exploded: "C4 已爆炸" } as Record<string, string>)[bomb.state ?? ""] ?? null;
}
export function formatLiveClock(seconds: number | null): string {
  if (seconds === null) return "—";
  const value = Math.ceil(seconds);
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

/** CT/T can swap at halftime: public A/B scores follow canonical entry IDs. */
export function publicRoundScore(snapshot: PublicLiveMatchProjection, entryAId: string, entryBId: string) {
  const { ct, t } = snapshot.teams;
  if (ct.entryId === entryAId && t.entryId === entryBId) return { scoreA: snapshot.map.scoreCT, scoreB: snapshot.map.scoreT };
  if (t.entryId === entryAId && ct.entryId === entryBId) return { scoreA: snapshot.map.scoreT, scoreB: snapshot.map.scoreCT };
  return null;
}
