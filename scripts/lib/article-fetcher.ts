import * as cheerio from "cheerio";
import OpenAI from "openai";

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [fetcher] ${msg}`);
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

function extractStepsFromHtml(html: string): string[] | null {
  const $ = cheerio.load(html);

  // Zendesk / Help Center format: look for ordered list items in article body
  const articleBody = $(".article-body, .article__body, [itemprop='articleBody']");
  if (articleBody.length > 0) {
    const steps: string[] = [];
    articleBody.find("ol > li").each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 0) {
        steps.push(text);
      }
    });
    if (steps.length >= 2) {
      return steps;
    }
  }

  // Also try generic ordered lists on the page
  const genericSteps: string[] = [];
  $("ol > li").each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 10) {
      genericSteps.push(text);
    }
  });
  if (genericSteps.length >= 2) {
    return genericSteps;
  }

  return null;
}

async function extractStepsWithGPT(html: string): Promise<string[]> {
  log("HTML parsing failed, falling back to GPT-4o-mini for step extraction...");

  const openai = new OpenAI();

  // Truncate HTML to avoid token limits
  const truncatedHtml = html.slice(0, 30_000);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You extract step-by-step instructions from help articles. Return a JSON object with a single key 'steps' containing an array of strings, where each string is one step the user must follow. Only include actionable UI steps, not introductory text.",
      },
      {
        role: "user",
        content: `Extract the numbered steps from this help article HTML:\n\n${truncatedHtml}`,
      },
    ],
    temperature: 0,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("GPT returned empty response for step extraction");
  }

  const parsed = JSON.parse(content) as { steps: string[] };
  if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new Error("GPT did not return valid steps array");
  }

  return parsed.steps;
}

export async function fetchArticleSteps(
  url: string
): Promise<{ steps: string[]; is404: boolean }> {
  log(`Fetching article: ${url}`);
  const { html, status } = await fetchHtml(url);

  if (status === 404) {
    log("Article returned 404");
    return { steps: [], is404: true };
  }

  if (status >= 400) {
    throw new Error(`Article fetch failed with status ${status}`);
  }

  // Try HTML parsing first
  const parsedSteps = extractStepsFromHtml(html);
  if (parsedSteps) {
    log(`Extracted ${parsedSteps.length} steps from HTML`);
    return { steps: parsedSteps, is404: false };
  }

  // Fallback to GPT extraction
  const gptSteps = await extractStepsWithGPT(html);
  log(`GPT extracted ${gptSteps.length} steps`);
  return { steps: gptSteps, is404: false };
}
