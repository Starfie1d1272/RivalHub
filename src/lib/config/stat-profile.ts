import type { StatFieldKey, StatProfile } from "@/types/season";

export const ALL_STAT_FIELDS: StatFieldKey[] = [
  "kills", "deaths", "assists", "hsPercent", "firstKills",
  "multiKills", "clutches", "adr", "rws", "ratingPro", "we",
];

export const PERFECTWORLD_STAT_PROFILE: StatProfile = {
  provider: "perfectworld",
  inputFields: ALL_STAT_FIELDS,
  rankMetric: "ratingPro",
};
