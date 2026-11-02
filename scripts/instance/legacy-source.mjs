import { readFileSync, realpathSync } from "node:fs";

// Only called by the locked major transaction against systemd's actual MainPID.
// Compare secrets in memory; emit only the public identity used by recovery.
const [pid, current, tag, commit] = process.argv.slice(2);
if (!/^[1-9][0-9]*$/.test(pid ?? "") || realpathSync(`/proc/${pid}/cwd`) !== realpathSync(current)
  || realpathSync(`/proc/${pid}/exe`) !== realpathSync(`${current}/runtime/node`)) throw Error("Legacy process identity mismatch.");
const entries = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").filter(Boolean);
const values = new Map();
for (const entry of entries) { const i = entry.indexOf("="); if (i > 0) { const key = entry.slice(0, i); if (values.has(key)) throw Error("Duplicate process environment key."); values.set(key, entry.slice(i + 1)); } }
for (const key of ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "RIVALHUB_RELEASE_TAG", "RIVALHUB_RELEASE_COMMIT", "GIT_COMMIT_SHA"]) {
  if (!process.env[key] || values.get(key) !== process.env[key]) throw Error("Legacy process and preserved environment differ.");
}
if (values.get("RIVALHUB_RELEASE_TAG") !== tag || values.get("RIVALHUB_RELEASE_COMMIT") !== commit || values.get("GIT_COMMIT_SHA") !== commit) throw Error("Legacy process release identity mismatch.");
const db = new URL(values.get("DATABASE_URL"));
console.log(JSON.stringify({ databaseName: decodeURI(db.pathname.slice(1)), releaseTag: tag, releaseCommit: commit, supabaseUrl: values.get("NEXT_PUBLIC_SUPABASE_URL") }));
