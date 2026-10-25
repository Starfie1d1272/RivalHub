import { existsSync, lstatSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { ARTIFACT_LIMITS, artifactEntries, copySafeTree, createArtifactBudget, readArtifactText, writeArtifactText } from "./system-artifact-sanitizer.mjs";

const root = process.cwd();
const temporary = resolve(root, ".agent-tmp");
// Never follow a replaced workspace directory into unrelated files.
if (existsSync(temporary) && (lstatSync(temporary).isSymbolicLink() || !lstatSync(temporary).isDirectory())) throw new Error("Unsafe artifact workspace directory.");
const destination = resolve(temporary, "system-artifacts");
const attemptsDirectory = resolve(process.env.RIVALHUB_E2E_ARTIFACT_DIR ?? resolve(temporary, "e2e-attempts"));
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
const budget = createArtifactBudget();

// Prioritize bounded recent diagnostics before optional report assets.
for (const [source, target] of [["next-server.log", "next-server.safe.log"], ["e2e-exit-boundary.jsonl", "e2e-exit-boundary.safe.jsonl"]]) {
  const content = readArtifactText(resolve(temporary, source), budget, { tail: true });
  if (content !== undefined) writeArtifactText(resolve(destination, target), content, budget);
}

const attempts = readAttemptRecords(attemptsDirectory);
writeArtifactText(resolve(destination, "e2e-attempts.json"), `${JSON.stringify({
  attempts,
  retryCount: attempts.filter((attempt) => attempt.retry > 0).length,
  flakyCount: attempts.filter((attempt) => attempt.retry > 0 && attempt.status === "passed").length,
}, null, 2)}\n`, budget);

copySafeTree(resolve(root, "test-results"), resolve(destination, "test-results"), false, { allowFailureScreenshots: true, budget });
copySafeTree(resolve(root, "playwright-report"), resolve(destination, "playwright-report"), true, { budget });
const summary = `${JSON.stringify({ limits: ARTIFACT_LIMITS, ...budget }, null, 2)}\n`;
if (Buffer.byteLength(summary) > ARTIFACT_LIMITS.summaryReserveBytes) throw new Error("Artifact summary exceeded its reserved budget.");
writeFileSync(resolve(destination, "sanitization-summary.json"), summary, "utf8");

function readAttemptRecords(directory) {
  const records = [];
  for (const entry of artifactEntries(directory, budget)) {
    if (entry.directory || !entry.name.endsWith(".attempt.json")) continue;
    try {
      const content = readArtifactText(entry.path, budget);
      if (content === undefined) continue;
      const value = JSON.parse(content);
      if (!value || typeof value !== "object" || typeof value.scenarioId !== "string") continue;
      records.push({
        scenarioId: value.scenarioId,
        profile: typeof value.profile === "string" ? value.profile : "unknown",
        project: typeof value.project === "string" ? value.project : "unknown",
        retry: Number.isInteger(value.retry) ? value.retry : 0,
        repeatEachIndex: Number.isInteger(value.repeatEachIndex) ? value.repeatEachIndex : 0,
        status: typeof value.status === "string" ? value.status : "unknown",
        expectedStatus: typeof value.expectedStatus === "string" ? value.expectedStatus : "unknown",
        durationMs: Number.isFinite(value.durationMs) ? value.durationMs : 0,
      });
    } catch {
      budget.skipped.invalidAttempt = (budget.skipped.invalidAttempt ?? 0) + 1;
    }
  }
  return records;
}

console.log(`Prepared safe system artifacts: ${relative(root, destination)}; attempts=${attempts.length}.`);
