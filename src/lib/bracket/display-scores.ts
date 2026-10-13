import type { BracketData } from "./index";
import type { DisplayScore } from "@/lib/matches/display-score";

type DisplayMatch = { bracketNodeId: string | null; entryAId: string; entryBId: string; displayScore: DisplayScore };

/** Viewer-only copy: never pass round scores into brackets-manager results. */
export function projectBracketDisplayScores(data: BracketData, matches: readonly DisplayMatch[]): BracketData {
  const byNode = new Map(matches.filter(match => match.bracketNodeId !== null).map(match => [match.bracketNodeId!, match]));
  const participants = new Map(data.participant.map(participant => [participant.id, participant.rivalhubEntryId]));
  return { ...data, match: data.match.map(node => {
    const match = byNode.get(String(node.id));
    if (!match) return node;
    const a = node.opponent1?.id == null ? null : participants.get(node.opponent1.id);
    const b = node.opponent2?.id == null ? null : participants.get(node.opponent2.id);
    if (!a || !b || ![match.entryAId, match.entryBId].includes(a) || ![match.entryAId, match.entryBId].includes(b) || a === b) return node;
    return { ...node,
      opponent1: { ...node.opponent1!, score: (a === match.entryAId ? match.displayScore.scoreA : match.displayScore.scoreB) ?? undefined },
      opponent2: { ...node.opponent2!, score: (b === match.entryBId ? match.displayScore.scoreB : match.displayScore.scoreA) ?? undefined },
    };
  }) };
}
