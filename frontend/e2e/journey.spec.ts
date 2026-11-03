import { expect, test } from "@playwright/test";
import { API, completeOnboarding, shot, signIn, signUp, uniqueEmail } from "./helpers";

test.describe.configure({ mode: "serial" });

const email = uniqueEmail();

test("protected pages require sign-in", async ({ page }) => {
  await page.goto("/dashboard/company");
  await page.waitForURL(/\/login/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("signup → 7-step onboarding with resume → confirmed summary → matches", async ({ page }) => {
  await signUp(page, email);
  await completeOnboarding(page);

  // Resume: a refresh comes back to the same step from the server.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Review your profile" })).toBeVisible();

  // Finishing is blocked until the summary is confirmed.
  const finish = page.getByRole("button", { name: "Finish and see my investor matches" });
  await expect(finish).toBeDisabled();
  await page.getByRole("button", { name: "Build summary" }).click();
  await expect(page.getByText("AI classification").first()).toBeVisible();
  await expect(page.getByText("Inferred — check").first()).toBeVisible();
  await shot(page, "onboarding-review");
  await page.getByRole("button", { name: /This is accurate/ }).click();
  await expect(finish).toBeEnabled();
  await finish.click();

  await page.waitForURL(/\/dashboard\/investors/);
  await expect(page.getByRole("heading", { name: "Investor Discovery" })).toBeVisible();
  await expect(page.getByText(/more investors/)).toBeVisible();
  await shot(page, "discovery");
});

test("discovery → fund → select people → guided campaign → review → launch → send", async ({ page }) => {
  await signIn(page, email);
  await page.waitForURL(/\/dashboard/);

  await page.goto("/dashboard/investors?view=funds");
  const fund = page.getByRole("link", { name: /Example Fund/ }).first();
  await fund.click();
  await expect(page.getByText("People at this fund")).toBeVisible();
  await expect(page.getByText("Recommended contact")).toBeVisible();
  await shot(page, "fund");
  await page.getByRole("button", { name: "Add", exact: true }).first().click();

  // Back to the list keeps context; select two more people.
  await page.goto("/dashboard/investors");
  const addButtons = page.getByRole("button", { name: "Add to campaign" });
  await addButtons.nth(0).click();
  await addButtons.nth(0).click(); // list re-renders: next unselected card
  await expect(page.getByText(/3 investors selected/)).toBeVisible();

  // "Why this match?" drawer shows evidence-based breakdown.
  await page.getByRole("button", { name: "Why this match?" }).first().click();
  await expect(page.getByRole("dialog").getByText(/based on \d+% of the criteria/)).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Create campaign" }).last().click();
  await page.waitForURL(/\/dashboard\/outreach\/new/);
  await expect(page.getByText("Investors I selected (3)")).toBeVisible();
  await page.getByRole("button", { name: "Continue with 3" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Campaign name").fill("Seed round outreach");
  await page.getByRole("button", { name: "Create drafts" }).click();

  await page.waitForURL(/\/dashboard\/outreach\/campaigns\//);
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
  await shot(page, "campaign-draft");

  // Edit one draft before launch.
  await page.locator("details summary").first().click();
  await page.getByLabel("Subject").first().fill("Velo Pay — quick intro");
  await page.getByRole("button", { name: "Save draft" }).first().click();
  await expect(page.getByText("Draft saved.")).toBeVisible();

  await page.getByRole("button", { name: "Launch campaign" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Launch" }).click();
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();

  // Sending needs Gmail: the button is disabled until it's connected (simulated here).
  await expect(page.getByRole("button", { name: /Send next/ })).toBeDisabled();
  const userEmail = email;
  await page.evaluate(async ([api, e]) => fetch(`${api}/__e2e/connect-gmail/${encodeURIComponent(e)}`, { method: "POST" }), [API, userEmail]);
  await page.reload();
  await page.getByRole("button", { name: "Send next 3" }).click();
  await expect(page.getByText("3 emails sent.")).toBeVisible();
  const sent = await page.evaluate(async (api) => (await (await fetch(`${api}/__e2e/sent`)).json()) as { subject: string }[], API);
  expect(sent.some((s) => s.subject === "Velo Pay — quick intro")).toBe(true);
  await shot(page, "campaign-active");
});

test("overview, analytics and outreach reflect real records and link to them", async ({ page }) => {
  await signIn(page, email);
  await page.waitForURL(/\/dashboard/);
  await page.goto("/dashboard");
  await expect(page.getByText("Next step")).toBeVisible();
  await expect(page.getByRole("link", { name: /Sent/ }).first()).toBeVisible();
  await shot(page, "overview");

  await page.goto("/dashboard/analytics");
  await expect(page.getByText("Outreach funnel")).toBeVisible();
  await page.getByRole("link", { name: /^Sent/ }).first().click();
  await page.waitForURL(/tab=activity&status=SENT/);
  await expect(page.getByRole("button", { name: /Sent 3/ })).toBeVisible();
  await shot(page, "outreach-activity");
});

test("my company edits autosave and deep links focus the field", async ({ page }) => {
  await signIn(page, email);
  await page.waitForURL(/\/dashboard/);
  await page.goto("/dashboard/company?section=fundraising&field=targetAmountUsd");
  await expect(page.locator("#field-targetAmountUsd")).toBeFocused();
  await page.locator("#field-targetAmountUsd").fill("750000");
  await expect(page.getByText("Saved")).toBeVisible();
  await page.reload();
  await expect(page.locator("#field-targetAmountUsd")).toHaveValue("750000");
  await shot(page, "my-company");
});

test("enterprise enquiry and billing plans", async ({ page }) => {
  await signIn(page, email);
  await page.waitForURL(/\/dashboard/);
  await page.goto("/dashboard/billing");
  await expect(page.getByText("₹4,499")).toBeVisible();
  await page.getByRole("button", { name: "Talk to Sales" }).click();
  await page.getByLabel("Full name *").fill("Priya");
  await page.getByLabel("Company name *").fill("Acme");
  await page.getByLabel("Business email *").fill("priya@acme.test");
  await page.getByLabel("Phone number *").fill("+91 98765 43210");
  await page.getByLabel("Expected email volume *").selectOption("500-2000");
  await page.getByLabel("Requirements *").fill("Three raises");
  await page.getByRole("button", { name: "Submit enquiry" }).click();
  await expect(page.getByText("Thank you. Our sales team will contact you soon.")).toBeVisible();
});

test("founders can't open admin; admins see matching weights", async ({ page }) => {
  await signIn(page, email);
  await page.waitForURL(/\/dashboard/);
  await page.goto("/admin");
  await page.waitForURL(/\/dashboard/);

  await page.getByRole("button", { name: "Sign out" }).first().click();
  await page.waitForURL(/\/login/);
  await signIn(page, "admin@example.test", "admin1234");
  await page.waitForURL(/\/admin/);
  await page.goto("/admin/settings");
  await expect(page.getByText("Matching weights")).toBeVisible();
  await expect(page.getByText("Total: 100 / 100")).toBeVisible();
});
