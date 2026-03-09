import * as dotenv from "dotenv";
dotenv.config({ override: true });

import * as fs from "fs";
import * as path from "path";
import { chromium } from "playwright";
import { authenticateKlaviyo } from "./lib/klaviyo-auth";
import { fetchArticleContent } from "./lib/article-fetcher";
import { runArticleAudit } from "./lib/gpt-agent";
import { PlaywrightController } from "./lib/playwright-controller";
import { postSlackReport } from "./lib/slack-reporter";
import { Article, AccountConfig, ArticleResult, QARunSummary } from "./lib/types";

const BATCH_SIZE = 3;
const DELAY_BETWEEN_BATCHES_MS = 2000;

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [runner] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function runSingleArticle(
  contextFactory: () => Promise<{ controller: PlaywrightController; close: () => Promise<void> }>,
  article: Article,
  screenshotBaseDir: string
): Promise<ArticleResult> {
  const startTime = Date.now();
  const screenshotDir = path.join(screenshotBaseDir, article.id);

  log(`--- Auditing: ${article.name} ---`);

  // Fetch article content
  let articleContent;
  try {
    articleContent = await fetchArticleContent(article.url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Failed to fetch article: ${msg}`);
    return {
      articleId: article.id,
      articleName: article.name,
      articleUrl: article.url,
      passed: false,
      pagesChecked: 0,
      findings: [],
      screenshots: [],
      durationMs: Date.now() - startTime,
      error: msg,
    };
  }

  if (articleContent.is404) {
    log(`Article is BROKEN (404): ${article.url}`);
    return {
      articleId: article.id,
      articleName: article.name,
      articleUrl: article.url,
      passed: false,
      broken: true,
      pagesChecked: 0,
      findings: [],
      screenshots: [],
      durationMs: Date.now() - startTime,
    };
  }

  if (articleContent.bodyText.length < 50) {
    log("Article body too short, skipping.");
    return {
      articleId: article.id,
      articleName: article.name,
      articleUrl: article.url,
      passed: true,
      pagesChecked: 0,
      findings: [{ element: "Article content", status: "unable-to-verify", detail: "Article body too short to audit" }],
      screenshots: [],
      durationMs: Date.now() - startTime,
    };
  }

  // Run visual audit
  const { controller, close } = await contextFactory();
  try {
    return await runArticleAudit(
      controller,
      article.id,
      article.name,
      article.url,
      articleContent,
      screenshotDir
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Unexpected error: ${msg}`);
    return {
      articleId: article.id,
      articleName: article.name,
      articleUrl: article.url,
      passed: false,
      pagesChecked: 0,
      findings: [],
      screenshots: [],
      durationMs: Date.now() - startTime,
      error: msg,
    };
  } finally {
    await close();
  }
}

async function runBatch(
  batch: Article[],
  contextFactory: () => Promise<{ controller: PlaywrightController; close: () => Promise<void> }>,
  screenshotBaseDir: string
): Promise<ArticleResult[]> {
  return Promise.all(
    batch.map((article) => runSingleArticle(contextFactory, article, screenshotBaseDir))
  );
}

async function main(): Promise<void> {
  const runId = generateRunId();
  const runStart = Date.now();

  log(`=== Help Article QA Audit: ${runId} ===`);

  // Parse CLI args
  const args = process.argv.slice(2);
  const limitFlag = args.find((a) => a.startsWith("--limit="));
  const tagFlag = args.find((a) => a.startsWith("--tag="));
  const limit = limitFlag ? parseInt(limitFlag.split("=")[1], 10) : 0;
  const tagFilter = tagFlag ? tagFlag.split("=")[1] : "";

  // Load articles
  const articlesPath = path.resolve(__dirname, "../articles.json");
  let articles: Article[] = JSON.parse(fs.readFileSync(articlesPath, "utf-8"));

  // Filter by disabled features
  const accountConfigPath = path.resolve(__dirname, "../account-config.json");
  if (fs.existsSync(accountConfigPath)) {
    const accountConfig: AccountConfig = JSON.parse(
      fs.readFileSync(accountConfigPath, "utf-8")
    );
    const disabled = new Set(accountConfig.disabledFeatures.map((f) => f.toLowerCase()));
    const before = articles.length;
    articles = articles.filter(
      (a) => !a.tags.some((t) => disabled.has(t.toLowerCase()))
    );
    const skippedCount = before - articles.length;
    if (skippedCount > 0) {
      log(`Skipped ${skippedCount} articles requiring disabled features.`);
    }
  }

  if (tagFilter) {
    articles = articles.filter((a) =>
      a.tags.some((t) => t.toLowerCase() === tagFilter.toLowerCase())
    );
    log(`Filtered to ${articles.length} articles with tag "${tagFilter}".`);
  }

  if (limit > 0) {
    articles = articles.slice(0, limit);
    log(`Limited to first ${articles.length} articles.`);
  }

  log(`Auditing ${articles.length} articles.`);

  // Setup
  const screenshotBaseDir = path.resolve(__dirname, "../screenshots", runId);
  fs.mkdirSync(screenshotBaseDir, { recursive: true });

  log("Launching browser...");
  const browser = await chromium.launch({ headless: true });
  const authContext = await authenticateKlaviyo(browser);

  const contextFactory = async () => {
    const page = await authContext.newPage();
    const controller = new PlaywrightController(page);
    return { controller, close: () => page.close() };
  };

  // Run in batches
  const results: ArticleResult[] = [];

  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(articles.length / BATCH_SIZE);
    log(`Batch ${batchNum}/${totalBatches} (${batch.length} articles)`);

    const batchResults = await runBatch(batch, contextFactory, screenshotBaseDir);
    results.push(...batchResults);

    if (i + BATCH_SIZE < articles.length) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  // Build summary
  const summary: QARunSummary = {
    runId,
    startedAt: new Date(runStart).toISOString(),
    durationMs: Date.now() - runStart,
    totalArticles: articles.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed && !r.broken && !r.featureUnavailable).length,
    broken: results.filter((r) => r.broken).length,
    skipped: results.filter((r) => r.featureUnavailable).length,
    results,
  };

  log(`\n=== Results ===`);
  log(`Passed: ${summary.passed}`);
  log(`Failed: ${summary.failed}`);
  log(`Skipped: ${summary.skipped}`);
  log(`Broken (404): ${summary.broken}`);
  log(`Total time: ${(summary.durationMs / 1000).toFixed(1)}s`);

  // Write dashboard data
  const dashboardDataDir = path.resolve(__dirname, "../dashboard/data");
  fs.mkdirSync(dashboardDataDir, { recursive: true });

  const githubRunUrl =
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined;

  fs.writeFileSync(
    path.join(dashboardDataDir, "latest.json"),
    JSON.stringify({ ...summary, githubRunUrl }, null, 2)
  );

  const historyPath = path.join(dashboardDataDir, "history.json");
  const history: Array<Record<string, unknown>> = fs.existsSync(historyPath)
    ? JSON.parse(fs.readFileSync(historyPath, "utf-8"))
    : [];
  history.push({
    runId: summary.runId,
    startedAt: summary.startedAt,
    durationMs: summary.durationMs,
    totalArticles: summary.totalArticles,
    passed: summary.passed,
    failed: summary.failed,
    broken: summary.broken,
    skipped: summary.skipped,
  });
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
  log("Dashboard data written.");

  // Post to Slack
  await postSlackReport(summary);

  // Cleanup
  await authContext.close();
  await browser.close();

  if (summary.failed > 0 || summary.broken > 0) {
    log("Exiting with code 1 due to failures.");
    process.exit(1);
  }

  log("All articles passed audit!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
