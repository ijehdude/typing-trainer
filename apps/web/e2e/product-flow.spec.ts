import { expect, test, type Page } from "@playwright/test";

/**
 * The core product journey (PRD §23 Phase 1 acceptance): a brand-new user
 * reaches a personalized first diagnosis, then completes an Autopilot
 * session and gets a report. Block time budgets are capped via the e2e
 * escape hatch so the whole session runs in seconds.
 */

/** Type whatever the live surface currently expects; false if no surface. */
async function typeCurrent(page: Page, chunk = 50): Promise<boolean> {
  const next = await page
    .evaluate((n) => {
      const c = (window as unknown as {
        __typing?: { targetText: string; cursorIndex: number; isDone: boolean };
      }).__typing;
      if (!c || c.isDone) return null;
      return c.targetText.slice(c.cursorIndex, c.cursorIndex + n);
    }, chunk)
    .catch(() => null);
  if (!next || next.length === 0) return false;
  await page.keyboard.type(next, { delay: 8 });
  return true;
}

test("onboarding → first diagnosis → full session → report", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/");
  const startLink = page.getByRole("link", { name: "Start typing" });
  await expect(startLink).toBeVisible();
  await startLink.click();

  const calibrateBtn = page.getByRole("button", { name: "Start the calibration" });
  await expect(calibrateBtn).toBeVisible();
  await calibrateBtn.click();
  await expect(page.getByTestId("typing-surface")).toBeVisible();
  await page.getByTestId("typing-surface").click();

  // Drive all three calibration parts; typing flows across part boundaries.
  for (let i = 0; i < 150; i++) {
    if (await page.getByTestId("first-diagnosis").isVisible().catch(() => false)) break;
    const typed = await typeCurrent(page);
    if (!typed) {
      await page.waitForTimeout(400); // between parts / analyzing
      await page.getByTestId("typing-surface").click({ timeout: 500 }).catch(() => {});
    }
  }
  await expect(page.getByTestId("first-diagnosis")).toBeVisible({ timeout: 20_000 });
  const diagnosis = await page.getByTestId("first-diagnosis").textContent();
  expect(diagnosis).toMatch(/You type at \d+ WPM/);
  expect(diagnosis).toMatch(/accuracy is \d/);

  // The first session, with capped block budgets for e2e speed.
  await page.goto("/session?minutes=5&blockSec=4");
  await expect(page.getByTestId("session-open")).toBeVisible({ timeout: 20_000 });
  const openText = await page.getByTestId("session-open").textContent();
  expect(openText).toMatch(/Warm-up/);
  expect(openText).toMatch(/Speed test/);
  await page.getByRole("button", { name: "Start" }).click();

  // Single driver loop: type in blocks, continue at boundaries, stop at report.
  for (let i = 0; i < 300; i++) {
    if (await page.getByTestId("session-report").isVisible().catch(() => false)) break;
    const boundaryBtn = page.getByRole("button", { name: /Continue|Finish session/ });
    if (await boundaryBtn.isVisible().catch(() => false)) {
      await expect(boundaryBtn).toBeEnabled({ timeout: 5_000 });
      await boundaryBtn.click();
      await page.waitForTimeout(300);
      await page.getByTestId("typing-surface").click({ timeout: 500 }).catch(() => {});
      continue;
    }
    const typed = await typeCurrent(page);
    if (!typed) {
      await page.waitForTimeout(400);
      await page.getByTestId("typing-surface").click({ timeout: 500 }).catch(() => {});
    }
  }

  await expect(page.getByTestId("session-report")).toBeVisible({ timeout: 30_000 });
  const report = await page.getByTestId("session-report").textContent();
  expect(report).toMatch(/wpm/i);
  expect(report).toContain("Overall typing skill");

  // The home screen now has continuity: journey bar + today's workout.
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("journey-bar")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("todays-workout")).toBeVisible();

  // Dashboard renders with real data.
  await page.goto("/dashboard");
  await expect(page.getByText("Typing performance")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Current speed")).toBeVisible();

  // "Why am I stuck?" produces an actionable page even this early.
  await page.goto("/stuck");
  await expect(page.getByTestId("stuck-report")).toBeVisible({ timeout: 15_000 });
});
