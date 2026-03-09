export interface Article {
  id: string;
  name: string;
  url: string;
  tags: string[];
  views?: number;
  rank?: number;
}

export interface AccountConfig {
  accountName: string;
  plan: string;
  enabledFeatures: string[];
  disabledFeatures: string[];
  notes?: string;
}

// A page referenced by an article that we need to screenshot
export interface ReferencedPage {
  pageName: string;
  urlPath: string; // e.g., "/flows", "/settings/api-keys"
}

// A single finding from the visual audit
export type FindingStatus = "match" | "mismatch" | "unable-to-verify";

export interface AuditFinding {
  element: string; // What was checked (e.g., "Create Flow button", "Integrations sidebar")
  status: FindingStatus;
  detail: string; // Explanation
  screenshotPath?: string;
}

// Result for one article
export interface ArticleResult {
  articleId: string;
  articleName: string;
  articleUrl: string;
  passed: boolean;
  broken?: boolean;
  featureUnavailable?: boolean;
  pagesChecked: number;
  findings: AuditFinding[];
  screenshots: string[];
  durationMs: number;
  error?: string;
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
  githubRunUrl?: string;
}
