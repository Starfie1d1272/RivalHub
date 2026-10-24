"use server";
import { getTelemetryAnalysis } from "@/lib/telemetry/dashboard";
export async function getTelemetryAnalysisAction(input: unknown) {
  return getTelemetryAnalysis(input);
}
