import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function assertTrustedReceipt(run: { event: string; path: string }, receipt: { result: string; sha: string; ref: string }, expected: { sha: string; ref: string }): void {
  if (run.event !== "pull_request_target" || run.path !== ".github/workflows/dependency-graph-untrusted.yml") {
    throw new Error("Dependency receipt was not produced by the trusted default-branch workflow");
  }
  const accepted = receipt.result === "SUCCESS" || (receipt.result === "ACCEPTED" && expected.ref.startsWith("refs/pull/"));
  if (!accepted || receipt.sha !== expected.sha || receipt.ref !== expected.ref) {
    throw new Error("Dependency receipt does not match the exact PR head/ref");
  }
}

interface Artifact { name: string; expired: boolean; workflow_run: { id: number } }

async function awaitSubmission(): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY;
  const sha = process.env.DEPENDENCY_HEAD_SHA ?? "";
  const ref = process.env.DEPENDENCY_HEAD_REF ?? "";
  if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(sha) || !/^refs\/pull\/\d+\/head$/.test(ref)) {
    throw new Error("Trusted receipt lookup requires exact repository, PR SHA and ref");
  }
  const name = `dependency-submission-${sha}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { artifacts } = JSON.parse(execFileSync("gh", ["api", "--method", "GET", `repos/${repository}/actions/artifacts`, "-f", `name=${name}`, "-f", "per_page=100"], { encoding: "utf8" })) as { artifacts: Artifact[] };
    for (const artifact of artifacts) {
      if (artifact.name !== name || artifact.expired) continue;
      const run = JSON.parse(execFileSync("gh", ["api", `repos/${repository}/actions/runs/${artifact.workflow_run.id}`], { encoding: "utf8" })) as { event: string; path: string };
      // A PR run can forge the artifact name, but not the trusted event/path.
      if (run.event !== "pull_request_target" || run.path !== ".github/workflows/dependency-graph-untrusted.yml") continue;
      const destination = mkdtempSync(join(tmpdir(), "rivalhub-dependency-receipt-"));
      try {
        execFileSync("gh", ["run", "download", String(artifact.workflow_run.id), "--repo", repository, "--name", name, "--dir", destination], { stdio: "pipe" });
        const receipt = JSON.parse(readFileSync(join(destination, "dependency-submission.json"), "utf8"));
        assertTrustedReceipt(run, receipt, { sha, ref });
        console.log(`Trusted dependency submission verified for ${sha} (${ref})`);
        return;
      } finally {
        rmSync(destination, { recursive: true, force: true });
      }
    }
    if (attempt < 4) {
      console.log("Waiting for trusted dependency metadata submission (60 seconds)");
      await new Promise(resolve => setTimeout(resolve, 60_000));
    }
  }
  throw new Error("No trusted exact-head dependency receipt within four minutes; inspect Trusted dependency graph for untrusted PR, then rerun CI");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await awaitSubmission();
}
