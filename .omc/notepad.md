# Notepad
<!-- Auto-managed by OMC. Manual edits preserved in MANUAL section. -->

## Priority Context
<!-- ALWAYS loaded. Keep under 500 chars. Critical discoveries only. -->

## Working Memory
<!-- Session notes. Auto-pruned after 7 days. -->
### 2026-05-11 16:05
Task 8 (SeasonForm refactor) completed:
- Replaced Textarea-based stage plan with StagePlanEditor component
- Replaced plain Input theme color with ThemeColorPicker component
- Added TeamConfigForm for team registration config
- Added preset system (Major/Rivals) with applyPreset function
- Added slug auto-generation from name (slugFromName + useEffect)
- Changed teamSize to maxTeamSize/minTeamSize (matches updated schema)
- Changed default registration mode from "solo" to "team"
- Changed default kind from "选秀联赛" to "Major"
- Changed default stage plan from RIVALS_STAGE_PLAN to MAJOR_STAGE_PLAN
- Captain voting/draft checkboxes now only shown in solo registration mode
- Registration config section (rank thresholds, etc.) only shown in solo mode
- Team config section only shown in team mode
- Stage plan stored directly as StagePlan object (no JSON string parsing)
- 3 remaining tsc errors in page files (settings/page.tsx, seasons/new/page.tsx) are pre-existing from Task 4 schema change, to be fixed in Tasks 9/10


## MANUAL
<!-- User content. Never auto-pruned. -->

