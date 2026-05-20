# Season Form Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `/admin/seasons/new` form with preset system, team registration config, form-based stage editor, slug auto-generation, and theme color picker.

**Architecture:** SeasonForm keeps all form state at the top level, delegates to three new sub-components (ThemeColorPicker, StagePlanEditor, TeamConfigForm). The form uses `registrationMode` to conditionally show solo vs team sections. All editing is form-based (no JSON editing). `team_size` is renamed to `max_team_size` and `min_team_size` is added as top-level seasons columns.

**Tech Stack:** Next.js 15, TypeScript, Drizzle ORM, React Hook Form (via controlled components), Zod, Tailwind CSS v4

---

### Task 1: Types, constants, and interfaces

**Files:**
- Modify: `src/types/season.ts`

- [ ] **Step 1: Add TeamRegistrationConfig interface and MAJOR_TEAM_CONFIG constant**

Insert after the `RegistrationConfig` interface (after line 64):

```typescript
export interface TeamRegistrationConfig {
  allowExternal: boolean;
  graduateCountsAsHome: boolean;
  minHomeMembers: number;
  minEnrolledMembers: number;
  maxExternalMembers: number;
  requirePositions: boolean;
  maxPerPositionPerTeam: number;
  captainCanKick: boolean;
  captainCanTransfer: boolean;
  lockAfterRegistration: boolean;
  requireUniqueTeamName: boolean;
  requireTeamLogo: boolean;
}

export const MAJOR_TEAM_CONFIG: TeamRegistrationConfig = {
  allowExternal: false,
  graduateCountsAsHome: true,
  minHomeMembers: 5,
  minEnrolledMembers: 0,
  maxExternalMembers: 0,
  requirePositions: false,
  maxPerPositionPerTeam: 2,
  captainCanKick: true,
  captainCanTransfer: true,
  lockAfterRegistration: true,
  requireUniqueTeamName: true,
  requireTeamLogo: false,
};
```

- [ ] **Step 2: Update SeasonCapabilities — rename teamSize to maxTeamSize, add minTeamSize and teamRegistrationConfig**

Replace `SeasonCapabilities` interface:

```typescript
export interface SeasonCapabilities {
  registrationMode: RegistrationMode;
  hasCaptainVoting: boolean;
  hasDraft: boolean;
  stagePlan: StagePlan;
  registrationConfig: RegistrationConfig;
  teamRegistrationConfig: TeamRegistrationConfig;
  maxTeamSize: number;
  minTeamSize: number;
  starterCount: number;
  positions: string[];
}
```

- [ ] **Step 3: Update presets — DRAFT_LEAGUE_PRESET, OPEN_TOURNAMENT_PRESET, CAPABILITY_PRESETS.major**

Replace presets to use `maxTeamSize`/`minTeamSize`/`teamRegistrationConfig`:

```typescript
export const DRAFT_LEAGUE_PRESET: SeasonCapabilities = {
  registrationMode: "solo",
  hasCaptainVoting: true,
  hasDraft: true,
  stagePlan: RIVALS_STAGE_PLAN,
  registrationConfig: RIVALS_REGISTRATION_CONFIG,
  teamRegistrationConfig: {} as TeamRegistrationConfig,
  maxTeamSize: 7,
  minTeamSize: 7,
  starterCount: 5,
  positions: CS2_POSITIONS,
};

export const OPEN_TOURNAMENT_PRESET: SeasonCapabilities = {
  registrationMode: "team",
  hasCaptainVoting: false,
  hasDraft: false,
  stagePlan: RIVALS_STAGE_PLAN,
  registrationConfig: RIVALS_REGISTRATION_CONFIG,
  teamRegistrationConfig: MAJOR_TEAM_CONFIG,
  maxTeamSize: 5,
  minTeamSize: 5,
  starterCount: 5,
  positions: CS2_POSITIONS,
};
```

Update `CAPABILITY_PRESETS.major`:

```typescript
  major: {
    registrationMode: "team" as const,
    hasCaptainVoting: false,
    hasDraft: false,
    stagePlan: MAJOR_STAGE_PLAN,
    registrationConfig: MAJOR_REGISTRATION_CONFIG,
    teamRegistrationConfig: MAJOR_TEAM_CONFIG,
    maxTeamSize: 9,
    minTeamSize: 5,
    starterCount: 5,
    positions: CS2_POSITIONS,
  },
```

- [ ] **Step 4: Add normalizeTeamRegistrationConfig function**

After `normalizeRegistrationConfig`:

