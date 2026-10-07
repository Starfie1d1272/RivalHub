/** The same conflict rule owns both the public affordance and stake admission. */
export function betRosterRestriction(userId: string | null, entryIds: readonly string[], roster: readonly { userId: string; entryId: string; current: boolean }[]): string | null {
  return userId && roster.some(member => member.current && member.userId === userId && entryIds.includes(member.entryId))
    ? "相关队伍名单成员不能参与此盘口" : null;
}
