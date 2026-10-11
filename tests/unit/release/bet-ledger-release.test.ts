import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildReleasePlan } from "../../../scripts/release/plan";

// Frozen Production identity must prove each capability's reader separately.
it("keeps ledger reader-first independent of a shipped BP/catalog reader", () => {
  const dir = mkdtempSync(join(tmpdir(), "rivalhub-ledger-upgrade-"));
  const git = (args: string[]) => execFileSync("git", args, {cwd:dir,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  const commit = (message:string) => {git(["add","."]);git(["commit","--quiet","-m",message]);return git(["rev-parse","HEAD"]);};
  const contract = (name:string,readerVersion:number,publisherVersion:number) => writeFileSync(join(dir,`src/lib/bet/${name}-contract.json`),JSON.stringify({readerVersion,publisherVersion}));
  const build = (previousReleaseCommit:string,releaseSha:string) => buildReleasePlan({cwd:dir,previousReleaseCommit,releaseSha});
  try {
    git(["init","--quiet"]);git(["config","user.email","ledger-upgrade@example.invalid"]);git(["config","user.name","Ledger Upgrade Test"]);
    mkdirSync(join(dir,"src/lib/bet"),{recursive:true});writeFileSync(join(dir,"package.json"),"{}");
    contract("catalog",3,2);const bpReader=commit("BP reader only, no relief capability");
    contract("ledger",1,0);const reliefReader=commit("relief reader only");
    contract("ledger",1,1);const reliefPublisher=commit("relief publication");
    expect(()=>build(bpReader,reliefReader)).not.toThrow();
    expect(()=>build(bpReader,reliefPublisher)).toThrow(/BET ledger compatibility gate/);
    expect(()=>build(reliefReader,reliefPublisher)).not.toThrow();
    rmSync(join(dir,"src/lib/bet/ledger-contract.json"));const removedReader=commit("unsafe ledger capability removal");
    expect(()=>build(reliefPublisher,removedReader)).toThrow(/BET ledger compatibility gate/);
    contract("ledger",1,1);contract("catalog",3,3);const bpPublisher=commit("BP publication");
    expect(()=>build(bpReader,bpPublisher)).toThrow(/BET ledger compatibility gate/);
    expect(()=>build(reliefReader,bpPublisher)).not.toThrow();
    contract("ledger",0,1);const invalid=commit("malformed ledger capability");
    expect(()=>build(reliefReader,invalid)).toThrow(/BET ledger contract 无效/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