```typescript
type PartialTeamConfig = Partial<TeamRegistrationConfig>;

export function normalizeTeamRegistrationConfig(
  config: PartialTeamConfig | null | undefined,
): TeamRegistrationConfig {
  return {
    allowExternal: config?.allowExternal ?? false,
    graduateCountsAsHome: config?.graduateCountsAsHome ?? true,
    minHomeMembers: config?.minHomeMembers ?? 5,
    minEnrolledMembers: config?.minEnrolledMembers ?? 0,
    maxExternalMembers: config?.maxExternalMembers ?? 0,
    requirePositions: config?.requirePositions ?? false,
    maxPerPositionPerTeam: config?.maxPerPositionPerTeam ?? 2,
    captainCanKick: config?.captainCanKick ?? true,
    captainCanTransfer: config?.captainCanTransfer ?? true,
    lockAfterRegistration: config?.lockAfterRegistration ?? true,
    requireUniqueTeamName: config?.requireUniqueTeamName ?? true,
    requireTeamLogo: config?.requireTeamLogo ?? false,
  };
}
```

- [ ] **Step 5: Commit**

```bash
git add src/types/season.ts
git commit -m "feat: add TeamRegistrationConfig type and update SeasonCapabilities with maxTeamSize/minTeamSize"
```

---

### Task 2: DB Schema — rename columns, add new columns

**Files:**
- Modify: `src/db/schema/seasons.ts`

- [ ] **Step 1: Add TeamRegistrationConfig import**

```typescript
import type { RegistrationConfig, StagePlan, TeamRegistrationConfig } from "@/types/season";
```

- [ ] **Step 2: Define new columns**

After `registrationConfig` column definition, add:

```typescript
  teamRegistrationConfig: json("team_registration_config")
    .$type<TeamRegistrationConfig>()
    .notNull()
    .default(sql`'{}'::json`),
```

- [ ] **Step 3: Replace teamSize with minTeamSize + maxTeamSize**

```typescript
  minTeamSize: integer("min_team_size").notNull().default(5),
  maxTeamSize: integer("max_team_size").notNull().default(7),
```

- [ ] **Step 4: Commit**

```bash
git add src/db/schema/seasons.ts
git commit -m "feat(db): add min_team_size, team_registration_config; rename team_size to max_team_size"
```

---

### Task 3: Generate Drizzle migration

**Files:**
- Create: migration SQL file

- [ ] **Step 1: Generate migration**

```bash
pnpm db:generate
```

- [ ] **Step 2: Apply to dev DB**

```bash
pnpm db:push
```

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/
git commit -m "chore(db): add migration for season form redesign schema changes"
```

---

### Task 4: Server Actions — update schemas and mutations

**Files:**
- Modify: `src/actions/seasons.ts`

- [ ] **Step 1: Update imports**

```typescript
import {
  RIVALS_REGISTRATION_CONFIG,
  RIVALS_STAGE_PLAN,
  MAJOR_TEAM_CONFIG,
  normalizeRegistrationConfig,
  normalizeTeamRegistrationConfig,
  type RegistrationConfig,
  type TeamRegistrationConfig,
  type StagePlan,
} from "@/types/season";
```

- [ ] **Step 2: Update Zod schema — rename teamSize, add minTeamSize, add teamRegistrationConfig**

Replace `teamSize` field with `minTeamSize` + `maxTeamSize` in `seasonFormBaseSchema`.

Add after `registrationConfig` schema:

```typescript
  teamRegistrationConfig: z.object({
    allowExternal: z.boolean(),
    graduateCountsAsHome: z.boolean(),
    minHomeMembers: z.number().int().min(0),
    minEnrolledMembers: z.number().int().min(0),
    maxExternalMembers: z.number().int().min(0),
    requirePositions: z.boolean(),
    maxPerPositionPerTeam: z.number().int().min(1),
    captainCanKick: z.boolean(),
    captainCanTransfer: z.boolean(),
    lockAfterRegistration: z.boolean(),
    requireUniqueTeamName: z.boolean(),
    requireTeamLogo: z.boolean(),
  }).optional(),
