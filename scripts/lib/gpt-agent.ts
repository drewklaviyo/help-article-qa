import OpenAI from "openai";
import * as path from "path";
import { PlaywrightController } from "./playwright-controller";
import { ArticleContent } from "./article-fetcher";
import { ReferencedPage, AuditFinding, ArticleResult } from "./types";

const GPT_MODEL = "gpt-5.4";
const MAX_RETRIES = 3;
const MAX_PAGES_PER_ARTICLE = 5;

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [audit] ${msg}`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGPT(
  openai: OpenAI,
  messages: OpenAI.ChatCompletionMessageParam[]
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: GPT_MODEL,
        response_format: { type: "json_object" },
        max_completion_tokens: 2048,
        messages,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("GPT returned empty response");
      return content
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/, "")
        .trim();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      log(`GPT call attempt ${attempt}/${MAX_RETRIES} failed: ${lastError.message}`);
      if (attempt < MAX_RETRIES) {
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }
  }
  throw lastError ?? new Error("GPT call failed after all retries");
}

/**
 * Step 1: Ask GPT what Klaviyo pages this article references.
 */
async function identifyReferencedPages(
  openai: OpenAI,
  articleTitle: string,
  articleText: string
): Promise<ReferencedPage[]> {
  log("Identifying pages referenced by article...");

  // Truncate article text to avoid token limits
  const truncatedText = articleText.slice(0, 8000);

  const content = await callGPT(openai, [
    {
      role: "system",
      content: `You analyze Klaviyo help articles and identify which pages in the Klaviyo app (app.klaviyo.com) the article references. Return JSON with key "pages" containing an array of objects with "pageName" (human label) and "urlPath" (the Klaviyo app URL path).

Common Klaviyo URL paths:
- /dashboard - Main dashboard
- /flows - Flows list
- /flows/create - Create new flow
- /campaigns - Campaigns list
- /campaigns/create - Create campaign
- /lists-segments - Lists & Segments
- /segments/create - Create segment
- /signup-forms - Sign-up forms
- /content/template - Email templates
- /settings - Account settings
- /settings/api-keys - API keys
- /integrations - Integrations
- /analytics - Analytics
- /profiles - Profiles

Only include pages that the article specifically describes navigating to or interacting with. Max 5 pages. If the article is about a third-party integration setup (e.g., "in Shopify, go to..."), only include the Klaviyo-side pages.`,
    },
    {
      role: "user",
      content: `Article title: "${articleTitle}"\n\nArticle text:\n${truncatedText}`,
    },
  ]);

  const parsed = JSON.parse(content) as { pages: ReferencedPage[] };
  if (!Array.isArray(parsed.pages)) return [];

  return parsed.pages.slice(0, MAX_PAGES_PER_ARTICLE);
}

/**
 * Step 2: Navigate to each page and take a screenshot.
 */
async function screenshotPages(
  controller: PlaywrightController,
  pages: ReferencedPage[],
  screenshotDir: string
): Promise<{ page: ReferencedPage; base64: string; path: string }[]> {
  const results: { page: ReferencedPage; base64: string; path: string }[] = [];

  for (const page of pages) {
    const url = `https://www.klaviyo.com${page.urlPath}`;
    const screenshotPath = path.join(
      screenshotDir,
      `${page.pageName.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.png`
    );

    log(`  Navigating to ${page.pageName} (${url})...`);
    try {
      await controller.navigate(url);
      await sleep(2000); // Let SPA render
      const base64 = await controller.screenshot(screenshotPath);
      results.push({ page, base64, path: screenshotPath });
      log(`  Screenshot saved.`);
    } catch (err) {
      log(`  Failed to load ${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return results;
}

/**
 * Step 3: Send article content + live screenshots to GPT for comparison.
 */
async function auditArticleAgainstScreenshots(
  openai: OpenAI,
  articleTitle: string,
  articleText: string,
  screenshots: { page: ReferencedPage; base64: string }[]
): Promise<AuditFinding[]> {
  log("Running visual audit comparison...");

  const truncatedText = articleText.slice(0, 6000);

  const imageContent: OpenAI.ChatCompletionContentPart[] = screenshots.map((s) => ({
    type: "image_url" as const,
    image_url: {
      url: `data:image/png;base64,${s.base64}`,
      detail: "high" as const,
    },
  }));

  const pageList = screenshots
    .map((s, i) => `Image ${i + 1}: ${s.page.pageName} (${s.page.urlPath})`)
    .join("\n");

  const content = await callGPT(openai, [
    {
      role: "system",
      content: `You are a QA auditor comparing Klaviyo help article text against live screenshots of the Klaviyo app. Your job is to find mismatches where the documentation no longer matches the actual UI.

Check for:
- Buttons/links mentioned in the article that don't appear in the screenshots (renamed, moved, or removed)
- Navigation paths that have changed (e.g., article says "click Settings > API Keys" but the menu structure is different)
- UI elements described in the article that look different in the screenshots
- Page layouts or terminology that has changed

Do NOT flag:
- Content that can't be verified from these screenshots (e.g., article mentions a modal dialog we haven't opened)
- Minor wording differences that don't affect usability
- Features that require specific account setup to see

Return JSON with key "findings" containing an array of objects:
{
  "element": "What was checked (e.g., 'Create Flow button')",
  "status": "match" | "mismatch" | "unable-to-verify",
  "detail": "Explanation of what matches or doesn't match"
}

Include both matches and mismatches. Be specific about what you see vs what the article says.`,
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Article: "${articleTitle}"\n\nScreenshots taken from these pages:\n${pageList}\n\nArticle text:\n${truncatedText}`,
        },
        ...imageContent,
      ],
    },
  ]);

  const parsed = JSON.parse(content) as { findings: AuditFinding[] };
  if (!Array.isArray(parsed.findings)) return [];
  return parsed.findings;
}

