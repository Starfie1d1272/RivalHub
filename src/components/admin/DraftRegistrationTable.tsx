import type { RegistrationDraft } from "@/db/schema/registration-drafts";
import { Marker, Panel, EmptyState } from "@/components/rivalhub";
import { formatCST } from "@/lib/utils/date";

const str = (v: unknown) => (typeof v === "string" ? v : "—");

interface DraftRegistrationTableProps {
  drafts: RegistrationDraft[];
}

export function DraftRegistrationTable({ drafts }: DraftRegistrationTableProps) {
  return (
    <div className="mt-8">
      <div className="mb-4">
        <Marker sub={`${drafts.length} 份草稿`}>报名草稿</Marker>
      </div>

      {drafts.length === 0 ? (
        <EmptyState title="暂无草稿报名" />
      ) : (
        <Panel pad={16}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[var(--color-fg-dim)]">
                  <th className="py-2 text-left font-medium">邮箱</th>
                  <th className="py-2 text-left font-medium">Steam 昵称</th>
                  <th className="py-2 text-left font-medium">主要位置</th>
                  <th className="py-2 text-left font-medium">段位</th>
                  <th className="py-2 text-left font-medium">最后保存</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((draft) => {
                  const p = draft.payload;
                  const steamName = str(p.steamName);
                  const primaryPosition = str(p.primaryPosition);
                  const peakRank = str(p.peakRank);
                  return (
                    <tr key={draft.id} className="border-b border-[var(--color-border)]/50">
                      <td className="py-2 text-[var(--color-fg)]">{draft.email}</td>
                      <td className="py-2 text-[var(--color-fg)]">{steamName}</td>
                      <td className="py-2 text-[var(--color-fg)]">{primaryPosition}</td>
                      <td className="py-2 text-[var(--color-fg)]">{peakRank}</td>
                      <td className="py-2 text-[var(--color-fg-dim)] tabular-nums">
                        {formatCST(draft.updatedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
