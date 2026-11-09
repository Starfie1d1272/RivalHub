"use client";

import { updateMatchCompletedAt as telemetry_updateMatchCompletedAt } from "@/actions/matches";
import { observeAction } from "@/lib/telemetry/client";
import { MatchDateEditor } from "./MatchDateEditor";

const updateMatchCompletedAt = observeAction(
  "matches.updateMatchCompletedAt",
  telemetry_updateMatchCompletedAt,
);

export function CompletedAtInput({
  matchId,
  initialValue,
}: {
  matchId: string;
  initialValue: string | null;
}) {
  return (
    <MatchDateEditor
      key={matchId}
      label="实际完成时间"
      initialValue={initialValue}
      update={({ value }) => updateMatchCompletedAt(matchId, value)}
    />
  );
}
