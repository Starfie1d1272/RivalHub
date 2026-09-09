const SCHEDULER_SOURCES = [
  "supabase-primary",
  "github-watchdog",
  "github-manual",
  "super-admin-manual",
  "legacy",
] as const;

export type SchedulerSource = (typeof SCHEDULER_SOURCES)[number];

export const SCHEDULER_JOB_KEYS = [
  "draft-timeout",
  "check-registration-deadline",
  "match-time-auto-award",
  "cleanup-education-evidence",
] as const;

export const SCHEDULER_JOB_DEFINITIONS = [
  {
    key: SCHEDULER_JOB_KEYS[0],
    label: "选秀超时处理",
    primaryCron: "* * * * *",
    staleAfterMs: 3 * 60 * 1000,
  },
  {
    key: SCHEDULER_JOB_KEYS[1],
    label: "报名状态推进",
    primaryCron: "* * * * *",
    staleAfterMs: 3 * 60 * 1000,
  },
  {
    key: SCHEDULER_JOB_KEYS[2],
    label: "比赛时间自动裁定",
    primaryCron: "*/5 * * * *",
    staleAfterMs: 15 * 60 * 1000,
  },
  {
    key: SCHEDULER_JOB_KEYS[3],
    label: "教育凭证清理",
    // 06:00 Asia/Shanghai, persisted as UTC because pg_cron uses UTC.
    primaryCron: "0 22 * * *",
    staleAfterMs: 36 * 60 * 60 * 1000,
  },
] as const;

export type SchedulerJobKey = (typeof SCHEDULER_JOB_DEFINITIONS)[number]["key"];
export type SchedulerJobDefinition = (typeof SCHEDULER_JOB_DEFINITIONS)[number];

const definitionsByKey = new Map<SchedulerJobKey, SchedulerJobDefinition>(
  SCHEDULER_JOB_DEFINITIONS.map((definition) => [definition.key, definition]),
);

export function getSchedulerJobDefinition(key: string): SchedulerJobDefinition | undefined {
  return definitionsByKey.get(key as SchedulerJobKey);
}

export function getSchedulerRoute(key: SchedulerJobKey): string {
  return `/api/cron/${key}`;
}

export function isSchedulerSource(value: string | null): value is SchedulerSource {
  return value !== null && (SCHEDULER_SOURCES as readonly string[]).includes(value);
}

export function schedulerJobName(key: SchedulerJobKey): string {
  return `rivalhub-${key}`;
}
