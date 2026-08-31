#!/usr/bin/env bash
set -euo pipefail

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
cp drizzle/migrations/0021_mature_deadpool.sql /tmp/auth-permissions.sql
git fetch origin dev

set +e
git merge --no-commit --no-ff origin/dev
merge_status=$?
set -e

if [ "$merge_status" -ne 0 ]; then
  conflicts="$(git diff --name-only --diff-filter=U | sort)"
  printf 'Merge conflicts:\n%s\n' "$conflicts"
  expected='drizzle/migrations/meta/0021_snapshot.json
drizzle/migrations/meta/_journal.json
src/actions/teams.ts
tests/unit/db/major-profile-migration.test.ts'
  if [ "$conflicts" != "$expected" ]; then
    echo 'Auth reconciliation conflict set changed unexpectedly:' >&2
    printf '%s\n' "$conflicts" >&2
    exit 1
  fi
  while IFS= read -r path; do
    [ -z "$path" ] && continue
    # The latest dev owns migration history metadata, Team thin adapters, and
    # the current journal assertion. Auth-specific semantics are layered back
    # below rather than allowing the older branch implementation to win.
    git checkout --theirs -- "$path"
    git add "$path"
  done <<< "$conflicts"
fi

git rm -f drizzle/migrations/0021_mature_deadpool.sql 2>/dev/null || true

python <<'PY'
from pathlib import Path

# Keep the latest schema index, then layer in the Auth canonical owners.
p = Path('src/db/schema/index.ts')
s = p.read_text()
s = s.replace('export * from "./admin-users";\n', '')
needle = 'export * from "./admin-invites";\n'
addition = needle + 'export * from "./admin-invite-claims";\nexport * from "./season-admin-grants";\n'
if 'export * from "./admin-invite-claims";' not in s:
    if needle not in s:
        raise SystemExit('cannot locate admin-invites export')
    s = s.replace(needle, addition)
p.write_text(s)

# Preserve Team/Entry's thin action -> domain-command architecture. Only remove
# the retired root actor fallback and keep super-admin override authorization.
p = Path('src/actions/teams.ts')
s = p.read_text()
s = s.replace(
    'import { auditActorId, requireActorWithRootFallback, requireAuth, requireSuperAdmin } from "@/lib/auth/session";',
    'import { auditActorId, requireAuth, requireSuperAdmin } from "@/lib/auth/session";',
)
s = s.replace('const actor = await requireActorWithRootFallback();', 'const actor = await requireAuth();')
s = s.replace(
    'const emergencyOverride = Boolean(currentTeam && currentTeam.captainUserId !== actor.userId);\n    if (emergencyOverride) await requireSuperAdmin();\n    await db.transaction((tx) => transferTeamCaptainInTx(tx, { teamId: parsed.data.teamId, actorUserId: actor.userId, toUserId: parsed.data.toUserId, actorId: actor.actorId, emergencyOverride }));',
    'const adminOverride = Boolean(currentTeam && currentTeam.captainUserId !== actor.userId);\n    if (adminOverride) await requireSuperAdmin();\n    await db.transaction((tx) => transferTeamCaptainInTx(tx, { teamId: parsed.data.teamId, actorUserId: actor.userId, toUserId: parsed.data.toUserId, actorId: auditActorId(actor), emergencyOverride: adminOverride }));',
)
s = s.replace(
    'const emergencyOverride = Boolean(currentTeam && currentTeam.captainUserId !== actor.userId);\n    if (emergencyOverride) await requireSuperAdmin();\n    const slug = await db.transaction((tx) => disbandTeamInTx(tx, { teamId: parsed.data.teamId, actorUserId: actor.userId, actorId: actor.actorId, emergencyOverride }));',
    'const adminOverride = Boolean(currentTeam && currentTeam.captainUserId !== actor.userId);\n    if (adminOverride) await requireSuperAdmin();\n    const slug = await db.transaction((tx) => disbandTeamInTx(tx, { teamId: parsed.data.teamId, actorUserId: actor.userId, actorId: auditActorId(actor), emergencyOverride: adminOverride }));',
)
if 'requireActorWithRootFallback' in s or 'actor.actorId' in s:
    raise SystemExit('legacy root actor remains in teams action after reconciliation')
for command in ('transferTeamCaptainInTx', 'disbandTeamInTx'):
    if command not in s:
        raise SystemExit(f'Team thin adapter lost {command}')
p.write_text(s)
PY

pnpm install --frozen-lockfile
pnpm exec drizzle-kit generate --name auth_permissions

python <<'PY'
from pathlib import Path
import json

