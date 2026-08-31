/**
 * Canonical CS2 position taxonomy shared by long-lived player preferences and
 * Rivals registration. Position labels are presentation only; these keys are
 * the persisted contract.
 */
export const CS2_POSITION_VALUES = [
  "igl",
  "awper",
  "opener",
  "closer",
  "anchor",
] as const;

export const CS2_POSITION_LABELS = {
  igl: { cn: "指挥", en: "IGL", full: "IGL（指挥）" },
  awper: { cn: "狙击手", en: "AWPer", full: "AWPer（狙击手）" },
  opener: { cn: "突破手", en: "Opener", full: "Opener（突破手）" },
  closer: { cn: "自由人/残局", en: "Closer", full: "Closer（自由人/残局）" },
  anchor: { cn: "主防", en: "Anchor", full: "Anchor（主防）" },
} as const;

export type Cs2Position = (typeof CS2_POSITION_VALUES)[number];
