# Linux release writer inventory

The release coordinator runs these bounded read-only checks immediately before
normal finalize, while previous identity is healthy. Installer stop/drain follows
identity checks. This checklist changes no credential, grant, schedule or host.
Keep output private; never publish argv, environment, cron bodies or SQL text.

| Repository source | Boundary / disposition |
| --- | --- |
| Actions, Mizar, identity merge and domain HTTP writes | Installer stops the complete `rivalhub-production` unit. |
| pg_cron / Actions watchdog | `cron.yml` sends HTTP wake-ups; stopped service prevents business execution. |
| Migration, competitive-profile repair apply, Steam backfill apply, stats-projection backfill apply | Current release prerequisites must finish before finalize; no second run/terminal may execute these protected wrappers. |
| Scheduler provision/verify | The current release runs this **after** candidate identity succeeds, from its immutable source. Hold independent/old-source provision calls; do not demand this post-deploy step finish before finalize. |
| Manual psql, import, recovery restore, custom script | Record owner, host, PID/run; finish/stop through its existing owner and hold admission closed. |
| Backup, verify, coverage, Steam remediation, identity-merge-preflight | Read-only but may hold transactions; finish conflicting work before outage. |

`db:production:identity-merge-preflight` is read-only; package.json has no canonical
standalone identity-merge apply CLI. Do not invent such a writer. Finalize's
production-state concurrency group is conditional on scheduler provisioning;
do not assume it excludes every backup when provisioning is unnecessary.

## Actions snapshot

From the authorized coordinator checkout, run once per state. Any API/auth error
or `total_count > 100` means incomplete evidence and blocks the window. Compare
production runs against the current release run ID; queued/waiting work also
needs an owner-held stop window. Never cancel a run by name guessing.

```sh
for state in in_progress queued waiting requested pending; do
  timeout 15s gh api "repos/Starfie1d1272/RivalHub/actions/runs?status=$state&per_page=100" \
    --jq 'if .total_count > 100 then error("Incomplete writer inventory: more than 100 runs") else {total_count,runs:[.workflow_runs[]|{id,path,status,head_sha}]} end' || exit 1
done
```

Inspect an attributed run with `timeout 15s gh run view RUN_ID --json status,jobs`.
Current migration/repair/backfill jobs must be success or legitimately skipped.
Have another writer's owner finish/cancel through normal control, then repeat
the snapshot after that transition. Cancellation is not DB rollback evidence;
the installer's drain is still required.

## Host snapshot

Run on the existing host and every separately declared operator/worker host.
This prints no argv or environment values. Expected unit-owned processes are
listed separately. Exit 2 means outside candidate or unreadable metadata, and
blocks an unqualified clear result; do not hide it with an automatic allowlist.

```sh
timeout 10s python3 - <<'PY'
import json, os
from pathlib import Path
outside, unreadable, unit = [], [], []
tools = ('production.ts', 'production-competitive-profile-repair.ts',
         'production-steam-profile-backfill.ts', 'production-stats-projections.ts',
         'scheduler.ts', 'run-server-cli.ts', 'restore.ts')
for p in Path('/proc').iterdir():
    if not p.name.isdigit() or int(p.name) == os.getpid():
        continue
    try:
        exe = Path(os.readlink(p / 'exe')).name
        cwd = os.readlink(p / 'cwd')
        group = (p / 'cgroup').read_text()
        argv = (p / 'cmdline').read_bytes().replace(b'\0', b' ')
        env = (p / 'environ').read_bytes().split(b'\0')
        suspect = (exe in ('node', 'nodejs', 'bun', 'deno', 'psql', 'pg_restore', 'pg_dump')
                   or b'RIVALHUB_DB_TARGET=production' in env or 'rivalhub' in cwd.lower())
        if suspect:
            row = dict(pid=int(p.name), exe=exe, cwd=cwd,
                       knownTools=[t for t in tools if t.encode() in argv])
            (unit if '/rivalhub-production.service' in group else outside).append(row)
    except (FileNotFoundError, ProcessLookupError):
        continue
    except PermissionError:
        unreadable.append(int(p.name))
print(json.dumps(dict(unitProcesses=unit, outsideCandidates=outside,
                      unreadablePids=unreadable), indent=2))
raise SystemExit(2 if outside or unreadable else 0)
PY
```

The inspection shell itself may appear because its cwd is a RivalHub checkout;
attribute its exact PID explicitly. Unknown runtimes remain blockers, not
permission to kill them. This conservative inventory cannot discover unlisted
external hosts or arbitrary future scripts.

Enumerate scheduled starts using `timeout 10s systemctl list-timers --all --no-pager`.
Inspect project/custom units privately by exact unit name. Inventory
`/etc/crontab`, `/etc/cron.d` and root/service-user crontabs through bounded private
reads: `timeout 5s ls -l /etc/crontab /etc/cron.d`,
`timeout 5s crontab -u root -l` and
`timeout 5s crontab -u rivalhub-production -l`. Inspect listed cron files with
`timeout 5s cat EXACT_PATH` privately. Record only source/line or unit, owner, enabled
state and whether it launches an entrypoint above; never upload raw bodies.
Hold attributed independent jobs through their existing approved owners.

## Database scope and decision

Use the already authorized read-only DB channel; these queries expose no SQL
payloads. They are observations, not a new permission to connect to Production.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT usename, count(*) AS sessions,
       count(*) FILTER (WHERE state IS NULL) AS hidden_sessions,
       count(*) FILTER (WHERE state IS DISTINCT FROM 'idle' OR xact_start IS NOT NULL) AS busy_sessions
FROM pg_stat_activity
WHERE datname = current_database() AND backend_type = 'client backend'
  AND pid <> pg_backend_pid()
GROUP BY usename ORDER BY usename;
SELECT owner, count(*) AS prepared FROM pg_prepared_xacts
WHERE database = current_database() GROUP BY owner ORDER BY owner;
COMMIT;
```

Before stop, service activity is expected. Identify runtime login plus every
other writer login/host. Hidden/unattributed work, missing host/operator
acknowledgement, incomplete inventory or active independent writer blocks
finalize; do not add grants to pass. The installer then stops HTTP and enforces
two empty server observations for the runtime login/database, including pooler
and prepared work. Its 60-second drain cannot prove unknown roles/hosts will
never start later. Hold the independent-writer stop window through exact
candidate/rollback identity and acceptance. If scope cannot be established with
existing access, report the missing owner/host/role and keep it blocked.
