/** 统一展示格式化，保证跨页面量纲一致 */

export const fmtRating = (v: number | null | undefined): string =>
  v != null ? v.toFixed(2) : "—";

export const fmtAdr = (v: number | null | undefined): string =>
  v != null ? v.toFixed(1) : "—";

export const fmtKd = (v: number | null | undefined): string =>
  v != null ? v.toFixed(2) : "—";

export const fmtKpr = (v: number | null | undefined): string =>
  v != null ? v.toFixed(2) : "—";

/** FKPR / MKPR / CPR 统一展示为每 100 回合 */
export const fmtPer100r = (v: number | null | undefined): string =>
  v != null ? (v * 100).toFixed(1) : "—";

export const fmtHs = (v: number | null | undefined): string =>
  v != null ? `${v.toFixed(0)}%` : "—";

export const fmtWe = (v: number | null | undefined): string =>
  v != null ? v.toFixed(1) : "—";

export const fmtRws = (v: number | null | undefined): string =>
  v != null ? v.toFixed(2) : "—";
