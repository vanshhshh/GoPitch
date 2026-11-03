import { expect, test } from "@playwright/test";
import { completeOnboarding, shot, signUp, uniqueEmail } from "./helpers";

test.describe.configure({ mode: "serial" });

async function noHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("mobile: onboarding, navigation drawer and key pages fit 375px", async ({ page }) => {
  await signUp(page, uniqueEmail("mobile"));
  await completeOnboarding(page, "Pocket Pay");
  await noHorizontalOverflow(page);
  await page.getByRole("button", { name: "Build summary" }).click();
  await page.getByRole("button", { name: /This is accurate/ }).click();
  await page.getByRole("button", { name: "Finish and see my investor matches" }).click();
  await page.waitForURL(/\/dashboard\/investors/);

  for (const path of ["/dashboard", "/dashboard/investors", "/dashboard/company", "/dashboard/outreach", "/dashboard/analytics", "/dashboard/billing", "/dashboard/settings"]) {
    await page.goto(path);
    await expect(page.locator("main h1").first()).toBeVisible();
    await noHorizontalOverflow(page);
  }
  await shot(page, "mobile-settings");

  await page.getByRole("button", { name: "Open navigation" }).click();
  const nav = page.getByRole("dialog", { name: "Navigation" });
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "Investor Discovery" }).click();
  await page.waitForURL(/\/dashboard\/investors/);
  await expect(nav).toBeHidden();
  await shot(page, "mobile-discovery");
});
