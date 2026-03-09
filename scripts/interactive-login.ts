/**
 * Opens a visible browser for manual login (CAPTCHA, MFA, etc).
 * Saves session to playwright-state.json for reuse by qa-runner.
 *
 * Usage: npx ts-node scripts/interactive-login.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import * as path from "path";
import { chromium } from "playwright";

const STATE_PATH = path.resolve(__dirname, "../playwright-state.json");
const LOGIN_URL = "https://www.klaviyo.com/login";

async function main(): Promise<void> {
  console.log("Launching visible browser for manual login...");
  console.log("Solve the CAPTCHA and log in. The script will detect when you're past the login page.\n");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

  // Pre-fill email if available
  const email = process.env.KLAVIYO_TEST_EMAIL;
  if (email) {
    try {
      await page.locator('input[name="email"], input[type="email"]').first().fill(email);
      console.log(`Pre-filled email: ${email}`);
    } catch {
      console.log("Could not pre-fill email, please type it manually.");
    }
  }

  // Pre-fill password if available
  const password = process.env.KLAVIYO_TEST_PASSWORD;
  if (password) {
    try {
      await page.locator('input[name="password"], input[type="password"]').first().fill(password);
      console.log("Pre-filled password.");
    } catch {
      console.log("Could not pre-fill password, please type it manually.");
    }
  }

  console.log("\nWaiting for you to complete login (CAPTCHA, MFA, etc)...");

  // Wait until we navigate away from the login page (up to 5 minutes)
  await page.waitForURL((url) => !url.toString().includes("/login"), {
    timeout: 300_000,
  });

  console.log("Login successful! Current URL:", page.url());
  console.log("Saving session state...");

  await context.storageState({ path: STATE_PATH });
  console.log(`Session saved to ${STATE_PATH}`);

  await browser.close();
  console.log("Done. The QA runner will now reuse this session.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
