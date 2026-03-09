import { QARunSummary, ArticleResult } from "./types";

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [slack] ${msg}`);
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
}

function buildGitHubRunUrl(): string {
  const serverUrl = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const runId = process.env.GITHUB_RUN_ID ?? "";
  if (!repo || !runId) return "";
  return `${serverUrl}/${repo}/actions/runs/${runId}`;
}

export async function postSlackReport(summary: QARunSummary): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    log("SLACK_WEBHOOK_URL not set, skipping Slack report.");
    return;
  }

  const runUrl = buildGitHubRunUrl();
  const duration = formatDuration(summary.durationMs);

  const headerText = [
    summary.passed > 0 ? `${summary.passed} passing` : null,
    summary.failed > 0 ? `${summary.failed} failing` : null,
    summary.skipped > 0 ? `${summary.skipped} skipped` : null,
    summary.broken > 0 ? `${summary.broken} broken (404)` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Help Article QA Audit" },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${headerText}\nRun time: ${duration}${runUrl ? ` | <${runUrl}|View run>` : ""}`,
      },
    },
  ];

  // Mismatch details
  const mismatched = summary.results.filter(
    (r) => !r.passed && !r.broken && !r.featureUnavailable
  );
  if (mismatched.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*UI Mismatches Found:*" },
    });

    for (const result of mismatched.slice(0, 10)) {
      const mismatchFindings = result.findings
        .filter((f) => f.status === "mismatch")
        .slice(0, 3);

      const findingText = mismatchFindings.length > 0
        ? mismatchFindings.map((f) => `  - ${f.element}: ${f.detail.slice(0, 100)}`).join("\n")
        : result.error ?? "Unknown error";

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*<${result.articleUrl}|${result.articleName}>*\n${findingText}`,
        },
      });
    }

    if (mismatched.length > 10) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `_...and ${mismatched.length - 10} more_` },
      });
    }
  }

  // Broken articles
  const broken = summary.results.filter((r) => r.broken);
  if (broken.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Broken (404):* ${broken.map((r) => `<${r.articleUrl}|${r.articleName}>`).join(", ")}`,
      },
    });
  }

  const payload = { blocks };

  log("Posting Slack report...");
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack webhook failed (${response.status}): ${body}`);
  }

  log("Slack report posted successfully.");
}
