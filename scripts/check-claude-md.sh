#!/bin/zsh
# 校验 CLAUDE.md 组件清单是否与实际文件一致
# 以磁盘文件为真实来源，检查每个 .tsx 组件名是否在 CLAUDE.md 中有记录。
# 组件文件统一使用 PascalCase 命名（如 MatchCard.tsx），与 export 名一致。
# 新增组件后只需更新 CLAUDE.md，无需维护本脚本。
# 用法: zsh scripts/check-claude-md.sh
set -euo pipefail

ROOT=$(dirname "$0")/..
CLAUDE_MD="$ROOT/CLAUDE.md"
errors=0

# ui/ 目录为 shadcn 按需组件，不纳入校验
DIRS=(auth layout rivalhub matches admin draft captains teams register settings)

echo "Checking CLAUDE.md against src/components/..."

for dir in "${DIRS[@]}"; do
  echo "$dir/"
  files=($(ls "$ROOT/src/components/$dir/"*.tsx 2>/dev/null | xargs -n1 basename | sed 's/\.tsx$//' || true))
  for name in "${files[@]}"; do
    if ! grep -q "$name" "$CLAUDE_MD"; then
      echo "  MISSING in CLAUDE.md (exists on disk): src/components/$dir/$name.tsx"
      errors=$((errors + 1))
    fi
  done
done

echo ""
if [ $errors -eq 0 ]; then
  echo "✅ CLAUDE.md 组件清单与实际文件一致"
  exit 0
else
  echo "❌ 发现 $errors 处不一致，请更新 CLAUDE.md"
  exit 1
fi
