import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { matchTimeProposals } from "@/db/schema/match-time-proposals";

export const MATCH_TIME_PROPOSAL_STATUSES = ["pending", "accepted", "rejected", "expired"] as const;
export type MatchTimeProposalStatus = (typeof MATCH_TIME_PROPOSAL_STATUSES)[number] | "unknown";

export const MATCH_TIME_PROPOSAL_STATUS_LABELS = {
  pending: "待回应",
  accepted: "已接受",
  rejected: "已拒绝",
  expired: "已过期",
  unknown: "状态待确认",
} satisfies Record<MatchTimeProposalStatus, string>;

export function normalizeMatchTimeProposalStatus(status: string): MatchTimeProposalStatus {
  return (MATCH_TIME_PROPOSAL_STATUSES as readonly string[]).includes(status)
    ? status as Exclude<MatchTimeProposalStatus, "unknown">
    : "unknown";
}

/** Fields allowed on the public match-time proposal view. */
export interface PublicMatchTimeProposal {
  id: string;
  status: MatchTimeProposalStatus;
  proposedTime: Date;
  responseAt: Date | null;
  rejectReason: string | null;
  createdAt: Date;
}

/** Public view plus the viewer-relative state needed by captain controls. */
export interface MatchTimeProposalView extends PublicMatchTimeProposal {
  isMine: boolean;
}

interface MatchTimeProposalSource extends Omit<PublicMatchTimeProposal, "status"> {
  status: string;
  proposedBy: string;
}

function loadMatchTimeProposalRows(matchId: string): Promise<MatchTimeProposalSource[]> {
  return db
    .select({
      id: matchTimeProposals.id,
      status: matchTimeProposals.status,
      proposedTime: matchTimeProposals.proposedTime,
      responseAt: matchTimeProposals.responseAt,
      rejectReason: matchTimeProposals.rejectReason,
      createdAt: matchTimeProposals.createdAt,
      proposedBy: matchTimeProposals.proposedBy,
    })
    .from(matchTimeProposals)
    .where(eq(matchTimeProposals.matchId, matchId))
    .orderBy(desc(matchTimeProposals.createdAt));
}

/** Server-only projection for the authenticated viewer of the match page. */
export async function getMatchTimeProposalViews(
  matchId: string,
  viewerUserId?: string,
): Promise<MatchTimeProposalView[]> {
  const rows = await loadMatchTimeProposalRows(matchId);
  return rows.map((row) => serializePublicMatchTimeProposal(row, viewerUserId));
}

/** Explicit serializer used by regression tests and future public callers. */
export function serializePublicMatchTimeProposal(
  row: MatchTimeProposalSource,
  viewerUserId?: string,
): MatchTimeProposalView {
  return {
    id: row.id,
    status: normalizeMatchTimeProposalStatus(row.status),
    proposedTime: row.proposedTime,
    responseAt: row.responseAt,
    rejectReason: row.rejectReason,
    createdAt: row.createdAt,
    isMine: Boolean(viewerUserId && viewerUserId === row.proposedBy),
  };
}
