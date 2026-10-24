import type { MatchRecording } from "@/lib/postmatch/recording-types";

/** Content versions describe the observed state; they are not commit receipts. */
export interface RosterReadbackValue {
  rosterId: string | null;
  status: string | null;
  starterIds: string[];
  substituteIds: string[];
  vetoRepresentativeEventRosterMemberId: string | null;
}
export interface TimeReadbackValue {
  proposalId: string;
  status: string;
  resolution: string | null;
  proposedTime: string;
  scheduledAt: string | null;
  rejectReason: string | null;
}
export interface VersionedReadback<T> { matchId: string; version: string; value: T }
export type RosterReadback = VersionedReadback<RosterReadbackValue> & { entryId: string };
export type RecordingReadback = VersionedReadback<MatchRecording[]>;
export type TimeReadback = VersionedReadback<TimeReadbackValue>;

async function contentVersion(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function rosterReadbackVersion(matchId: string, value: Omit<RosterReadbackValue, "rosterId">): Promise<string> {
  return contentVersion(["roster-readback-v1", matchId, value.status, [...value.starterIds].sort(), [...value.substituteIds].sort(), value.vetoRepresentativeEventRosterMemberId]);
}
export function recordingReadbackVersion(matchId: string, value: readonly MatchRecording[]): Promise<string> {
  return contentVersion(["recording-readback-v1", matchId, value.map(row => [row.id, row.commentatorUserId, row.title.trim(), row.url.trim()])]);
}
export function timeReadbackVersion(matchId: string, value: TimeReadbackValue): Promise<string> {
  return contentVersion(["time-readback-v1", matchId, value.proposalId, value.status, value.resolution, value.proposedTime, value.scheduledAt, value.rejectReason]);
}
export function readbackSummary(matches: boolean, version: string): string {
  return `${matches ? "当前已保存状态与原请求完整一致" : "当前已保存状态与原请求不同，草稿已保留"}（内容版本 ${version.slice(0, 12)}）。此读取不证明原请求提交归属，未重放写入。`;
}
