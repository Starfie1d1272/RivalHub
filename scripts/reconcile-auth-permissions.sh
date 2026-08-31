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
  conflicts="$(git diff --name-only --diff-filter=U)"
  printf 'Merge conflicts:\n%s\n' "$conflicts"
  allowed='drizzle/migrations/meta/0021_snapshot.json
drizzle/migrations/meta/_journal.json
src/actions/teams.ts
src/db/schema/index.ts
tests/unit/db/major-profile-migration.test.ts'
  unexpected="$(comm -23 <(printf '%s\n' "$conflicts" | sort) <(printf '%s\n' "$allowed" | sort))"
  if [ -n "$unexpected" ]; then
    echo 'Unexpected conflicts:' >&2
    printf '%s\n' "$unexpected" >&2
    exit 1
  fi
  while IFS= read -r path; do
    [ -z "$path" ] && continue
    git checkout --theirs -- "$path"
    git add "$path"
  done <<< "$conflicts"
fi

git rm -f drizzle/migrations/0021_mature_deadpool.sql 2>/dev/null || true

python <<'PY'
from pathlib import Path

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

p = Path('src/actions/teams.ts')
s = p.read_text()
s = s.replace('import { auditActorId, requireActorWithRootFallback, requireAuth, requireSuperAdmin } from "@/lib/auth/session";', 'import { auditActorId, requireAuth, requireSuperAdmin } from "@/lib/auth/session";')
s = s.replace('const actor = await requireActorWithRootFallback();', 'const actor = await requireAuth();')
s = s.replace('const emergencyOverride = Boolean(currentTeam && currentTeam.captainUserId !== actor.userId);\n    if (emergencyOverride) await requireSuperAdmin();\n    await db.transaction((tx) => transferTeamCaptainInTx(tx, { teamId: parsed.data.teamId, actorUserId: actor.userId, toUserId: parsed.data.toUserId, actorId: actor.actorId, emergencyOverride }));', 'const adminOverride = Boolean(currentTeam && currentTeam.captainUserId !== actor.userId);\n    if (adminOverride) await requireSuperAdmin();\n    await db.transaction((tx) => transferTeamCaptainInTx(tx, { teamId: parsed.data.teamId, actorUserId: actor.userId, toUserId: parsed.data.toUserId, actorId: auditActorId(actor), emergencyOverride: adminOverride }));')
s = s.replace('const emergencyOverride = Boolean(currentTeam && currentTeam.captainUserId !== actor.userId);\n    if (emergencyOverride) await requireSuperAdmin();\n    const slug = await db.transaction((tx) => disbandTeamInTx(tx, { teamId: parsed.data.teamId, actorUserId: actor.userId, actorId: actor.actorId, emergencyOverride }));', 'const adminOverride = Boolean(currentTeam && currentTeam.captainUserId !== actor.userId);\n    if (adminOverride) await requireSuperAdmin();\n    const slug = await db.transaction((tx) => disbandTeamInTx(tx, { teamId: parsed.data.teamId, actorUserId: actor.userId, actorId: auditActorId(actor), emergencyOverride: adminOverride }));')
if 'requireActorWithRootFallback' in s or 'actor.actorId' in s:
    raise SystemExit('legacy root actor remains in teams action after reconciliation')
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
# The generated snapshot/journal represent the merged schema. The SQL body is
# the already-reviewed fail-closed auth migration; using it also prevents
# Drizzle from dropping custom constraints created by 0021/0022.
migration.write_text(Path('/tmp/auth-permissions.sql').read_text())

p = Path('tests/integration/db/migrations/auth-permissions.test.ts')
s = p.read_text()
s = s.replace('const TERMINAL_MIGRATION = "0021_mature_deadpool.sql";', 'const TERMINAL_MIGRATION = "0023_auth_permissions.sql";')
s = s.replace('return migrationFiles((name) => /^00(?:0[0-9]|1[0-9]|20)_.*\\.sql$/.test(name))\n    .filter((name) => name !== TERMINAL_MIGRATION);', 'return migrationFiles((name) => /^\\d{4}_.*\\.sql$/.test(name))\n    .filter((name) => name !== TERMINAL_MIGRATION);')
p.write_text(s)

journal = json.loads(Path('drizzle/migrations/meta/_journal.json').read_text())
last = journal['entries'][-1]
if last['idx'] != 23 or last['tag'] != '0023_auth_permissions':
    raise SystemExit(f'unexpected generated journal tail: {last}')

p = Path('tests/unit/db/major-profile-migration.test.ts')
s = p.read_text()
s = s.replace('idx: 22,\n      version: "7",\n      tag: "0022_competition_bracket_state",', 'idx: 23,\n      version: "7",\n      tag: "0023_auth_permissions",')
p.write_text(s)
PY

pnpm db:check
pnpm type-check
pnpm lint

git rm .github/workflows/reconcile-auth-permissions.yml scripts/reconcile-auth-permissions.sh
git add -A
git commit -m 'chore(auth): reconcile latest migration chain'
git push origin HEAD:refactor/v2-auth-permissions
