/**
 * Fetches all Klaviyo help center articles from the Zendesk API,
 * retrieves view counts, sorts by popularity, and writes articles.json.
 *
 * Usage:
 *   ZENDESK_BEARER_TOKEN=<token> npx ts-node scripts/fetch-articles.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import * as fs from "fs";
import * as path from "path";

const BASE_URL = "https://help.klaviyo.com/api/v2/help_center";
const TOKEN = process.env.ZENDESK_BEARER_TOKEN;
const OUTPUT_PATH = path.resolve(__dirname, "../articles.json");
const PER_PAGE = 100;

// Rate limit: Zendesk allows ~200 req/min for OAuth tokens
const RATE_LIMIT_DELAY_MS = 350;

interface ZendeskArticle {
  id: number;
  title: string;
  html_url: string;
  section_id: number;
  vote_sum: number;
  vote_count: number;
  promoted: boolean;
  draft: boolean;
  label_names: string[];
  created_at: string;
  updated_at: string;
}

interface ZendeskListResponse {
  articles: ZendeskArticle[];
  page: number;
  page_count: number;
  per_page: number;
  count: number;
  next_page: string | null;
}

interface ArticleMetrics {
  id: number;
  views: number;
}

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function zendeskFetch(url: string): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Zendesk API error ${response.status}: ${body}`);
  }

  return response;
}

async function fetchAllArticles(): Promise<ZendeskArticle[]> {
  const articles: ZendeskArticle[] = [];
  let page = 1;
  let totalPages = 1;

  log("Fetching all articles from Zendesk Help Center API...");

  while (page <= totalPages) {
    const url = `${BASE_URL}/en-us/articles.json?per_page=${PER_PAGE}&page=${page}&sort_by=updated_at&sort_order=desc`;
    const response = await zendeskFetch(url);
    const data = (await response.json()) as ZendeskListResponse;

    // Filter out drafts
    const published = data.articles.filter((a) => !a.draft);
    articles.push(...published);

    totalPages = data.page_count;
    log(`  Page ${page}/${totalPages} — got ${published.length} articles (${articles.length} total)`);

    page++;
    if (page <= totalPages) {
      await sleep(RATE_LIMIT_DELAY_MS);
    }
  }

  return articles;
}

async function fetchArticleMetrics(articleId: number): Promise<number> {
  try {
    const url = `${BASE_URL}/articles/${articleId}/metrics.json`;
    const response = await zendeskFetch(url);
    const data = (await response.json()) as { article_metrics?: { views?: number } };
    return data?.article_metrics?.views ?? 0;
  } catch {
    return 0;
  }
}

async function fetchAllMetrics(
  articles: ZendeskArticle[]
): Promise<Map<number, number>> {
  const viewsMap = new Map<number, number>();

  log(`Fetching view metrics for ${articles.length} articles...`);

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    const views = await fetchArticleMetrics(article.id);
    viewsMap.set(article.id, views);

    if ((i + 1) % 50 === 0 || i === articles.length - 1) {
      log(`  Metrics progress: ${i + 1}/${articles.length}`);
    }

    await sleep(RATE_LIMIT_DELAY_MS);
  }

  return viewsMap;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function inferTags(article: ZendeskArticle): string[] {
  const tags: string[] = [];
  const title = article.title.toLowerCase();

  // Infer tags from title keywords
  const tagMap: Record<string, string[]> = {
    segment: ["segments"],
    flow: ["flows"],
    campaign: ["campaigns"],
    email: ["email"],
    sms: ["sms"],
    form: ["forms"],
    signup: ["forms"],
    "sign-up": ["forms"],
    integration: ["integrations"],
    shopify: ["integrations", "shopify"],
    woocommerce: ["integrations"],
    list: ["lists"],
    template: ["templates"],
    report: ["analytics"],
    analytic: ["analytics"],
    metric: ["analytics"],
    deliverability: ["deliverability"],
    compliance: ["compliance"],
    gdpr: ["compliance"],
    whatsapp: ["whatsapp"],
    review: ["reviews"],
    a_b: ["testing"],
    "a/b": ["testing"],
    profile: ["profiles"],
    coupon: ["coupons"],
    discount: ["coupons"],
    webhook: ["webhooks"],
    api: ["api"],
  };

  for (const [keyword, keywordTags] of Object.entries(tagMap)) {
    if (title.includes(keyword)) {
      tags.push(...keywordTags);
    }
  }

  // Add label_names from Zendesk if available
  if (article.label_names.length > 0) {
    tags.push(...article.label_names.map((l) => l.toLowerCase()));
  }

  return [...new Set(tags)];
}

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error("Error: ZENDESK_BEARER_TOKEN environment variable is required.");
    console.error("Usage: ZENDESK_BEARER_TOKEN=<token> npx ts-node scripts/fetch-articles.ts");
    process.exit(1);
  }

  // Step 1: Fetch all articles
  const articles = await fetchAllArticles();
  log(`Found ${articles.length} published articles.`);

  // Step 2: Fetch view metrics
  const viewsMap = await fetchAllMetrics(articles);

  // Step 3: Sort by views (descending)
  const sorted = articles.sort((a, b) => {
    const viewsA = viewsMap.get(a.id) ?? 0;
    const viewsB = viewsMap.get(b.id) ?? 0;
    return viewsB - viewsA;
  });

  // Step 4: Build articles.json
  const output = sorted.map((article, index) => ({
    id: slugify(article.title),
    name: article.title,
    url: article.html_url,
    tags: inferTags(article),
    views: viewsMap.get(article.id) ?? 0,
    rank: index + 1,
  }));

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  log(`Wrote ${output.length} articles to ${OUTPUT_PATH}`);

  // Print top 20
  log("\nTop 20 articles by views:");
  output.slice(0, 20).forEach((a, i) => {
    log(`  ${i + 1}. [${a.views.toLocaleString()} views] ${a.name}`);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
