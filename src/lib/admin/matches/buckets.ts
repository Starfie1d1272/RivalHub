/** One operational bucket per match, ordered by the action that matters now. */
export function projectAdminMatchBuckets<T extends { id: string; status: string; scheduledAt: Date | null; demoNeedsAttentionCount?: number | null }>(
  matches: readonly T[],
  conflicts: ReadonlySet<string>,
  now: number,
) {
  const groups = [
    { label: "需要处理", matches: [] as T[] },
    { label: "进行中", matches: [] as T[] },
    { label: "今日 / 即将开始", matches: [] as T[] },
    { label: "待排期", matches: [] as T[] },
  ];
  for (const match of matches) {
    if (Boolean(match.demoNeedsAttentionCount) || conflicts.has(match.id)) groups[0]!.matches.push(match);
    else if (match.status === "in_progress") groups[1]!.matches.push(match);
    else if (match.status === "scheduled" && match.scheduledAt && match.scheduledAt.getTime() >= now - 3600_000 && match.scheduledAt.getTime() < now + 24 * 3600_000) groups[2]!.matches.push(match);
    else if (match.status === "scheduled" && !match.scheduledAt) groups[3]!.matches.push(match);
  }
  return groups;
}
