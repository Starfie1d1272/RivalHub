#!/bin/zsh
# 校验 CLAUDE.md 组件清单是否与实际文件一致
# 用法: zsh scripts/check-claude-md.sh
set -euo pipefail

ROOT=$(dirname "$0")/..
errors=0

# PascalCase → kebab-case
to_kebab() { echo "$1" | sed -E 's/([a-z0-9])([A-Z])/\1-\2/g' | tr '[:upper:]' '[:lower:]'; }

# 忽略大小写和连字符匹配：admin-shortcut == AdminShortcut == adminShortcut
normalize() { echo "$1" | tr '[:upper:]' '[:lower:]' | tr -d '-'; }

check_dir() {
  local dir=$1; shift; local claimed=("$@")
  local actual=($(ls $ROOT/src/components/$dir/*.tsx 2>/dev/null | xargs -n1 basename | sed 's/\.tsx$//'))

  for name in "${claimed[@]}"; do
    local kebab=$(to_kebab "$name")
    local norm_claimed=$(normalize "$name")
    local found=0
    for f in "${actual[@]}"; do
      if [[ "$f" == "$name" || "$f" == "$kebab" || "$(normalize "$f")" == "$norm_claimed" ]]; then
        found=1; break
      fi
    done
    if (( found == 0 )); then
      echo "  MISSING on disk (CLAUDE.md claims): src/components/$dir/$name (.tsx)"
      errors=$((errors + 1))
    fi
  done

  for file in "${actual[@]}"; do
    local norm_actual=$(normalize "$file")
    local found=0
    for name in "${claimed[@]}"; do
      local kebab=$(to_kebab "$name")
      if [[ "$file" == "$name" || "$file" == "$kebab" || "$(normalize "$name")" == "$norm_actual" ]]; then
        found=1; break
      fi
    done
    if (( found == 0 )); then
      echo "  MISSING in CLAUDE.md (exists on disk): src/components/$dir/$file.tsx"
      errors=$((errors + 1))
    fi
  done
}

echo "Checking CLAUDE.md against src/components/..."

echo "layout/"
check_dir layout "AdminShortcut" "OnlineCounter" "breadcrumb" "footer" "header-client" "header" "season-nav"

echo "rivalhub/"
check_dir rivalhub "Btn" "EmptyState" "ErrorState" "Field" "InlineConfirm" "MapPreferenceChips" "Marker" "Panel" "PhaseStep" "PosChip" "ScrollHint" "Skeleton" "Stat" "StatusBanner" "StatusPill" "TeamBadge"

echo "matches/"
check_dir matches "AdminMatchFilter" "AdminRosterDialog" "BatchDeadlineCard" "BracketView" "CreateMatchForm" "DeleteMatchButton" "GeneratePlayoffCard" "GenerateScheduleCard" "MapByMapInput" "MatchCard" "MatchMvpVote" "MatchRosterForm" "MatchRosterView" "MatchStatusBadge" "MatchTabsSection" "MatchTeamFilter" "MatchTimeNegotiation" "PlayerStatsTable" "ScheduledAtInput" "ScoreInput" "StandingsTable" "StatsLeaderboard" "StatsOCRPanel" "SwissBracket" "TimeProposalHistory" "VetoInputDialog" "VetoView"

echo "admin/"
check_dir admin "AdminLoginForm" "AdminRegisterForm" "AdminSidebar" "AdminUserList" "AuditLogTable" "ChangePasswordForm" "DraftRegistrationTable" "InviteManager" "RegistrationReviewList" "SeasonForm" "SeasonSubNav" "StagePlanEditor" "TeamConfigForm" "ThemeColorPicker"

echo "draft/"
check_dir draft "CaptainDraftPanel" "DraftAdminPanel" "DraftCountdown" "DraftLiveRoom" "PlayerInfoPopover" "PlayerPool" "TeamDraftGrid"

echo "captains/"
check_dir captains "CaptainConfirmPanel" "CaptainVotingPanel"

echo "teams/"
check_dir teams "TeamCard" "TeamGrid" "TeamLogoUpload" "TeamNameForm" "TeamRosterCard"

echo "register/"
check_dir register "RegistrationForm"

echo "settings/"
check_dir settings "ProfileForm" "ChangePasswordForm"

if [ $errors -eq 0 ]; then
  echo ""
  echo "✅ CLAUDE.md 组件清单与实际文件一致"
  exit 0
else
  echo ""
  echo "❌ 发现 $errors 处不一致，请更新 CLAUDE.md"
  exit 1
fi
