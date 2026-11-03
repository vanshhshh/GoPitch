import { expect, Page } from "@playwright/test";

export const API = "http://localhost:4100";

/** Optional screenshots for review: set SCREENSHOT_DIR to collect them. */
export async function shot(page: Page, name: string) {
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png`, fullPage: true });
}

export function uniqueEmail(prefix = "founder") {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}@example.test`;
}

export async function signUp(page: Page, email: string, password = "s3cretpass") {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Asha Rao");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/onboarding/);
}

export async function signIn(page: Page, email: string, password = "s3cretpass") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Waits until the autosave indicator reports the latest change saved. */
export async function saved(page: Page) {
  await expect(page.getByRole("status").filter({ hasText: "Saved" }).first()).toBeVisible();
}

/** Completes the whole 7-step onboarding through the UI. */
export async function completeOnboarding(page: Page, company = "Velo Pay") {
  await page.getByLabel("Company name").fill(company);
  await page.getByRole("button", { name: "Start" }).click();

  // 1. Founders — edit the account holder's own profile
  await expect(page.getByRole("heading", { name: "Founding team" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Asha Rao/ })).toHaveAttribute("aria-expanded", "true");
  await page.getByLabel("Role").fill("CEO");
  await page.getByLabel("Professional experience").fill("8 years building payments infrastructure at a bank.");
  await saved(page);
  await page.getByRole("button", { name: "Next" }).click();

  // 2. Company
  await expect(page.getByRole("heading", { name: "Company overview" })).toBeVisible();
  await page.getByLabel("Headquarters").fill("India");
  await page.getByLabel("One-line description").fill("Instant cross-border payouts for freelancers");
  await page.getByRole("button", { name: "+ Fintech" }).click();
  await page.getByRole("button", { name: "SaaS", exact: true }).click();
  await page.getByRole("button", { name: "B2B", exact: true }).click();
  await page.getByLabel("Problem").fill("Freelancers wait weeks and lose 5% to fees when paid from abroad.");
  await page.getByLabel("Your solution").fill("Same-day payouts at a flat 1% fee.");
  await saved(page);
  await page.getByRole("button", { name: "Next" }).click();

  // 3. Product & market
  await page.getByRole("button", { name: "Launched", exact: true }).click();
  const geo = page.getByLabel("Target geography");
  await geo.fill("India");
  await geo.press("Enter");
  await saved(page);
  await page.getByRole("button", { name: "Next" }).click();

  // 4. Traction — SaaS + launched → SaaS metrics are asked, idea-stage ones aren't
  await expect(page.getByRole("heading", { name: "Traction" })).toBeVisible();
  await expect(page.getByLabel("Monthly churn (%)")).toBeVisible();
  await expect(page.getByLabel("Waitlist sign-ups")).toHaveCount(0);
  await page.getByLabel("Paying customers").fill("40");
  await saved(page);
  await page.getByRole("button", { name: "Next" }).click();

  // 5. Fundraising
  await page.getByRole("button", { name: "Seed", exact: true }).click();
  await page.getByLabel("Target raise (USD)").fill("500000");
  await saved(page);
  await page.getByRole("button", { name: "Next" }).click();

  // 6. Preferences (optional) → 7. Documents & review
  await expect(page.getByRole("heading", { name: "Investor preferences" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Review your profile" })).toBeVisible();
}
