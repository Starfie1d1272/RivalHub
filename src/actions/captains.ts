"use server";

// TODO: cast a captain vote (max 3 per voter per season)
export async function castVote(_voterRegistrationId: string, _candidateRegistrationId: string): Promise<void> {
  throw new Error("not implemented");
}

// TODO: retract a captain vote
export async function retractVote(_voterRegistrationId: string, _candidateRegistrationId: string): Promise<void> {
  throw new Error("not implemented");
}
