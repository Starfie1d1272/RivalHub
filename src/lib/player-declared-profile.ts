import { z } from "zod";

export const GAMEPLAY_STYLE_MAX_LENGTH = 100;
export const COMPETITION_HISTORY_MAX_LENGTH = 500;

export const playerDeclaredProfileSchema = z.object({
  gameplayStyle: z
    .string()
    .trim()
    .max(GAMEPLAY_STYLE_MAX_LENGTH, `游戏风格自述不超过 ${GAMEPLAY_STYLE_MAX_LENGTH} 字`),
  competitionHistory: z
    .string()
    .trim()
    .max(COMPETITION_HISTORY_MAX_LENGTH, `历史比赛经历不超过 ${COMPETITION_HISTORY_MAX_LENGTH} 字`)
    .optional(),
});

export const requiredPlayerDeclaredProfileSchema = playerDeclaredProfileSchema.extend({
  gameplayStyle: z
    .string()
    .trim()
    .min(1, "请填写游戏风格自述")
    .max(GAMEPLAY_STYLE_MAX_LENGTH, `游戏风格自述不超过 ${GAMEPLAY_STYLE_MAX_LENGTH} 字`),
});

export interface PlayerDeclaredProfile {
  gameplayStyle: string | null;
  competitionHistory: string | null;
}

export function normalizePlayerDeclaredProfile(input: {
  gameplayStyle?: string | null;
  competitionHistory?: string | null;
}): PlayerDeclaredProfile {
  const normalize = (value: string | null | undefined) => {
    const trimmed = value?.trim() ?? "";
    return trimmed || null;
  };

  return {
    gameplayStyle: normalize(input.gameplayStyle),
    competitionHistory: normalize(input.competitionHistory),
  };
}
