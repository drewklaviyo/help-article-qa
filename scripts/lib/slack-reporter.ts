import { QARunSummary, ArticleResult, StepResult } from "./types";

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

function buildFailureBlocks(result: ArticleResult): object[] {
  const failedStep = result.steps.find(
    (s: StepResult) => s.status === "fail" || s.status === "timeout"
  );
  if (!failedStep) return [];

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*${result.articleName}*`,
          `Step ${failedStep.stepIndex + 1}: _${failedStep.stepText.slice(0, 100)}_`,
          `Reason: ${failedStep.reason ?? "Unknown"}`,
          result.articleUrl ? `<${result.articleUrl}|View article>` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    },
  ];
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
    summary.skipped > 0 ? `${summary.skipped} skipped (feature unavailable)` : null,
    summary.broken > 0 ? `${summary.broken} broken (404)` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  const blocks: object[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Help Article QA Report",
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${headerText}\nRun time: ${duration}${runUrl ? ` | <${runUrl}|View run>` : ""}`,
      },
    },
  ];

  // Add failure details (exclude feature-unavailable from failures section)
  const realFailures = summary.results.filter(
    (r) => !r.passed && !r.featureUnavailable
  );
  if (realFailures.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*Failures:*" },
    });

    for (const failure of realFailures) {
      if (failure.broken) {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${failure.articleName}* — Article returned 404\n<${failure.articleUrl}|View article>`,
          },
        });
      } else {
        blocks.push(...buildFailureBlocks(failure));
      }
    }
  }

  // Add feature-unavailable section
  const featureSkipped = summary.results.filter((r) => r.featureUnavailable);
  if (featureSkipped.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Skipped (feature not on test account):* ${featureSkipped.map((r) => r.articleName).join(", ")}`,
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
