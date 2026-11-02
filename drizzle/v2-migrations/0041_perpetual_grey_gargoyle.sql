ALTER TABLE "conversion_policies" ADD COLUMN "source_note" text;--> statement-breakpoint
ALTER TABLE "conversion_policies" ADD COLUMN "rationale" text;--> statement-breakpoint
ALTER TABLE "conversion_policies" ADD COLUMN "change_summary" text;--> statement-breakpoint
ALTER TABLE "conversion_policies" ADD COLUMN "internal_note" text;--> statement-breakpoint
UPDATE "conversion_policies"
SET
  "source_note" = '2026 NJU Major 赛委会确认的 5E → Perfect World 等效换算标准。',
  "rationale" = '将 5E 竞技事实转换到 Perfect World 等效尺度，供赛事冻结后的跨平台竞技证据比较使用。',
  "change_summary" = '首个正式版本。',
  "internal_note" = NULL
WHERE "source_platform" = 'fivee'
  AND "target_platform" = 'perfect_world'
  AND "version" = '2026.09';
