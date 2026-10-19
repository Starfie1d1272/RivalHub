import type { BetSubject } from "./types";
/** The same conflict rule owns both the public affordance and stake admission. */
export function betRosterRestriction(userId: string | null, subject: BetSubject, roster: readonly { userId: string; entryId: string; current: boolean }[]): string | null {
  if (subject.kind === "event") return null;
  return userId && roster.some(member => member.current && member.userId === userId && subject.entryIds.includes(member.entryId))
    ? "相关队伍名单成员不能参与此盘口" : null;
}
