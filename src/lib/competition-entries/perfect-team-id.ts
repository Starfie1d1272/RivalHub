export function normalizePerfectTeamId(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return value.length <= 128 && /^[0-9]+$/.test(value) ? value : null;
}
