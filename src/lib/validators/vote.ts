import { z } from "zod";

// TODO: 完善校验（每人最多 3 票的应用层限制在 Server Action 中附加校验）

export const castVoteSchema = z.object({
  voterRegistrationId: z.string().uuid(),
  candidateRegistrationId: z.string().uuid(),
});

export const retractVoteSchema = z.object({
  voterRegistrationId: z.string().uuid(),
  candidateRegistrationId: z.string().uuid(),
});

export type CastVoteInput = z.infer<typeof castVoteSchema>;
export type RetractVoteInput = z.infer<typeof retractVoteSchema>;
