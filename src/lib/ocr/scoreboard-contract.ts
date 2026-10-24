import type { OperatorScoreboardRow } from "@/lib/matches/operator-scoreboard";

export type ScoreboardOperation = "save" | "clear";
export interface ScoreboardCommand { operationId: string; expectedVersion: string; expectedActor: string }
export interface ScoreboardSnapshot { rows: OperatorScoreboardRow[]; version: string }
export interface AuthorizedScoreboardSnapshot extends ScoreboardSnapshot { actorScope: string }
export interface ScoreboardReceipt {
  operationId: string;
  mapId: string;
  operation: ScoreboardOperation;
  payloadDigest: string;
  baseVersion: string;
  resultVersion: string;
  resultCount: number;
  createdAt: string;
}
export type ScoreboardReceiptStatus = { status: "unconfirmed" } | {
  status: "committed";
  receipt: ScoreboardReceipt;
  snapshot: AuthorizedScoreboardSnapshot;
  superseded: boolean;
};
