import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { commandArgs, checkIdentity, executionEnvironment, parseReport, runBatch, validateCursor, validateIdentity, validateInputs } from "../../../scripts/operations/statistics-transport.mjs";

const sha = "a".repeat(40);
const identity = { releaseTag: "v2.25.4", releaseCommit: sha };
const cursor = Buffer.from(JSON.stringify({ completedAt: "2026-10-31 01:02:03.123456+00", importId: "12345678-1234-4234-8234-123456789012" })).toString("base64url");
const report = { target: "production", mode: "apply", scanned: 2, encoded: 1, already: 1, legacy_retained: 0,
  not_current: 0, invalid: 0, originalBytes: 100, encodedBytes: 20, complete: false, nextCursor: null };
const response = (value = identity) => async () => ({ ok: true, json: async () => value });

describe("protected statistics transport orchestration", () => {
  it("accepts only bounded inputs and preserves microsecond cursor verbatim", () => {
    assert.equal(validateCursor(cursor), cursor);
    assert.equal(validateInputs({ mode: "apply", limit: "150", cursor }).cursor, cursor);
    for (const bad of ["", "0", "151", "1;touch /tmp/x", "01", "999999"]) assert.throws(() => validateInputs({ mode: "apply", limit: bad }));
    assert.throws(() => validateInputs({ mode: "dry", limit: "501" }));
    assert.throws(() => validateInputs({ mode: "other", limit: "1" }));
    for (const bad of ["abc=", cursor + "=", "A".repeat(513), Buffer.from(JSON.stringify({ completedAt: "bad", importId: "x" })).toString("base64url"), Buffer.from(JSON.stringify({ completedAt: "2026-01-01T00:00:00Z", importId: "12345678-1234-4234-8234-123456789012", extra: 1 })).toString("base64url")]) assert.throws(() => validateCursor(bad));
  });
  it("constructs fixed arguments and limits write authorization to apply", () => {
    const dry = validateInputs({ mode: "dry", limit: "500", cursor: "" });
    const apply = validateInputs({ mode: "apply", limit: "150", cursor });
    const firstApply = validateInputs({ mode: "apply", limit: "150", cursor: "" });
    assert.equal(commandArgs(firstApply).includes("--cursor"), false);
    assert.deepEqual(commandArgs(dry), ["exec", "tsx", "scripts/db/production-stats-projections.ts", "transport-backfill", "--limit", "500"]);
    assert.deepEqual(commandArgs(apply).slice(-5), ["--apply", "--limit", "150", "--cursor", cursor]);
    const env = { RIVALHUB_ALLOW_REMOTE_DB_WRITE: "production", RIVALHUB_STATS_PROJECTION_WRITE_CONFIRM: "yes", GITHUB_TOKEN: "secret" };
    assert.equal(executionEnvironment(env, "dry").RIVALHUB_ALLOW_REMOTE_DB_WRITE, undefined);
    assert.equal(executionEnvironment(env, "dry").RIVALHUB_STATS_PROJECTION_WRITE_CONFIRM, undefined);
    assert.equal(executionEnvironment(env, "apply").RIVALHUB_STATS_PROJECTION_WRITE_CONFIRM, "I_UNDERSTAND_STATS_PROJECTION_WRITE");
    assert.equal(executionEnvironment(env, "apply").GITHUB_TOKEN, undefined);
  });
  it("checks strict identity, tag, ancestry and deployed package version", () => {
    assert.throws(() => validateIdentity({ ...identity, extra: "x" }));
    assert.throws(() => validateIdentity({ ...identity, releaseCommit: "oops" }));
    const runGit = args => args[0] === "rev-parse" ? sha : args[0] === "show" ? '{"version":"2.25.4"}' : "";
    checkIdentity(identity, sha, runGit);
    assert.throws(() => checkIdentity(identity, sha, args => args[0] === "rev-parse" ? "b".repeat(40) : ""));
    assert.throws(() => checkIdentity(identity, sha, args => args[0] === "rev-parse" ? sha : args[0] === "show" ? '{"version":"2.25.3"}' : ""));
    assert.throws(() => checkIdentity(identity, sha, args => { if (args[0] === "merge-base") throw new Error("not compatible"); return sha; }));
  });
  it("reports partial and invalid outcomes with a safe recovery cursor", async () => {
    const input = validateInputs({ mode: "apply", limit: "2", cursor });
    const parsed = parseReport(JSON.stringify({ ...report, secret: "must not be retained" }), input);
    assert.equal(parsed.resumeCursor, cursor);
    assert.equal(parsed.complete, false);
    assert.equal("secret" in parsed, false);
    assert.throws(() => parseReport(JSON.stringify({ ...report, nextCursor: "" }), input));
    assert.throws(() => parseReport(JSON.stringify({ ...report, scanned: 3 }), input));
    const args = { input, expected: identity, operatorSha: sha, worktree: "/fixture", env: { DATABASE_URL: "private" }, fetcher: response(), runGit: () => sha };
    let calls = 0;
    const result = await runBatch({ ...args, spawn: () => { calls++; return { status: 1, stdout: JSON.stringify({ ...report, invalid: 1 }), stderr: "private sql payload" }; } });
    assert.equal(result.failed, true);
    assert.equal(result.summary.invalid, 1);
    assert.doesNotMatch(JSON.stringify(result), /private|payload/);
    await assert.rejects(runBatch({ ...args, fetcher: response({ ...identity, releaseCommit: "b".repeat(40) }), spawn: () => { calls++; } }));
    assert.equal(calls, 1);
    await assert.rejects(runBatch({ ...args, spawn: () => ({ status: 1, stdout: "private sql payload" }) }), /without a valid report/);
  });
});
