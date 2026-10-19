export const ADMIN_OPERATIONS_FILTERS = ["todo", "unproposed", "pending", "confirmed", "reschedule_pending", "uncovered", "conflict", "all"] as const;
export type AdminOperationsFilter = typeof ADMIN_OPERATIONS_FILTERS[number];

export function parseAdminOperationsFilter(value: string | null): AdminOperationsFilter {
  return ADMIN_OPERATIONS_FILTERS.find((filter) => filter === value) ?? "todo";
}

export function isAdminMatchInScope(
  match: { stage: string; entryAId: string; entryBId: string },
  scope: { stage?: string; team?: string },
): boolean {
  return (!scope.stage || scope.stage === "all" || match.stage === scope.stage) &&
    (!scope.team || scope.team === "all" || match.entryAId === scope.team || match.entryBId === scope.team);
}
