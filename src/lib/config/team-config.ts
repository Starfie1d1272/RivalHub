import { z } from "zod";

export const MIN_TEAM_NAME_LENGTH = 2;
export const MAX_TEAM_NAME_LENGTH = 32;
export const teamNameSchema = z.string().trim().min(MIN_TEAM_NAME_LENGTH).max(MAX_TEAM_NAME_LENGTH);
