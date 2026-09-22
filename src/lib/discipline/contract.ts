export type SanctionEffect =
  | "registration_block"
  | "roster_block"
  | "match_participation_block";

export const SANCTION_EFFECTS: readonly SanctionEffect[] = [
  "registration_block",
  "roster_block",
  "match_participation_block",
];
