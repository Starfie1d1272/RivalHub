export type PostMatchCompletion = "pending_collection" | "waiting_video" | "completed";
/** The registered roster is the default; only an explicit reopen needs renewed confirmation. */
export function getPostMatchCompletion(submittedAt: Date | null, videoUrl: string | boolean | null, reopened = false): PostMatchCompletion {
  return projectPostMatchCompletion({ submitted: Boolean(submittedAt), hasVideo: Boolean(videoUrl), reopened });
}
export function projectPostMatchCompletion(input: { submitted: boolean; hasVideo: boolean; reopened?: boolean }): PostMatchCompletion {
  return input.reopened && !input.submitted ? "pending_collection" : input.hasVideo ? "completed" : "waiting_video";
}
export const POST_MATCH_COMPLETION_LABEL: Record<PostMatchCompletion, string> = {
  pending_collection: "待更正解说名单", waiting_video: "等待录像", completed: "已完成",
};
