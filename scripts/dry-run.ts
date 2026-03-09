/**
 * Dry run: fetches articles and extracts steps without browser interaction.
 * Tests the article-fetcher pipeline end-to-end.
 *
 * Usage: npx ts-node scripts/dry-run.ts [--limit=N] [--tag=TAG]
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import * as fs from "fs";
import * as path from "path";
import { fetchArticleSteps } from "./lib/article-fetcher";
import { Article } from "./lib/types";

const DELAY_MS = 1000;

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface DryRunResult {
  id: string;
  name: string;
  url: string;
  status: "ok" | "404" | "no-steps" | "error";
  stepCount: number;
  steps: string[];
  error?: string;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limitFlag = args.find((a) => a.startsWith("--limit="));
  const tagFlag = args.find((a) => a.startsWith("--tag="));
  const limit = limitFlag ? parseInt(limitFlag.split("=")[1], 10) : 0;
  const tagFilter = tagFlag ? tagFlag.split("=")[1] : "";

  const articlesPath = path.resolve(__dirname, "../articles.json");
  let articles: Article[] = JSON.parse(fs.readFileSync(articlesPath, "utf-8"));

  if (tagFilter) {
    articles = articles.filter((a) =>
      a.tags.some((t) => t.toLowerCase() === tagFilter.toLowerCase())
    );
  }
  if (limit > 0) {
    articles = articles.slice(0, limit);
  }

  log(`Dry run: testing step extraction for ${articles.length} articles\n`);

  const results: DryRunResult[] = [];
  let okCount = 0;
  let brokenCount = 0;
  let noStepsCount = 0;
  let errorCount = 0;

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    log(`[${i + 1}/${articles.length}] ${article.name}`);
    log(`  URL: ${article.url}`);

    try {
      const { steps, is404 } = await fetchArticleSteps(article.url);

      if (is404) {
        log(`  STATUS: 404 - BROKEN`);
        brokenCount++;
        results.push({
          id: article.id,
          name: article.name,
          url: article.url,
          status: "404",
          stepCount: 0,
          steps: [],
        });
      } else if (steps.length === 0) {
        log(`  STATUS: No steps extracted`);
        noStepsCount++;
        results.push({
          id: article.id,
          name: article.name,
          url: article.url,
          status: "no-steps",
          stepCount: 0,
          steps: [],
        });
      } else {
        log(`  STATUS: OK - ${steps.length} steps found`);
        steps.forEach((s, idx) => {
          log(`    ${idx + 1}. ${s.slice(0, 120)}${s.length > 120 ? "..." : ""}`);
        });
        okCount++;
        results.push({
          id: article.id,
          name: article.name,
          url: article.url,
          status: "ok",
          stepCount: steps.length,
          steps,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`  STATUS: ERROR - ${msg}`);
      errorCount++;
      results.push({
        id: article.id,
        name: article.name,
        url: article.url,
        status: "error",
        stepCount: 0,
        steps: [],
        error: msg,
      });
    }

    log("");
    if (i < articles.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  // Summary
  log("=== DRY RUN SUMMARY ===");
  log(`Total:    ${articles.length}`);
  log(`OK:       ${okCount} (steps extracted successfully)`);
  log(`No steps: ${noStepsCount} (article found but no steps parsed)`);
  log(`Broken:   ${brokenCount} (404)`);
  log(`Errors:   ${errorCount}`);

  // Write results
  const outputPath = path.resolve(__dirname, "../dry-run-results.json");
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  log(`\nResults written to ${outputPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
