import { z } from "zod";

export const castVoteSchema = z.object({
  voterRegistrationId: z.string().uuid(),
  candidateRegistrationId: z.string().uuid(),
});

export const retractVoteSchema = z.object({
  voterRegistrationId: z.string().uuid(),
  candidateRegistrationId: z.string().uuid(),
});

export const confirmCaptainsSchema = z.object({
  seasonId: z.string().uuid(),
});

export type CastVoteInput = z.infer<typeof castVoteSchema>;
export type RetractVoteInput = z.infer<typeof retractVoteSchema>;
export type ConfirmCaptainsInput = z.infer<typeof confirmCaptainsSchema>;
