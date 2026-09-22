import { z } from "zod";

export const FEEDBACK_BODY_MAX_LENGTH = 4000;

export const FEEDBACK_CATEGORY_LABELS = {
  problem: "遇到问题",
  question: "使用疑问",
  feature_suggestion: "功能建议",
  content_correction: "内容纠错",
  other: "其他反馈",
} as const;

export const FEEDBACK_STATUS_LABELS = {
  new: "待处理",
  triaged: "处理中",
  resolved: "已处理",
} as const;

export const feedbackCategorySchema = z.enum([
  "problem",
  "question",
  "feature_suggestion",
  "content_correction",
  "other",
]);

export type FeedbackCategory = z.infer<typeof feedbackCategorySchema>;
export type FeedbackStatus = keyof typeof FEEDBACK_STATUS_LABELS;

export function feedbackCategoryLabel(category: FeedbackCategory): string {
  return FEEDBACK_CATEGORY_LABELS[category];
}

export function feedbackStatusLabel(status: FeedbackStatus): string {
  return FEEDBACK_STATUS_LABELS[status];
}

/** Only a same-site pathname is accepted; query/hash/context dumps are excluded. */
export function safePublicPathname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const pathname = value.trim();
  if (!pathname.startsWith("/") || pathname.startsWith("//") || pathname.includes("?") || pathname.includes("#")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(pathname)) return null;
  return pathname.length <= 512 ? pathname : null;
}

export function normalizeFeedbackBody(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
