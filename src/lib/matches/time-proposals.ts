import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { matchTimeProposals } from "@/db/schema/match-time-proposals";

/** Fields allowed on the public match-time proposal view. */
export interface PublicMatchTimeProposal {
  id: string;
  status: string;
  proposedTime: Date;
  responseAt: Date | null;
  rejectReason: string | null;
  createdAt: Date;
}

/** Public view plus the viewer-relative state needed by captain controls. */
export interface MatchTimeProposalView extends PublicMatchTimeProposal {
  isMine: boolean;
}

interface MatchTimeProposalSource extends PublicMatchTimeProposal {
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

/** Public read model with no actor or force-assignment identifiers. */
export async function getPublicMatchTimeProposals(
  matchId: string,
): Promise<PublicMatchTimeProposal[]> {
  const rows = await loadMatchTimeProposalRows(matchId);
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    proposedTime: row.proposedTime,
    responseAt: row.responseAt,
    rejectReason: row.rejectReason,
    createdAt: row.createdAt,
  }));
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
    status: row.status,
    proposedTime: row.proposedTime,
    responseAt: row.responseAt,
    rejectReason: row.rejectReason,
    createdAt: row.createdAt,
    isMine: Boolean(viewerUserId && viewerUserId === row.proposedBy),
  };
}
