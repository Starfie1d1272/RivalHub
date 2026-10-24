/** Canonical BP invalidation facts. Legacy/unknown `veto` remains broad. */
export const VETO_AFFECTED_FACTS = ["lineups", "appeals", "veto_step", "map_plan", "veto"] as const;
export type VetoAffectedFact = typeof VETO_AFFECTED_FACTS[number];
