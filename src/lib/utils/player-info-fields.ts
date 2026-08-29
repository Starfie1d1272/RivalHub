export const PLAYER_INFO_FIELDS = [
  { key: "gameplayStyle", label: "风格" },
  { key: "notes", label: "备注" },
  { key: "competitionHistory", label: "经历" },
] as const;

/** Registration fields explicitly approved for anonymous player profiles. */
export const PUBLIC_PLAYER_INFO_FIELDS = [
  { key: "gameplayStyle", label: "风格" },
  { key: "competitionHistory", label: "经历" },
] as const;
