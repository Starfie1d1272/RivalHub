export type SanctionEffect =
  | "registration_block"
  | "roster_block"
  | "match_participation_block";

export const SANCTION_EFFECTS: readonly SanctionEffect[] = [
  "registration_block",
  "roster_block",
  "match_participation_block",
];

export const SANCTION_EFFECT_LABELS: Record<SanctionEffect, string> = {
  registration_block: "禁止报名",
  roster_block: "禁止进入赛事名单",
  match_participation_block: "禁止单场出场",
};
