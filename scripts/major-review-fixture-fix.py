from pathlib import Path

# Discipline used an invented v2 StageRun snapshot. Replace it with the real
# v4 frozen-input contract used by production.
path = Path("tests/integration/db/discipline.test.ts")
text = path.read_text()
old = '''    const ruleSnapshot = {
      version: 2,
      stage: { key: "stage1", type: "swiss", teamCount: 16, matchFormat: "bo1" },
      affiliationRules: [
        { institutionCode: NJU_CODE, eligibleAcademicStatuses: ["enrolled", "graduated"], minRosterMembers: 3, minStartingMembers: 3 },
      ],
      competitiveProfile: { ...COMPETITIVE_PROFILE, rankOrder: [...COMPETITIVE_PROFILE.rankOrder] },
      frozenCompetitiveFacts,
      stagePlan: [{ key: "stage1" }, { key: "playoff" }],
      tournamentEntrants: [],
      tournamentSeeds: [],
    };'''
new = '''    const ruleSnapshot = {
      version: 4,
      stagePlan: capabilities.stagePlan.map((stage) => ({
        key: stage.key,
        name: stage.name,
        type: stage.type,
        teamCount: stage.teamCount,
        matchFormat: stage.matchFormat!,
        finalFormat: stage.finalFormat ?? null,
        advanceTiers: stage.advanceTiers,
        entrySeeds: stage.entrySeeds ?? null,
        seeds: stage.seeds ?? null,
      })),
      rosterRules: {
        minTeamSize: capabilities.minTeamSize,
        maxTeamSize: capabilities.maxTeamSize,
        starterCount: capabilities.starterCount,
      },
      affiliationRules: [
        { institutionCode: NJU_CODE, eligibleAcademicStatuses: ["enrolled", "graduated"], minRosterMembers: 3, minStartingMembers: 3 },
      ],
      competitiveProfile: { ...COMPETITIVE_PROFILE, rankOrder: [...COMPETITIVE_PROFILE.rankOrder] },
      frozenCompetitiveFacts,
      runOptions: {},
    };'''
if old not in text:
    raise SystemExit("discipline snapshot fixture block not found")
path.write_text(text.replace(old, new, 1))

# Existing 0017 aggregate trigger is the canonical direct-SQL MatchRoster scope
# guard and intentionally reports SQLSTATE 23514.
path = Path("tests/integration/db/major-roster-safety.test.ts")
text = path.read_text()
old = '        expect(rejected).toMatchObject({ code: "P0001" });'
new = '        expect(rejected).toMatchObject({ code: "23514" });'
if old not in text:
    raise SystemExit("roster-safety error oracle not found")
path.write_text(text.replace(old, new, 1))

# Post-event fixture previously stored only a partial 1-4 placement. A
# MajorFinalResult is now an official complete 1-32 fact.
path = Path("tests/integration/db/postevent.test.ts")
text = path.read_text()
old = '''  const thirdId = randomUUID();
  const userId = randomUUID();'''
new = '''  const thirdId = randomUUID();
  const placementEntryIds = [
    championId,
    runnerUpId,
    thirdId,
    ...Array.from({ length: 29 }, () => randomUUID()),
  ];
  const userId = randomUUID();'''
if old not in text:
    raise SystemExit("postevent placement id insertion point not found")
text = text.replace(old, new, 1)

old = '''    for (const [id, name] of [[championId, "Champion Entry"], [runnerUpId, "Runner-up Entry"], [thirdId, "Third Entry"]] as const) {
      const revisionId = randomUUID();
      await client.query(`INSERT INTO competition_entries (id, competition_id, source, name, representative_user_id, current_roster_revision_id, approved_roster_revision_id, registration_status) VALUES ($1, $2, 'event_native', $3, $4, $5, $5, 'approved')`, [id, seasonId, name, userId, revisionId]);'''
new = '''    for (const [index, id] of placementEntryIds.entries()) {
      const name = index === 0 ? "Champion Entry" : index === 1 ? "Runner-up Entry" : index === 2 ? "Third Entry" : `Placement Entry ${index + 1}`;
      const revisionId = randomUUID();
      await client.query(`INSERT INTO competition_entries (id, competition_id, source, name, representative_user_id, current_roster_revision_id, approved_roster_revision_id, registration_status) VALUES ($1, $2, 'event_native', $3, $4, $5, $5, 'approved')`, [id, seasonId, name, userId, revisionId]);'''
if old not in text:
    raise SystemExit("postevent entry loop not found")
text = text.replace(old, new, 1)

old = '''      [resultId, seasonId, runId, championId, JSON.stringify([
        { from: 1, to: 1, entryIds: [championId] },
        { from: 2, to: 2, entryIds: [runnerUpId] },
        { from: 3, to: 4, entryIds: [thirdId] },
      ]), ACTOR],'''
new = '''      [resultId, seasonId, runId, championId, JSON.stringify([
        { from: 1, to: 1, entryIds: [placementEntryIds[0]!] },
        { from: 2, to: 2, entryIds: [placementEntryIds[1]!] },
        { from: 3, to: 4, entryIds: placementEntryIds.slice(2, 4) },
        { from: 5, to: 32, entryIds: placementEntryIds.slice(4) },
      ]), ACTOR],'''
if old not in text:
    raise SystemExit("postevent placement groups not found")
path.write_text(text.replace(old, new, 1))
