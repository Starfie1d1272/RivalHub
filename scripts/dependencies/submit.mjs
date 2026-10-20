import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** This entrypoint runs without pnpm or application imports in the write job. */
export async function submitSnapshot({ snapshot, sha, ref, eventName, repository, request }) {
  if (!["push", "schedule", "workflow_dispatch"].includes(eventName)
    || !/^[a-f0-9]{40}$/.test(sha) || ref !== "refs/heads/main"
    || !/^[\w.-]+\/[\w.-]+$/.test(repository)
    || snapshot.sha !== sha || snapshot.ref !== ref
    || snapshot.version !== 0
    || snapshot.job?.correlator !== "rivalhub-pnpm-lockfile"
    || snapshot.detector?.name !== "rivalhub-pnpm-lockfile"
    || Object.keys(snapshot.manifests ?? {}).join() !== "pnpm-lock.yaml"
    || snapshot.manifests["pnpm-lock.yaml"].file?.source_location !== "pnpm-lock.yaml"
    || !Object.keys(snapshot.manifests["pnpm-lock.yaml"].resolved ?? {}).length) {
    throw new Error("Submission requires a complete snapshot for the exact main source");
  }

  const base = `/repos/${repository}`;
  const current = await request("GET", `${base}/git/ref/heads/main`);
  if (current.object?.sha !== sha) throw new Error("Main advanced; submit a new snapshot from current main");

  const receipt = await request("POST", `${base}/dependency-graph/snapshots`, snapshot);
  if (!Number.isSafeInteger(receipt.id) || receipt.id <= 0
    || receipt.result !== "SUCCESS") {
    throw new Error("GitHub did not confirm the dependency graph update");
  }
  // ACCEPTED explicitly means no graph update. Even SUCCESS needs a full read-back.
  return { sourceSha: sha, sourceRef: ref, submissionId: receipt.id, result: receipt.result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [snapshotPath, receiptPath] = process.argv.slice(2);
  if (!snapshotPath || !receiptPath || !process.env.GH_TOKEN) throw new Error("Snapshot, receipt path and GH_TOKEN are required");
  const receipt = await submitSnapshot({
    snapshot: JSON.parse(readFileSync(snapshotPath, "utf8")),
    sha: process.env.GITHUB_SHA,
    ref: process.env.GITHUB_REF,
    eventName: process.env.GITHUB_EVENT_NAME,
    repository: process.env.GITHUB_REPOSITORY,
    request: async (method, path, body) => {
      const response = await fetch(`https://api.github.com${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${process.env.GH_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`GitHub ${method} failed with HTTP ${response.status}`);
      return response.json();
    },
  });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt));
}
