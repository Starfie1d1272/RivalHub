"use client";

import { toCSTDateTimeInput } from "@/lib/utils/date";
import { updateMatchCompletionDeadline as telemetry_updateMatchCompletionDeadline } from "@/actions/matches";
import { setMatchScheduledAt as telemetry_updateMatchScheduledAt } from "@/actions/matches/scheduling";
import { observeAction } from "@/lib/telemetry/client";
import { MatchDateEditor } from "./MatchDateEditor";

const updateMatchCompletionDeadline = observeAction(
  "matches.updateMatchCompletionDeadline",
  telemetry_updateMatchCompletionDeadline,
);
const updateMatchScheduledAt = observeAction(
  "matches.updateMatchScheduledAt",
  telemetry_updateMatchScheduledAt,
);

interface ScheduledAtInputProps {
  matchId: string;
  currentScheduledAt: Date | null;
  currentCompletionDeadline: Date | null;
  canEditScheduledAt: boolean;
}

export function ScheduledAtInput({
  matchId,
  currentScheduledAt,
  currentCompletionDeadline,
  canEditScheduledAt,
}: ScheduledAtInputProps) {
  return (
    <div className="space-y-4">
      {canEditScheduledAt ? (
        <MatchDateEditor
          key={`${matchId}-schedule`}
          label="开赛时间"
          initialValue={toCSTDateTimeInput(currentScheduledAt)}
          update={({ date }) => updateMatchScheduledAt(matchId, date)}
        />
      ) : (
        <p className="text-sm text-[var(--color-fg-secondary)]">比赛已开始，开赛时间已锁定。</p>
      )}
      <MatchDateEditor
        key={`${matchId}-deadline`}
        label="最晚完成时间"
        initialValue={toCSTDateTimeInput(currentCompletionDeadline)}
        update={({ date }) => updateMatchCompletionDeadline(matchId, date)}
        help="计划开赛须为未来时间，且不晚于最晚完成时间。首次提议满 24 小时且距开赛至少 2 小时才可自动采纳。"
      />
    </div>
  );
}
