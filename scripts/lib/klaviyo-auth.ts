import { Browser, BrowserContext } from "playwright";
import * as fs from "fs";
import * as path from "path";

const STATE_PATH = path.resolve(__dirname, "../../playwright-state.json");
const LOGIN_URL = "https://www.klaviyo.com/login";
const DASHBOARD_URL = "https://www.klaviyo.com/dashboard";

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [auth] ${msg}`);
}

export async function authenticateKlaviyo(
  browser: Browser
): Promise<BrowserContext> {
  const email = process.env.KLAVIYO_TEST_EMAIL;
  const password = process.env.KLAVIYO_TEST_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "KLAVIYO_TEST_EMAIL and KLAVIYO_TEST_PASSWORD must be set in environment"
    );
  }

  // Try to reuse saved session
  if (fs.existsSync(STATE_PATH)) {
    log("Found saved session, attempting to reuse...");
    try {
      const context = await browser.newContext({
        storageState: STATE_PATH,
      });
      const page = await context.newPage();
      await page.goto(DASHBOARD_URL, {
        waitUntil: "networkidle",
        timeout: 30_000,
      });

      // If we're still on a dashboard-like page, session is valid
      if (!page.url().includes("/login")) {
        log("Saved session is valid.");
        await page.close();
        return context;
      }

      log("Saved session expired, re-authenticating...");
      await context.close();
    } catch {
      log("Failed to reuse saved session, re-authenticating...");
    }
  }

  // Fresh login
  log("Logging into Klaviyo...");
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(LOGIN_URL, { waitUntil: "networkidle", timeout: 30_000 });

  await page.locator('input[name="email"], input[type="email"]').first().fill(email);
  await page.locator('input[name="password"], input[type="password"]').first().fill(password);
  await page.locator('button[type="submit"]').first().click();

  // Wait for navigation away from login page
  await page.waitForURL((url) => !url.toString().includes("/login"), {
    timeout: 30_000,
  });

  log("Login successful. Saving session state...");
  await context.storageState({ path: STATE_PATH });
  await page.close();

  return context;
}
