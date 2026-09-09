import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { copySafeTree, redact } from "./system-artifact-sanitizer.mjs";

const root = process.cwd();
const destination = resolve(root, ".agent-tmp", "system-artifacts");
const attemptsDirectory = resolve(process.env.RIVALHUB_E2E_ARTIFACT_DIR ?? resolve(root, ".agent-tmp", "e2e-attempts"));
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });

const attempts = readAttemptRecords(attemptsDirectory);
writeFileSync(resolve(destination, "e2e-attempts.json"), `${JSON.stringify({
  attempts,
  retryCount: attempts.filter((attempt) => attempt.retry > 0).length,
  flakyCount: attempts.filter((attempt) => attempt.retry > 0 && attempt.status === "passed").length,
}, null, 2)}\n`, "utf8");

copySafeTree(resolve(root, "test-results"), resolve(destination, "test-results"), false);
copySafeTree(resolve(root, "playwright-report"), resolve(destination, "playwright-report"), true);

const nextLog = resolve(root, ".agent-tmp", "next-server.log");
if (existsSync(nextLog)) {
  const safeLog = redact(readFileSync(nextLog, "utf8")).split("\n").slice(-2_000).join("\n");
  writeFileSync(resolve(destination, "next-server.safe.log"), safeLog, "utf8");
}

function readAttemptRecords(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".attempt.json"))
    .flatMap((name) => {
      try {
        const value = JSON.parse(readFileSync(resolve(directory, name), "utf8"));
        if (!value || typeof value !== "object" || typeof value.scenarioId !== "string") return [];
        return [{
          scenarioId: value.scenarioId,
          project: typeof value.project === "string" ? value.project : "unknown",
          retry: Number.isInteger(value.retry) ? value.retry : 0,
          repeatEachIndex: Number.isInteger(value.repeatEachIndex) ? value.repeatEachIndex : 0,
          status: typeof value.status === "string" ? value.status : "unknown",
          expectedStatus: typeof value.expectedStatus === "string" ? value.expectedStatus : "unknown",
          durationMs: Number.isFinite(value.durationMs) ? value.durationMs : 0,
        }];
      } catch {
        return [];
      }
    });
}

console.log(`Prepared safe system artifacts: ${relative(root, destination)}; attempts=${readAttemptRecords(attemptsDirectory).length}.`);