migrations = sorted(Path('drizzle/migrations').glob('0023_*.sql'))
if len(migrations) != 1:
    raise SystemExit(f'expected one 0023 migration, got {[p.name for p in migrations]}')
migration = migrations[0]
if migration.name != '0023_auth_permissions.sql':
    raise SystemExit(f'unexpected auth migration name: {migration.name}')

# Snapshot/journal must be generated from the merged schema. The executable SQL
# remains the already-reviewed fail-closed Auth migration so Drizzle cannot
# accidentally contract custom invariants created in 0021/0022.
migration.write_text(Path('/tmp/auth-permissions.sql').read_text())

p = Path('tests/integration/db/migrations/auth-permissions.test.ts')
s = p.read_text()
s = s.replace(
    'const TERMINAL_MIGRATION = "0021_mature_deadpool.sql";',
    'const TERMINAL_MIGRATION = "0023_auth_permissions.sql";',
)
s = s.replace(
    'return migrationFiles((name) => /^00(?:0[0-9]|1[0-9]|20)_.*\\.sql$/.test(name))\n    .filter((name) => name !== TERMINAL_MIGRATION);',
    'return migrationFiles((name) => /^\\d{4}_.*\\.sql$/.test(name))\n    .filter((name) => name !== TERMINAL_MIGRATION);',
)
marker = '  it("fails closed before destructive DDL for legacy inconsistencies", async () => {'
preservation = '''  it("preserves prior Team/Entry and bracket invariants across auth migration", async () => {\n    await withScratchDatabase("rivalhub_auth_preserves_prior_invariants", async (client) => {\n      await replayBeforeAuthMigration(client);\n      await replayMigration(client, TERMINAL_MIGRATION);\n\n      const constraints = await client.query<{ conname: string; condeferrable: boolean; condeferred: boolean }>(\n        `SELECT conname, condeferrable, condeferred\n         FROM pg_constraint\n         WHERE conname IN (\n           'competition_entries_current_roster_revision_scope_fk',\n           'competition_entries_approved_roster_revision_scope_fk'\n         )\n         ORDER BY conname`,\n      );\n      expect(constraints.rows).toEqual([\n        { conname: "competition_entries_approved_roster_revision_scope_fk", condeferrable: true, condeferred: true },\n        { conname: "competition_entries_current_roster_revision_scope_fk", condeferrable: true, condeferred: true },\n      ]);\n\n      const bracketOwner = await client.query<{ table_name: string | null; old_column_count: string }>(\n        `SELECT to_regclass('public.competition_bracket_states')::text AS table_name,\n                (SELECT count(*)::text FROM information_schema.columns\n                 WHERE table_schema = 'public' AND table_name = 'seasons' AND column_name = 'bracket_data') AS old_column_count`,\n      );\n      expect(bracketOwner.rows[0]).toEqual({\n        table_name: "competition_bracket_states",\n        old_column_count: "0",\n      });\n    });\n  });\n\n'''
if marker not in s:
    raise SystemExit('cannot locate auth migration fail-closed test marker')
if 'preserves prior Team/Entry and bracket invariants across auth migration' not in s:
    s = s.replace(marker, preservation + marker)
p.write_text(s)

journal = json.loads(Path('drizzle/migrations/meta/_journal.json').read_text())
last = journal['entries'][-1]
if last['idx'] != 23 or last['tag'] != '0023_auth_permissions':
    raise SystemExit(f'unexpected generated journal tail: {last}')

p = Path('tests/unit/db/major-profile-migration.test.ts')
s = p.read_text()
old = 'idx: 22,\n      version: "7",\n      tag: "0022_competition_bracket_state",'
new = 'idx: 23,\n      version: "7",\n      tag: "0023_auth_permissions",'
if old not in s:
    raise SystemExit('cannot locate current journal-tail assertion')
p.write_text(s.replace(old, new))
PY

# Static and schema evidence before handing back to canonical PR CI.
pnpm db:check
pnpm type-check
pnpm lint
! grep -R --line-number --exclude-dir=node_modules --exclude-dir=.next 'requireActorWithRootFallback' src scripts tests
! grep -R --line-number --exclude-dir=node_modules --exclude-dir=.next '0021_mature_deadpool' src scripts tests drizzle/migrations/meta

git rm -f reconcile-auth-conflicts.txt .github/workflows/reconcile-auth-permissions.yml scripts/reconcile-auth-permissions.sh
git add -A
git commit -m 'chore(auth): reconcile latest migration chain'
git push origin HEAD:refactor/v2-auth-permissions
