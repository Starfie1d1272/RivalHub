import { readFileSync } from "node:fs";

const row = JSON.parse(readFileSync(process.argv[2], "utf8")).workflow_runs?.[0];
const now = process.argv[3] ? Date.parse(process.argv[3]) : Date.now();
const started = Date.parse(row?.run_started_at ?? "");
const ageHours = (now - started) / 3_600_000;
if (row?.conclusion !== "success" || !Number.isFinite(ageHours) || ageHours < 0) {
  throw new Error("Latest verified production backup identity is unavailable.");
}
console.log(JSON.stringify({ backupRunId: row.id, snapshotAgeHours: Math.round(ageHours * 100) / 100 }));
if (ageHours > 24) throw new Error("Latest verified production backup is older than 24 hours.");
