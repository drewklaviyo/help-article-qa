/**
 * Dry run: fetches articles and extracts content without browser interaction.
 * Tests the article-fetcher pipeline.
 *
 * Usage: npx ts-node scripts/dry-run.ts [--limit=N] [--tag=TAG]
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import * as fs from "fs";
import * as path from "path";
import { fetchArticleContent } from "./lib/article-fetcher";
import { Article } from "./lib/types";

const DELAY_MS = 1000;

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  log(`Dry run: fetching content for ${articles.length} articles\n`);

  let okCount = 0;
  let brokenCount = 0;
  let errorCount = 0;

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    log(`[${i + 1}/${articles.length}] ${article.name}`);

    try {
      const content = await fetchArticleContent(article.url);
      if (content.is404) {
        log(`  STATUS: 404`);
        brokenCount++;
      } else {
        log(`  STATUS: OK (${content.bodyText.length} chars, ${content.imageUrls.length} images)`);
        okCount++;
      }
    } catch (err) {
      log(`  STATUS: ERROR - ${err instanceof Error ? err.message : String(err)}`);
      errorCount++;
    }

    if (i < articles.length - 1) await sleep(DELAY_MS);
  }

  log(`\n=== SUMMARY ===`);
  log(`OK: ${okCount} | Broken: ${brokenCount} | Errors: ${errorCount}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
