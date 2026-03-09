import * as fs from "fs";
import * as path from "path";

interface RawArticle {
  id: string;
  name: string;
  url: string;
  tags: string[];
  views: number;
  rank: number;
}

const articlesPath = path.resolve(__dirname, "../articles.json");
const outputPath = path.resolve(__dirname, "../articles-priority.json");
const articles: RawArticle[] = JSON.parse(fs.readFileSync(articlesPath, "utf-8"));

// Patterns that indicate actionable, step-by-step UI instructions
const includePatterns = [
  /^how to create/i,
  /^how to set up/i,
  /^how to add/i,
  /^how to build/i,
  /^how to configure/i,
  /^how to connect/i,
  /^how to customize/i,
  /^how to edit/i,
  /^how to enable/i,
  /^how to export/i,
  /^how to import/i,
  /^how to install/i,
  /^how to integrate/i,
  /^how to manage/i,
  /^how to remove/i,
  /^how to send/i,
  /^how to set /i,
  /^how to sync/i,
  /^how to update/i,
  /^how to upload/i,
  /^how to use/i,
  /^how to filter/i,
  /^how to track/i,
  /^how to delete/i,
  /^how to migrate/i,
  /^getting started with/i,
];

// Patterns that indicate conceptual/reference content (not step-by-step)
const excludePatterns = [
  /understand/i,
  /guide to/i,
  /overview/i,
  /reference$/i,
  /troubleshoot/i,
  /\bFAQ\b/i,
  /best practice/i,
  /\bwhy\b/i,
  /what is/i,
  /what are/i,
];

const filtered = articles.filter(
  (a) =>
    includePatterns.some((p) => p.test(a.name)) &&
    !excludePatterns.some((p) => p.test(a.name))
);

// Re-rank
const output = filtered.map((a, i) => ({
  ...a,
  rank: i + 1,
}));

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log(`Filtered: ${output.length} actionable articles (from ${articles.length} total)`);
console.log(`Written to: ${outputPath}`);
console.log("");
console.log("Sample articles:");
output.slice(0, 30).forEach((a, i) => {
  console.log(`  ${i + 1}. ${a.name}`);
});
if (output.length > 30) {
  console.log(`  ... +${output.length - 30} more`);
}
