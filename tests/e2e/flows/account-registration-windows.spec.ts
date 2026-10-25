import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import { createCompetitionTemplate } from "../../../src/lib/competition/templates";
import { test, expect } from "../fixtures";
test.use({ scenarioProfile: "major-entry" });
test("team, solo and Major pages preserve upcoming/open/closed registration windows", async ({ page, scenario }) => {
  test.setTimeout(120000); // Nine distinct full document navigations, including cold local compilation.
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL, "registration browser fixture"), ssl: false });
  const owned: string[] = [];
  try {
    const captain = scenario.accounts.find(row => row.key === "captain")!;
    expect((await page.request.post("/api/test/e2e/auth", { data: { email: captain.email, password: scenario.password } })).ok()).toBe(true);
    for (const template of ["custom", "rivals", "major"] as const) {
      const caps = createCompetitionTemplate(template);
      for (const phase of ["upcoming", "open", "closed"] as const) {
        const id = randomUUID(); const slug = `e2e-window-${id}`; owned.push(id);
        const now = Date.now();
        const patch = { id, slug, name: `Window ${template} ${phase}`, competition_template: template, registration_mode: caps.registrationMode,
          has_captain_voting: caps.hasCaptainVoting, has_draft: caps.hasDraft, has_community_awards: caps.hasCommunityAwards,
          stage_plan: caps.stagePlan, registration_config: caps.registrationConfig, team_registration_config: caps.teamRegistrationConfig,
          affiliation_rules: caps.affiliationRules, min_team_size: caps.minTeamSize, max_team_size: caps.maxTeamSize, starter_count: caps.starterCount, positions: caps.positions,
          registration_opens_at: new Date(now + (phase === "upcoming" ? 86400000 : -86400000)).toISOString(),
          registration_opened_at: phase === "upcoming" ? null : new Date(now - 86400000).toISOString(),
          registration_closes_at: new Date(now + (phase === "closed" ? -60000 : 172800000)).toISOString() };
        await pool.query("INSERT INTO seasons SELECT (jsonb_populate_record(NULL::seasons, to_jsonb(s) || $2::jsonb)).* FROM seasons s WHERE id=$1", [scenario.seasonId, JSON.stringify(patch)]);
        await page.goto(`/${slug}/register`, { waitUntil: "load" });
        const message = phase === "upcoming" ? "报名尚未开放。" : phase === "open" ? "报名提交已开放。" : "报名提交已截止。";
        await expect(page.getByText(message, { exact: false }).first()).toBeVisible();
        if (phase !== "open") { const start = page.getByRole("button", { name: "开始报名", exact: true }); if (await start.count()) await expect(start).toBeDisabled(); }
      }
    }
  } finally { if (owned.length) await pool.query("DELETE FROM seasons WHERE id=ANY($1::uuid[])", [owned]); await pool.end(); }
});
