import { expect, signInProgrammatically, test } from "../fixtures";

test.use({ scenarioProfile: "major-prestart" });

test("管理员可以选择并保存 Major-24 profile", async ({ page, scenario }) => {
  const admin = scenario.accounts.find((account) => account.key === "admin");
  if (!admin) throw new Error(`E2E scenario ${scenario.scenarioId} 缺少管理员账号。`);

  await signInProgrammatically(page, admin, scenario, "/admin/seasons/new");
  const profileSelect = page.getByRole("combobox", { name: "Major 正赛规模" });
  await expect(profileSelect).toBeVisible();
  await profileSelect.click();
  await page.getByRole("option", { name: "Major 24", exact: true }).click();
  await expect(page.getByText(/24 支队伍；队伍整体报名；每队 5–9 人；2 个瑞士轮阶段/)).toBeVisible();
  await expect(page.getByText(/阶段一、阶段二全部 BO3/)).toBeVisible();

  const slug = `e2e-major24-${scenario.shortKey}`;
  await page.getByLabel("名称").fill(`E2E Major 24 ${scenario.shortKey}`);
  await page.getByLabel("Slug").fill(slug);
  await page.getByRole("button", { name: "保存为草稿" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/admin/${slug}/settings$`));
  await expect(page.getByRole("combobox", { name: "Major 正赛规模" })).toContainText("Major 24");
});
