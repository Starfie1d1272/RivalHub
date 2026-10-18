/** @vitest-environment node */
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { SeasonParticipationEntry } from "@/app/[seasonSlug]/layout";
import { getSeasonPersonalNextStep } from "@/lib/seasons/public-next-step";
import { createMajorDefaultCapabilities } from "@/lib/competition/templates";
import type { PublicSeason } from "@/lib/data/public-seasons";
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/lib/seasons/public-next-step", () => ({ getSeasonPersonalNextStep: vi.fn().mockResolvedValue(null) }));
const season: PublicSeason = { ...createMajorDefaultCapabilities(), id: "fixture", competitionTemplate: "major", slug: "major", name: "Major", kind: "Major", status: "registration", themeColor: null, logoUrl: null, registrationOpensAt: new Date("2000-01-01"), registrationOpenedAt: new Date("2000-01-01"), registrationClosesAt: new Date("2000-02-01"), rosterChangeClosesAt: null, endAt: null };
// A closed new-registration window must not remove existing Major Entry work.
it("retains the Major participation destination after registration closes", async () => {
  expect(renderToStaticMarkup(await SeasonParticipationEntry({ season }))).toContain('href="/major/register"');
  expect(renderToStaticMarkup(await SeasonParticipationEntry({ season }))).toContain("参赛事务");
  expect(await SeasonParticipationEntry({ season: { ...season, registrationMode: "solo" } })).toBeNull();
  expect(await SeasonParticipationEntry({ season: { ...season, status: "archived" } })).toBeNull();
});
it("uses the existing personal task projection instead of guessing eligibility", async () => {
  vi.mocked(getSeasonPersonalNextStep).mockResolvedValueOnce({ title: "维护本届名单", detail: "需要本人处理", href: "/my/competitions" });
  const html = renderToStaticMarkup(await SeasonParticipationEntry({ season }));
  expect(html).toContain('href="/my/competitions"');
  expect(html).toContain("维护本届名单");
});
