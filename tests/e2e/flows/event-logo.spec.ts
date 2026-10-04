import { expect, test, signInProgrammatically } from "../fixtures";

test.use({ scenarioProfile: "layout" });
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2foAAAAASUVORK5CYII=", "base64");

test("赛事 Logo 正常上传、更换与移除更新公开展示", async ({ page, scenario, browser }) => {
  const admin = scenario.accounts.find(account => account.key === "admin")!;
  const publicContext = await browser.newContext();
  const viewer = await publicContext.newPage();
  try {
    // Prime the public cache with the historical null state before mutation.
    await viewer.goto(`/${scenario.slug}`);
    await expect(viewer.getByRole("heading", { name: scenario.seasonName, exact: true })).toBeVisible();
    await expect(viewer.getByAltText("赛事 Logo")).toHaveCount(0);
    await signInProgrammatically(page, admin, scenario, `/admin/operations/season-info/${scenario.slug}`);
    await expect(page.getByText("尚未上传赛事 Logo", { exact: true })).toBeVisible();
    await page.getByLabel("上传赛事 Logo", { exact: true }).setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
    await expect(page.getByText("请选择非空的 JPG、PNG 或 WebP 图片，最大 1 MB。", { exact: true })).toBeVisible();
    await expect(page.getByAltText("赛事 Logo")).toHaveCount(0);
    await page.getByLabel("上传赛事 Logo", { exact: true }).setInputFiles({ name: "event.png", mimeType: "image/png", buffer: png });
    const adminLogo = page.getByAltText("赛事 Logo");
    await expect(adminLogo).toBeVisible();
    const firstUrl = await adminLogo.getAttribute("src");
    expect(firstUrl).toContain(`/season-public-assets/${scenario.seasonId}/event-logo/`);
    await viewer.reload();
    await expect(viewer.getByAltText("赛事 Logo")).toHaveAttribute("src", firstUrl!);
    await expect.poll(() => viewer.getByAltText("赛事 Logo").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await viewer.goto("/seasons");
    await expect(viewer.locator(`a[href="/${scenario.slug}"]`).getByAltText("赛事 Logo")).toHaveAttribute("src", firstUrl!);

    await page.getByLabel("更换赛事 Logo", { exact: true }).setInputFiles({ name: "replacement.png", mimeType: "image/png", buffer: png });
    await expect(adminLogo).not.toHaveAttribute("src", firstUrl!);
    const replacementUrl = await adminLogo.getAttribute("src");
    await viewer.goto(`/${scenario.slug}`);
    await expect(viewer.getByAltText("赛事 Logo")).toHaveAttribute("src", replacementUrl!);
    const oldObject = await viewer.request.get(firstUrl!);
    expect(oldObject.ok()).toBe(false);
    expect(await oldObject.json()).toMatchObject({ message: "Object not found" });
    await page.getByRole("button", { name: "移除赛事 Logo", exact: true }).click();
    await expect(page.getByText("尚未上传赛事 Logo", { exact: true })).toBeVisible();
    await viewer.reload();
    await expect(viewer.getByAltText("赛事 Logo")).toHaveCount(0);
    await expect(viewer.getByRole("heading", { name: scenario.seasonName, exact: true })).toBeVisible();
    const removedObject = await viewer.request.get(replacementUrl!);
    expect(removedObject.ok()).toBe(false);
    expect(await removedObject.json()).toMatchObject({ message: "Object not found" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  } finally { await publicContext.close(); }
});
