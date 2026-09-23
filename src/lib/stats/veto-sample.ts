export type VetoSampleState = "recorded" | "missing" | "not_applicable";

export function classifyVetoSample(
  match: { isForfeit: boolean | null },
  hasRecordedVeto: boolean,
): VetoSampleState {
  if (hasRecordedVeto) return "recorded";
  if (match.isForfeit) return "not_applicable";
  return "missing";
}