```

Update refine validators to use `maxTeamSize`.

- [ ] **Step 3: Update createSeason — new column names**

Insert uses `minTeamSize: data.minTeamSize, maxTeamSize: data.maxTeamSize` and `teamRegistrationConfig: normalizeTeamRegistrationConfig(data.teamRegistrationConfig as TeamRegistrationConfig)`.

- [ ] **Step 4: Update updateSeason — same column renames**

Update all references from `teamSize` to `maxTeamSize` in update logic.

- [ ] **Step 5: Commit**

```bash
git add src/actions/seasons.ts
git commit -m "feat(actions): update season form schema with maxTeamSize, minTeamSize, teamRegistrationConfig"
```

---

### Task 5: ThemeColorPicker component

**Files:**
- Create: `src/components/admin/ThemeColorPicker.tsx`

A simple component with 6 preset color swatches (buttons) and a custom hex input underneath. Highlights the selected swatch with a ring. See full implementation details in expanded task dispatch.

- [ ] **Commit**

```bash
git add src/components/admin/ThemeColorPicker.tsx
git commit -m "feat: add ThemeColorPicker component with preset swatches"
```

---

### Task 6: StagePlanEditor component

**Files:**
- Create: `src/components/admin/StagePlanEditor.tsx`

Card-based stage editor with add/remove/edit. Each stage card has: name input (auto-generates key), type selector, teamCount/BO/advanceTiers inputs. Dynamic fields: groupCount for swiss/rr/gsl, finalFormat/hasThirdPlaceMatch for elimination. Bottom toolbar with "+ 添加阶段", preset selector (Major/Rivals/自定义), "清空阶段" button. Supports editing key manually. See full implementation in expanded task dispatch.

- [ ] **Commit**

```bash
git add src/components/admin/StagePlanEditor.tsx
git commit -m "feat: add StagePlanEditor component with card-based stage editing"
```

---

### Task 7: TeamConfigForm component

**Files:**
- Create: `src/components/admin/TeamConfigForm.tsx`

Renders three sections: 身份/学校约束 (allowExternal, graduateCountsAsHome, minHomeMembers, minEnrolledMembers, maxExternalMembers), 位置分配 (requirePositions with help text, maxPerPositionPerTeam), 队伍管理 (captainCanKick, captainCanTransfer, lockAfterRegistration, requireUniqueTeamName, requireTeamLogo). Each section is a subheading with a grid of checkboxes/number inputs. See full implementation in expanded task dispatch.

- [ ] **Commit**

```bash
git add src/components/admin/TeamConfigForm.tsx
git commit -m "feat: add TeamConfigForm component for team registration configuration"
```

---

### Task 8: Update SeasonForm — main component refactor

**Files:**
- Modify: `src/components/admin/SeasonForm.tsx`

Major refactor:
1. Add imports for new sub-components and `MAJOR_STAGE_PLAN`
2. Add `slugFromName` helper function
3. Replace `teamSize` state with `maxTeamSize`/`minTeamSize`
4. Replace `stagePlanMode`/`stagePlanText` state with direct `stagePlan` state
5. Add `teamConfig` state
6. Add `applyPreset()` function for Major/Rivals
7. Add `handleRegistrationModeChange()` for team↔solo switching
8. Update `buildPayload()` to use new field names
9. Replace JSX: preset selector (create-only), basic info with ThemeColorPicker, capability section with conditional voting/draft, solo-registration-config section, team-config section, StagePlanEditor section

See full implementation in expanded task dispatch.

- [ ] **Commit**

```bash
git add src/components/admin/SeasonForm.tsx
git commit -m "feat: refactor SeasonForm with preset system, team config, stage editor, slug auto-gen"
```

---

### Task 9: Update pages — new season page and edit page

**Files:**
- Modify: `src/app/admin/seasons/new/page.tsx`
- Modify: `src/app/admin/[seasonSlug]/settings/page.tsx`

Update initial values to use `maxTeamSize`/`minTeamSize` instead of `teamSize`. New page defaults to Major preset (team mode, maxTeamSize: 9, minTeamSize: 5, MAJOR_STAGE_PLAN). Edit page adds `teamRegistrationConfig` field from `season.teamRegistrationConfig`.

- [ ] **Commit**

```bash
git add src/app/admin/seasons/new/page.tsx src/app/admin/[seasonSlug]/settings/page.tsx
git commit -m "feat: update season pages with new initial values for form redesign"
```

---

### Task 10: Fix remaining teamSize references across codebase

**Files:**
- Various files referencing `season.teamSize`

- [ ] **Step 1: Find all references**

```bash
grep -rn "\.teamSize\|teamSize" --include="*.ts" --include="*.tsx" src/ | grep -v node_modules
```

- [ ] **Step 2: Fix each reference to `maxTeamSize`**

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "fix: update all teamSize references to maxTeamSize across codebase"
```

---

### Task 11: Final verification

- [ ] Run `pnpm tsc --noEmit` — no errors
- [ ] Run `pnpm test` — all pass
- [ ] Run `pnpm build` — succeeds
- [ ] Manual smoke test via `pnpm dev`

