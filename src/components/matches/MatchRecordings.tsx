import { isHttpUrl } from "@/lib/external-url";
import type { MatchRecording } from "@/lib/postmatch/recording-types";

/** Public projection: legacy links are deliberately not attributed to a person. */
export function MatchRecordings({ recordings, legacyUrl, commentators }: {
  recordings: MatchRecording[]; legacyUrl: string | null;
  commentators: { userId: string; name: string }[];
}) {
  const rows = recordings.filter(row => isHttpUrl(row.url));
  const legacy = legacyUrl && isHttpUrl(legacyUrl) ? legacyUrl : null;
  const count = rows.length + Number(Boolean(legacy));
  if (!count) return null;
  const groups = [...new Set(rows.map(row => row.commentatorUserId))];
  return <details className="relative">
    <summary className="cursor-pointer list-none rounded border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-accent)]">比赛回放 · {count} ▾</summary>
    <div className="absolute right-0 z-30 mt-2 max-h-96 w-72 max-w-[80vw] space-y-3 overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-3 shadow-lg">
      {groups.map(userId => <section key={userId} className="space-y-1">
        <h3 className="text-xs font-semibold text-[var(--color-fg-mid)]">{commentators.find(person => person.userId === userId)?.name ?? "解说回放"}</h3>
        {rows.filter(row => row.commentatorUserId === userId).map(row => <a key={row.id} className="block break-words rounded px-2 py-1 text-sm text-[var(--color-accent)] hover:underline" href={row.url} target="_blank" rel="noopener noreferrer">{row.title} ↗</a>)}
      </section>)}
      {legacy && <section><h3 className="text-xs text-[var(--color-fg-mid)]">比赛回放</h3><a className="block py-1 text-sm text-[var(--color-accent)] hover:underline" href={legacy} target="_blank" rel="noopener noreferrer">原有录像 ↗</a></section>}
    </div>
  </details>;
}
