export const CURRENT_DAK_SEMANTIC_PROFILE = "dak-stable/3" as const;

export const RETIRED_DAK_SEMANTIC_PROFILES = ["dak-stable/1", "dak-stable/2"] as const;

export function isCurrentDakSemanticProfile(profile: string): boolean {
  return profile === CURRENT_DAK_SEMANTIC_PROFILE;
}

export function isRetiredDakSemanticProfile(profile: string): boolean {
  return (RETIRED_DAK_SEMANTIC_PROFILES as readonly string[]).includes(profile);
}

export function dakSemanticProfileIssueMessage(profile: string): string {
  return isRetiredDakSemanticProfile(profile)
    ? `当前 RivalHub 只接受 ${CURRENT_DAK_SEMANTIC_PROFILE}；${profile} 仅可读取历史，不能重新确认。`
    : `当前 RivalHub 只接受 ${CURRENT_DAK_SEMANTIC_PROFILE}。`;
}
