import { Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

export class PlaywrightController {
  constructor(private page: Page) {}

  async screenshot(savePath?: string): Promise<string> {
    const buffer = await this.page.screenshot({ fullPage: true });
    const base64 = buffer.toString("base64");

    if (savePath) {
      const dir = path.dirname(savePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(savePath, buffer);
    }

    return base64;
  }

  async click(selector: string): Promise<void> {
    await this.page.locator(selector).first().click({ timeout: 10_000 });
  }

  async type(selector: string, text: string): Promise<void> {
    const locator = this.page.locator(selector).first();
    await locator.click({ timeout: 10_000 });
    await locator.fill(text);
  }

  async navigate(url: string): Promise<void> {
    await this.page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
  }

  async waitForSelector(
    selector: string,
    timeout: number = 10_000
  ): Promise<void> {
    await this.page.locator(selector).first().waitFor({ timeout });
  }

  getCurrentUrl(): string {
    return this.page.url();
  }
}
