import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadLayerManifest } from "../standby/layers.mjs";

const env = process.env;
const sha = /^[a-f0-9]{40}$/;
const releaseTag = /^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/;
const positiveInteger = /^[1-9]\d*$/;
const runNumbers = [env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT, env.RIVALHUB_RELEASE_CI_RUN_ID, env.RIVALHUB_RELEASE_CI_RUN_ATTEMPT];
const schemaResults = [env.RIVALHUB_MIGRATION_REHEARSAL, env.RIVALHUB_MIGRATION_APPLY, env.RIVALHUB_CHECKPOINT_RESULT];
if (
  !sha.test(env.RELEASE_SHA) || !sha.test(env.RIVALHUB_PREVIOUS_RELEASE_COMMIT) || !sha.test(env.RIVALHUB_RELEASE_OPERATOR_SHA) ||
  !releaseTag.test(env.RELEASE_TAG) || !releaseTag.test(env.RIVALHUB_PREVIOUS_RELEASE_TAG) ||
  !runNumbers.every(value => positiveInteger.test(value) && Number.isSafeInteger(Number(value))) ||
  !schemaResults.every(value => ["success", "skipped"].includes(value)) ||
  !["none", "db-only", "full"].includes(env.RIVALHUB_CHECKPOINT_KIND) ||
  !["fresh", "resume"].includes(env.RELEASE_MODE) ||
  !["verified", "mismatch", "unavailable"].includes(env.RIVALHUB_DEPENDENCY_READBACK)
) throw new Error("Invalid release evidence identity.");

const digest = file => createHash("sha256").update(readFileSync(file)).digest("hex");
const directory = ".agent-tmp/standby-production-package";
let artifact = null;
if (env.RELEASE_MODE === "fresh") {
  const names = readdirSync(directory).filter(name => /^rivalhub-production-[a-f0-9]{40}-[a-f0-9]{12}\.layers\.json$/.test(name));
  if (names.length !== 1) throw new Error("Expected one verified layered production manifest.");
  const file = join(directory, names[0]);
  const bundle = loadLayerManifest(file);
  if (bundle.sourceCommit !== env.RELEASE_SHA || bundle.releaseTag !== env.RELEASE_TAG ||
      bundle.operatorCommit !== env.RIVALHUB_RELEASE_OPERATOR_SHA) {
    throw new Error("Release evidence package identity mismatch.");
  }
  artifact = {
    manifestSha256: digest(file),
    configurationSha256: bundle.configurationSha256,
    bundleTreeSha256: bundle.bundleTreeSha256,
    layers: bundle.layers.map(({ kind, bytes, sha256, treeSha256 }) => ({ kind, bytes, sha256, treeSha256 })),
  };
}

const evidence = {
  format: 1,
  candidate: { tag: env.RELEASE_TAG, commit: env.RELEASE_SHA },
  previous: { tag: env.RIVALHUB_PREVIOUS_RELEASE_TAG, commit: env.RIVALHUB_PREVIOUS_RELEASE_COMMIT },
  workflow: {
    runId: Number(env.GITHUB_RUN_ID),
    attempt: Number(env.GITHUB_RUN_ATTEMPT),
    operatorCommit: env.RIVALHUB_RELEASE_OPERATOR_SHA,
    exactCandidateCiRunId: Number(env.RIVALHUB_RELEASE_CI_RUN_ID),
    exactCandidateCiAttempt: Number(env.RIVALHUB_RELEASE_CI_RUN_ATTEMPT),
  },
  promotion: env.RELEASE_MODE === "fresh" ? "verified" : "verified_existing",
  scheduler: env.REQUIRES_SCHEDULER_PROVISION === "true" ? "verified" : "not_required",
  dependencies: { lockfileSha256: digest("pnpm-lock.yaml"), githubSbom: env.RIVALHUB_DEPENDENCY_READBACK },
  migration: {
    rehearsal: env.RIVALHUB_MIGRATION_REHEARSAL,
    apply: env.RIVALHUB_MIGRATION_APPLY,
    checkpoint: { kind: env.RIVALHUB_CHECKPOINT_KIND, result: env.RIVALHUB_CHECKPOINT_RESULT },
  },
  artifact,
};
writeFileSync(process.argv[2], JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
