/** Freeze the pre-match observation time without assuming a schedule exists. */
export function broadcastStatsCutoff(startedAt: Date | null, scheduledAt: Date | null, generatedAt: Date) {
  if (startedAt) return { cutoffAt: startedAt, cutoffSource: "startedAt" as const };
  if (scheduledAt && scheduledAt < generatedAt) return { cutoffAt: scheduledAt, cutoffSource: "scheduledAt" as const };
  return { cutoffAt: generatedAt, cutoffSource: "generatedAt" as const };
}
