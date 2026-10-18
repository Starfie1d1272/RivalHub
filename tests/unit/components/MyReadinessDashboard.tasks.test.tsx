import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MyReadinessDashboard } from "@/components/my/MyReadinessDashboard";
import type { MyReadinessItem, MyReadinessModel } from "@/lib/my/readiness";
import type { MyWorkspaceModel } from "@/lib/my/workspace";
afterEach(cleanup);
const ready: MyReadinessItem = { id: "profile", title: "个人资料", state: "ready", detail: "已齐全", cta: { href: "/settings", label: "查看资料" } };
function model(secondDetail = "补齐当前赛季段位和 Rating。"): MyWorkspaceModel {
  const tasks: MyReadinessItem[] = ["spring", "autumn"].map((slug, index) => ({ id: `qualification-${slug}`, title: "个人竞技资料", state: "blocked", detail: index === 0 ? "补齐当前赛季段位和 Rating。" : secondDetail, responsibility: "self", cta: { href: `/${slug}/register`, label: "查看并补齐资料" } }));
  const competitions: MyReadinessModel["competitions"] = tasks.map((qualification, index) => ({ id: String(index), name: "Alpha", seasonName: index === 0 ? "春季 Major" : "秋季 Major", href: qualification.cta.href, entry: { ...ready, id: `entry-${index}` }, qualification, sanctions: [] }));
  return { displayName: "Viewer", tasks, upcomingMatches: [], currentTeam: null, currentCompetitions: [], historyCompetitions: [], sanctions: [], readiness: { displayName: "Viewer", profile: ready, education: { ...ready, id: "education", title: "教育认证" }, competitiveProfiles: [], team: { ...ready, id: "team", title: "当前队伍" }, competitions, sanctions: [] } };
}
// A shared deficiency must not hide a second event's actual action destination.
it("shows a shared qualification deficiency once and preserves both event actions", () => {
  render(<MyReadinessDashboard model={model()} />);
  expect(screen.getAllByText("补齐当前赛季段位和 Rating。")).toHaveLength(1);
  expect(screen.getByRole("link", { name: "春季 Major · Alpha · 查看并补齐资料" })).toHaveAttribute("href", "/spring/register");
  expect(screen.getByRole("link", { name: "秋季 Major · Alpha · 查看并补齐资料" })).toHaveAttribute("href", "/autumn/register");
});
it("retains distinct event deficiencies rather than folding them into the first", () => {
  render(<MyReadinessDashboard model={model("请完成本届教育认证。")} />);
  expect(screen.getByText("补齐当前赛季段位和 Rating。")).toBeVisible();
  expect(screen.getByText("请完成本届教育认证。")).toBeVisible();
  expect(screen.getByText("春季 Major · Alpha")).toBeVisible();
  expect(screen.getByText("秋季 Major · Alpha")).toBeVisible();
});

it("coalesces the profile reminder without losing profile or event destinations", () => {
  const data = model("请填写 QQ 号。");
  for (const task of data.tasks) task.detail = "请填写 QQ 号。";
  data.readiness.profile = { ...ready, state: "incomplete", detail: "请填写 QQ 号。", responsibility: "self", cta: { href: "/settings", label: "完善参赛资料" } };
  data.tasks.push(data.readiness.profile);
  render(<MyReadinessDashboard model={data} />);
  expect(screen.getAllByText("请填写 QQ 号。")).toHaveLength(1);
  expect(screen.getByRole("link", { name: "完善参赛资料" })).toHaveAttribute("href", "/settings");
  expect(screen.getByRole("link", { name: "春季 Major · Alpha · 查看并补齐资料" })).toHaveAttribute("href", "/spring/register");
  expect(screen.getByRole("link", { name: "秋季 Major · Alpha · 查看并补齐资料" })).toHaveAttribute("href", "/autumn/register");
});
