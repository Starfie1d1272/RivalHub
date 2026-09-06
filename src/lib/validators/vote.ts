import { z } from "zod";

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
});

export type CastVoteInput = z.infer<typeof castVoteSchema>;
export type RetractVoteInput = z.infer<typeof retractVoteSchema>;
export type ConfirmCaptainsInput = z.infer<typeof confirmCaptainsSchema>;
