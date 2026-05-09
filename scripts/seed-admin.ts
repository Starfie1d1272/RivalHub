import { randomBytes, scryptSync } from "crypto";
import pg from "pg";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    family: 4,
  } as any);

  // Insert root admin
  const pwHash = hashPassword("RivalHub_password");
  const res = await pool.query(
    `INSERT INTO admin_users (username, password_hash, role)
     VALUES ($1, $2, 'super_admin')
     ON CONFLICT (username) DO NOTHING
     RETURNING id`,
    ["RivalHub_root", pwHash],
  );
  if (res.rows.length > 0) {
    console.log("Created root admin: RivalHub_root");
    console.warn(
      "\n⚠️  根管理员已创建，请立即登录后修改默认密码！\n" +
      "   用户名: RivalHub_root\n" +
      "   初始密码: RivalHub_password\n"
    );
  } else {
    console.log("Root admin already exists");
  }

  // Insert seasons
  for (const season of [
    {
      slug: "2026-nju-rivals",
      name: "2026 NJU Rivals",
      kind: "选秀联赛",
      status: "registration",
      themeColor: "#f97316",
      registrationMode: "solo",
      hasCaptainVoting: true,
      hasDraft: true,
      stagePlan: JSON.stringify([
        { key: "qualifier", name: "排位赛", type: "round_robin", teamCount: 8, advance: 8 },
        { key: "playoff", name: "正赛", type: "double_elim", teamCount: 8, advance: 1 },
      ]),
      registrationConfig: JSON.stringify({
        allowedPlayerTypes: ["enrolled"],
        rankThreshold: { currentMin: "A", peakMin: "A+" },
        maxPerPosition: 15,
        screenshotCount: 1,
      }),
      teamSize: 7,
      starterCount: 5,
      positions: "{igl,awper,opener,closer,anchor}",
    },
    {
      slug: "spring-2026-league",
      name: "2026 春季选秀联赛",
      kind: "联赛",
      status: "draft",
      themeColor: "#f97316",
      registrationMode: "solo",
      hasCaptainVoting: true,
      hasDraft: true,
      stagePlan: JSON.stringify([
        { key: "qualifier", name: "排位赛", type: "round_robin", teamCount: 8, advance: 8 },
        { key: "playoff", name: "正赛", type: "double_elim", teamCount: 8, advance: 1 },
      ]),
      registrationConfig: JSON.stringify({
        allowedPlayerTypes: ["enrolled"],
        rankThreshold: { currentMin: "A", peakMin: "A+" },
        maxPerPosition: 15,
        screenshotCount: 1,
      }),
      teamSize: 7,
      starterCount: 5,
      positions: "{igl,awper,opener,closer,anchor}",
    },
    {
      slug: "autumn-2026-open",
      name: "2026 秋季公开赛",
      kind: "杯赛",
      status: "draft",
      themeColor: "#ef4444",
      registrationMode: "team",
      hasCaptainVoting: false,
      hasDraft: false,
      stagePlan: JSON.stringify([
        { key: "qualifier", name: "排位赛", type: "round_robin", teamCount: 8, advance: 8 },
        { key: "playoff", name: "正赛", type: "double_elim", teamCount: 8, advance: 1 },
      ]),
      registrationConfig: JSON.stringify({
        allowedPlayerTypes: ["enrolled"],
        rankThreshold: { currentMin: "A", peakMin: "A+" },
        maxPerPosition: 15,
        screenshotCount: 1,
      }),
      teamSize: 5,
      starterCount: 5,
      positions: "{igl,awper,opener,closer,anchor}",
    },
  ]) {
    await pool.query(
      `INSERT INTO seasons (slug, name, kind, status, theme_color,
        registration_mode, has_captain_voting, has_draft,
        stage_plan, registration_config, team_size, starter_count, positions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (slug) DO NOTHING`,
      [
        season.slug, season.name, season.kind, season.status,
        season.themeColor, season.registrationMode, season.hasCaptainVoting,
        season.hasDraft, season.stagePlan, season.registrationConfig,
        season.teamSize, season.starterCount, season.positions,
      ],
    );
  }
  console.log("Seasons seeded");

  await pool.end();
  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
