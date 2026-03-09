export interface Article {
  id: string;
  name: string;
  url: string;
  tags: string[];
  views?: number;
  rank?: number;
}

export type StepStatus = "pass" | "fail" | "skipped" | "timeout" | "feature-unavailable";

export interface StepResult {
  stepIndex: number;
  stepText: string;
  status: StepStatus;
  reason?: string;
  screenshotPath?: string;
  actionsAttempted: number;
}

export interface ArticleResult {
  articleId: string;
  articleName: string;
  articleUrl: string;
  passed: boolean;
  broken?: boolean;
  featureUnavailable?: boolean;
  steps: StepResult[];
  screenshots: string[];
  durationMs: number;
  error?: string;
}

export interface AccountConfig {
  accountName: string;
  plan: string;
  enabledFeatures: string[];
  disabledFeatures: string[];
  notes?: string;
}

export type GPTActionType = "click" | "type" | "navigate" | "wait" | "pass" | "fail" | "skip";

export interface GPTAction {
  action: GPTActionType;
  selector?: string;
  text?: string;
  url?: string;
  reason?: string;
}

export interface QARunSummary {
  runId: string;
  startedAt: string;
  durationMs: number;
  totalArticles: number;
  passed: number;
  failed: number;
  broken: number;
  skipped: number;
  results: ArticleResult[];
}
