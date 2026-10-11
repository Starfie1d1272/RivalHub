import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildReleasePlan } from "../../../scripts/release/plan";

// Actual frozen commit contracts prove both release stages together, never ancestry alone.
it("allows the three compatible readers together, but requires that shipped baseline before either second-stage producer", () => {
  const cwd = mkdtempSync(join(tmpdir(), "rivalhub-veto-upgrade-"));
  const git = (args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const commit = () => { git(["add", "."]); git(["commit", "--quiet", "-m", "capability fixture"]); return git(["rev-parse", "HEAD"]); };
  const write = (path: string, value: unknown) => { mkdirSync(join(cwd, path, ".."), { recursive: true }); writeFileSync(join(cwd, path), JSON.stringify(value)); };
  const build = (previousReleaseCommit: string, releaseSha: string) => buildReleasePlan({ cwd, previousReleaseCommit, releaseSha });
  try {
    git(["init", "--quiet"]); git(["config", "user.email", "veto@example.invalid"]); git(["config", "user.name", "Veto Upgrade Test"]);
    write("package.json", {}); write("src/lib/bet/catalog-contract.json", { readerVersion: 2, publisherVersion: 2 });
    const production = commit();
    const lifecyclePath = "src/lib/matches/veto-room/lifecycle-contract.json";
    write(lifecyclePath, { readerVersion: 1, publisherVersion: 0 });
    write("src/lib/bet/ledger-contract.json", { readerVersion: 1, publisherVersion: 0 });
    write("src/lib/bet/catalog-contract.json", { readerVersion: 2, publisherVersion: 2, capabilities: { bo3BpPresence: { readerVersion: 1, publisherVersion: 0 } } });
    const readers = commit();
    expect(() => build(production, readers)).not.toThrow();
    write(lifecyclePath, { readerVersion: 1, publisherVersion: 1 });
    const vetoProducer = commit();
    expect(() => build(production, vetoProducer)).toThrow(/Veto lifecycle compatibility gate/);
    expect(() => build(readers, vetoProducer)).not.toThrow();
    write("src/lib/bet/catalog-contract.json", { readerVersion: 2, publisherVersion: 2, capabilities: { bo3BpPresence: { readerVersion: 1, publisherVersion: 1 } } });
    write("src/lib/bet/ledger-contract.json", { readerVersion: 1, publisherVersion: 1 });
    const secondStage = commit();
    expect(() => build(readers, secondStage)).not.toThrow();
    rmSync(join(cwd, lifecyclePath)); const unsafeRemoval = commit();
    expect(() => build(secondStage, unsafeRemoval)).toThrow(/Veto lifecycle compatibility gate/);
    write(lifecyclePath, { readerVersion: 0, publisherVersion: 1 }); const malformed = commit();
    expect(() => build(readers, malformed)).toThrow(/Veto lifecycle contract 无效/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
