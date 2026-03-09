import * as cheerio from "cheerio";

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [fetcher] ${msg}`);
}

export interface ArticleContent {
  title: string;
  bodyText: string; // Plain text of the article (for GPT)
  imageUrls: string[]; // Screenshot URLs embedded in the article
  is404: boolean;
}

async function fetchHtml(url: string): Promise<{ html: string; status: number }> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  const html = await response.text();
  return { html, status: response.status };
}

export async function fetchArticleContent(
  url: string
): Promise<ArticleContent> {
  log(`Fetching article: ${url}`);
  const { html, status } = await fetchHtml(url);

  if (status === 404) {
    log("Article returned 404");
    return { title: "", bodyText: "", imageUrls: [], is404: true };
  }

  if (status >= 400) {
    throw new Error(`Article fetch failed with status ${status}`);
  }

  const $ = cheerio.load(html);

  // Extract title
  const title =
    $("h1").first().text().trim() ||
    $("title").text().trim() ||
    "";

  // Extract article body text
  const articleBody = $(".article-body, .article__body, [itemprop='articleBody']");
  const bodyEl = articleBody.length > 0 ? articleBody : $("main, .main-content, article");
  const bodyText = bodyEl.text().replace(/\s+/g, " ").trim();

  // Extract image URLs from the article (these are the screenshots in the docs)
  const imageUrls: string[] = [];
  bodyEl.find("img").each((_, el) => {
    const src = $(el).attr("src");
    if (src && !src.includes("logo") && !src.includes("icon") && !src.includes("avatar")) {
      imageUrls.push(src.startsWith("http") ? src : `https://help.klaviyo.com${src}`);
    }
  });

  log(`Extracted: "${title}" (${bodyText.length} chars, ${imageUrls.length} images)`);

  return { title, bodyText, imageUrls, is404: false };
}
