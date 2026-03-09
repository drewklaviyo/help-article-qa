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
  element: string;
  status: FindingStatus;
  detail: string;
  livePage?: string; // Which live page this finding relates to
}

// A pair of screenshots for comparison
export interface ScreenshotPair {
  pageName: string;
  articleImageUrl?: string; // Screenshot from the help article
  liveScreenshotPath?: string; // Screenshot from the live app
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
  screenshotPairs: ScreenshotPair[];
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
