import OpenAI from "openai";
import * as path from "path";
import { PlaywrightController } from "./playwright-controller";
import { GPTAction, StepResult, ArticleResult } from "./types";

const MAX_ACTIONS_PER_STEP = 10;
const GPT_MODEL = "gpt-5.4";
const MAX_RETRIES = 3;

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [gpt-agent] ${msg}`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGPTWithRetry(
  openai: OpenAI,
  screenshotBase64: string,
  stepText: string
): Promise<GPTAction> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: GPT_MODEL,
        response_format: { type: "json_object" },
        max_completion_tokens: 1024,
        messages: [
          {
            role: "system",
            content:
              'You are a QA agent verifying that Klaviyo\'s UI matches its documentation. Respond with JSON only. Your response must have an "action" field that is one of: "click", "type", "navigate", "wait", "pass", "fail", "skip". For "click" include "selector" (CSS selector). For "type" include "selector" and "text". For "navigate" include "url". For "wait" include "selector". For "pass", "fail", or "skip" include "reason". Use "skip" when the feature referenced in the step is not available on this account — for example, if you see an upgrade prompt, a paywall, a "contact sales" gate, a grayed-out or missing menu item, or a "not available on your plan" message. Do NOT use "fail" for missing features — "fail" means the feature exists but the UI does not match the documentation.',
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Article step: "${stepText}"\n\nHere is the current state of the browser. Either:\n(A) Tell me what action to take next as JSON\n(B) Confirm this step is complete and passing (action: "pass")\n(C) Flag that the UI doesn't match the documentation and explain why (action: "fail")\n(D) If the feature is not available on this account (upgrade prompt, missing menu, paywall, etc.), use action: "skip" with a reason`,
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${screenshotBase64}`,
                  detail: "high",
                },
              },
            ],
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("GPT returned empty response");
      }

      // Strip markdown code fences if GPT wraps its JSON
      const cleaned = content
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/, "")
        .trim();
      const parsed = JSON.parse(cleaned) as GPTAction;
      if (!parsed.action) {
        throw new Error("GPT response missing 'action' field");
      }

      return parsed;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      log(`GPT call attempt ${attempt}/${MAX_RETRIES} failed: ${lastError.message}`);
      if (attempt < MAX_RETRIES) {
        const backoffMs = Math.pow(2, attempt) * 1000;
        log(`Retrying in ${backoffMs}ms...`);
        await sleep(backoffMs);
      }
    }
  }

  throw lastError ?? new Error("GPT call failed after all retries");
}

async function executeAction(
  controller: PlaywrightController,
  action: GPTAction
): Promise<void> {
  switch (action.action) {
    case "click":
      if (!action.selector) throw new Error("click action missing selector");
      log(`  Action: click "${action.selector}"`);
      await controller.click(action.selector);
      break;
    case "type":
      if (!action.selector || action.text === undefined)
        throw new Error("type action missing selector or text");
      log(`  Action: type "${action.text}" into "${action.selector}"`);
      await controller.type(action.selector, action.text);
      break;
    case "navigate":
      if (!action.url) throw new Error("navigate action missing url");
      log(`  Action: navigate to "${action.url}"`);
      await controller.navigate(action.url);
      break;
    case "wait":
      if (!action.selector) throw new Error("wait action missing selector");
      log(`  Action: wait for "${action.selector}"`);
      await controller.waitForSelector(action.selector);
      break;
    default:
      break;
  }
}

export async function runArticleQA(
  controller: PlaywrightController,
  articleId: string,
  articleName: string,
  articleUrl: string,
  steps: string[],
  screenshotDir: string
): Promise<ArticleResult> {
  const openai = new OpenAI();
  const startTime = Date.now();
  const stepResults: StepResult[] = [];
  const allScreenshots: string[] = [];
  let articlePassed = true;

  log(`Starting QA for "${articleName}" (${steps.length} steps)`);

  for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
    const stepText = steps[stepIdx];
    log(`Step ${stepIdx + 1}/${steps.length}: ${stepText.slice(0, 80)}...`);

    let actionsAttempted = 0;
    let stepStatus: StepResult["status"] = "timeout";
    let stepReason: string | undefined;
    let stepScreenshot: string | undefined;

    for (let actionNum = 0; actionNum < MAX_ACTIONS_PER_STEP; actionNum++) {
      actionsAttempted++;

      const screenshotPath = path.join(
        screenshotDir,
        `step-${stepIdx + 1}-action-${actionNum + 1}.png`
      );
      const base64 = await controller.screenshot(screenshotPath);
      allScreenshots.push(screenshotPath);

      let action: GPTAction;
      try {
        action = await callGPTWithRetry(openai, base64, stepText);
      } catch (err) {
        stepStatus = "fail";
        stepReason = `GPT call failed: ${err instanceof Error ? err.message : String(err)}`;
        stepScreenshot = screenshotPath;
        break;
      }

      if (action.action === "pass") {
        log(`  Step PASSED: ${action.reason ?? "no reason given"}`);
        stepStatus = "pass";
        stepReason = action.reason;
        stepScreenshot = screenshotPath;
        break;
      }

      if (action.action === "skip") {
        log(`  Step SKIPPED (feature unavailable): ${action.reason ?? "no reason given"}`);
        stepStatus = "feature-unavailable";
        stepReason = action.reason;
        stepScreenshot = screenshotPath;
        break;
      }

      if (action.action === "fail") {
        log(`  Step FAILED: ${action.reason ?? "no reason given"}`);
        stepStatus = "fail";
        stepReason = action.reason;
        stepScreenshot = screenshotPath;
        break;
      }

      try {
        await executeAction(controller, action);
        // Small delay after action for page to settle
        await sleep(1000);
      } catch (err) {
        stepStatus = "fail";
        stepReason = `Action "${action.action}" failed: ${err instanceof Error ? err.message : String(err)}`;
        stepScreenshot = screenshotPath;
        break;
      }
    }

    if (stepStatus === "timeout") {
      stepReason = `Exceeded ${MAX_ACTIONS_PER_STEP} actions without resolution`;
      // Take a final screenshot
      const finalPath = path.join(screenshotDir, `step-${stepIdx + 1}-timeout.png`);
      await controller.screenshot(finalPath);
      stepScreenshot = finalPath;
      allScreenshots.push(finalPath);
    }

    stepResults.push({
      stepIndex: stepIdx,
      stepText,
      status: stepStatus,
      reason: stepReason,
      screenshotPath: stepScreenshot,
      actionsAttempted,
    });

    if (stepStatus === "feature-unavailable") {
      log(`Stopping article test — feature not available on this account.`);
      for (let remaining = stepIdx + 1; remaining < steps.length; remaining++) {
        stepResults.push({
          stepIndex: remaining,
          stepText: steps[remaining],
          status: "skipped",
          reason: "Skipped — feature unavailable on test account",
          actionsAttempted: 0,
        });
      }
      break;
    }

    if (stepStatus !== "pass") {
      articlePassed = false;
      log(`Stopping article test — step ${stepIdx + 1} did not pass.`);
      for (let remaining = stepIdx + 1; remaining < steps.length; remaining++) {
        stepResults.push({
          stepIndex: remaining,
          stepText: steps[remaining],
          status: "skipped",
          reason: "Skipped due to prior step failure",
          actionsAttempted: 0,
        });
      }
      break;
    }
  }

  const durationMs = Date.now() - startTime;
  log(
    `Finished "${articleName}" — ${articlePassed ? "PASSED" : "FAILED"} in ${(durationMs / 1000).toFixed(1)}s`
  );

  const hasFeatureUnavailable = stepResults.some(
    (s) => s.status === "feature-unavailable"
  );

  return {
    articleId,
    articleName,
    articleUrl,
    passed: articlePassed && !hasFeatureUnavailable,
    featureUnavailable: hasFeatureUnavailable,
    steps: stepResults,
    screenshots: allScreenshots,
    durationMs,
  };
}
