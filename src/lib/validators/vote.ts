import { z } from "zod";
import { CAPTAIN_TEAM_COUNT } from "@/lib/captains/rules";

export const castVoteSchema = z.object({
  voterRegistrationId: z.guid(),
  candidateRegistrationId: z.guid(),
});

export const retractVoteSchema = z.object({
  voterRegistrationId: z.guid(),
  candidateRegistrationId: z.guid(),
});

export const confirmCaptainsSchema = z.object({
  seasonId: z.guid(),
  expectedCaptains: z
    .array(z.object({ registrationId: z.guid(), userId: z.guid() }))
    .length(CAPTAIN_TEAM_COUNT),
});

export type CastVoteInput = z.infer<typeof castVoteSchema>;
export type RetractVoteInput = z.infer<typeof retractVoteSchema>;
export type ConfirmCaptainsInput = z.infer<typeof confirmCaptainsSchema>;
