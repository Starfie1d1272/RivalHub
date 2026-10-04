import { compareRecordValue, RECORD_NAMES, type RecordCandidate, type RecordKind } from "./record-facts";
export interface RecordOccurrence extends RecordCandidate {
  eventName: string; eventSlug: string; matchId: string; mapId: string; mapName: string;
  score: string; rounds: number; entityName: string; entityHref: string; opponent: string;
}
export interface RecordSummary {
  kind: RecordKind; label: string; value: number | null; holderCount: number; occurrenceCount: number;
  holders: { id: string; name: string; href: string }[]; occurrences: RecordOccurrence[]; page: number; pages: number;
}
export const RECORD_PAGE_SIZE = 10;
export function collectRecordTies(occurrences: readonly RecordOccurrence[]): RecordOccurrence[] {
  const seen = new Set<string>();
  const deduped = occurrences.filter((r) => {
    const key = `${r.kind}:${r.eventSlug}:${r.matchId}:${r.mapId}:${r.round ?? 0}:${r.entityId}`;
    if (seen.has(key)) return false; seen.add(key); return true;
  });
  return (Object.keys(RECORD_NAMES) as RecordKind[]).flatMap((kind) => {
    const rows = deduped.filter((r) => r.kind === kind && r.denominator > 0);
    const best = rows.length ? rows.reduce((a, b) => compareRecordValue(a, b) >= 0 ? a : b) : null;
    const ties = best ? rows.filter((r) => compareRecordValue(r, best) === 0).sort((a, b) => a.eventSlug.localeCompare(b.eventSlug)
      || a.matchId.localeCompare(b.matchId) || a.mapId.localeCompare(b.mapId) || (a.round ?? 0) - (b.round ?? 0) || a.entityId.localeCompare(b.entityId)) : [];
    return ties;
  });
}
export function buildRecords(occurrences: readonly RecordOccurrence[], page = 1): RecordSummary[] {
  const winners = collectRecordTies(occurrences);
  return (Object.entries(RECORD_NAMES) as [RecordKind, string][]).map(([kind, label]) => {
    const ties = winners.filter((row) => row.kind === kind), best = ties[0];
    const holders = [...new Map(ties.map((r) => [r.entityId, { id: r.entityId, name: r.entityName, href: r.entityHref }])).values()];
    const pages = Math.max(1, Math.ceil(ties.length / RECORD_PAGE_SIZE));
    const selectedPage = Math.min(Math.max(1, Math.floor(page)), pages);
    const start = (selectedPage - 1) * RECORD_PAGE_SIZE;
    return { kind, label, value: best ? best.numerator / best.denominator : null, holderCount: holders.length, occurrenceCount: ties.length,
      holders: holders.slice(0, RECORD_PAGE_SIZE), occurrences: ties.slice(start, start + RECORD_PAGE_SIZE), page: selectedPage, pages };
  });
}