/**
 * Main entry point: run visual audit for one article.
 */
export async function runArticleAudit(
  controller: PlaywrightController,
  articleId: string,
  articleName: string,
  articleUrl: string,
  articleContent: ArticleContent,
  screenshotDir: string
): Promise<ArticleResult> {
  const openai = new OpenAI();
  const startTime = Date.now();
  const allScreenshots: string[] = [];

  log(`Starting audit for "${articleName}"`);

  try {
    // Step 1: Identify which pages the article references
    const referencedPages = await identifyReferencedPages(
      openai,
      articleContent.title || articleName,
      articleContent.bodyText
    );

    if (referencedPages.length === 0) {
      log("No Klaviyo pages identified in article.");
      return {
        articleId,
        articleName,
        articleUrl,
        passed: true,
        pagesChecked: 0,
        findings: [
          {
            element: "Article scope",
            status: "unable-to-verify",
            detail: "No specific Klaviyo app pages identified in this article.",
          },
        ],
        screenshots: [],
        durationMs: Date.now() - startTime,
      };
    }

    log(`Found ${referencedPages.length} pages to check: ${referencedPages.map((p) => p.pageName).join(", ")}`);

    // Step 2: Navigate to each page and screenshot
    const screenshotResults = await screenshotPages(
      controller,
      referencedPages,
      screenshotDir
    );
    allScreenshots.push(...screenshotResults.map((s) => s.path));

    if (screenshotResults.length === 0) {
      log("Failed to capture any screenshots.");
      return {
        articleId,
        articleName,
        articleUrl,
        passed: false,
        pagesChecked: 0,
        findings: [
          {
            element: "Page navigation",
            status: "mismatch",
            detail: "Could not load any of the referenced Klaviyo pages.",
          },
        ],
        screenshots: [],
        durationMs: Date.now() - startTime,
        error: "Failed to capture screenshots",
      };
    }

    // Step 3: Visual audit comparison
    const findings = await auditArticleAgainstScreenshots(
      openai,
      articleContent.title || articleName,
      articleContent.bodyText,
      screenshotResults
    );

    const mismatches = findings.filter((f) => f.status === "mismatch");
    const featureUnavailable = findings.some(
      (f) =>
        f.status === "unable-to-verify" &&
        (f.detail.toLowerCase().includes("upgrade") ||
          f.detail.toLowerCase().includes("not available") ||
          f.detail.toLowerCase().includes("plan"))
    );

    log(
      `Audit complete: ${findings.length} findings (${mismatches.length} mismatches)`
    );

    return {
      articleId,
      articleName,
      articleUrl,
      passed: mismatches.length === 0,
      featureUnavailable,
      pagesChecked: screenshotResults.length,
      findings,
      screenshots: allScreenshots,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Audit error: ${msg}`);
    return {
      articleId,
      articleName,
      articleUrl,
      passed: false,
      pagesChecked: 0,
      findings: [],
      screenshots: allScreenshots,
      durationMs: Date.now() - startTime,
      error: msg,
    };
  }
}
