export interface StructuredOutputResponse {
  status: "validated";
  result: { text: string; character_count: number };
}

export interface AnalysisProfile {
  skills: string[];
  professionalSummary: string;
  targetJobTitles: string[];
  preferredCountries: string[];
  preferredLocations: string[];
  workArrangements: Array<"remote" | "hybrid" | "onsite">;
  workAuthorization?: string;
  experience: Array<{ title: string; company: string; details: string }>;
}

export interface JobAnalysisFactor {
  name: "skills" | "role" | "experience" | "location";
  score: number | null;
  weight: number;
  available: boolean;
  matchedEvidence: string[];
  limitations: string[];
}

export interface JobAnalysisResult {
  sourceId: string;
  source: string;
  title: string;
  company: string;
  location: string;
  country: string | null;
  workArrangement: "remote" | "hybrid" | "onsite" | null;
  url: string;
  remote: boolean | null;
  score: number | null;
  recommendation: "strong_match" | "potential_match" | "low_match" | "ineligible" | "unknown";
  confidence: "high" | "medium" | "low";
  confidenceReasons: string[];
  factorBreakdown: JobAnalysisFactor[];
  matchedEvidence: string[];
  missingOrUnverified: string[];
  explanation: string[];
}

export class AIServiceError extends Error {
  constructor(readonly kind: "timeout" | "unavailable") { super("Job analysis is temporarily unavailable. Please retry shortly."); }
}

function serviceConfig() {
  const baseUrl = process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8000";
  const timeoutMs = Number(process.env.AI_SERVICE_TIMEOUT_MS ?? 5000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new Error("AI_SERVICE_TIMEOUT_MS must be between 100 and 60000");
  }
  return { baseUrl: baseUrl.replace(/\/$/, ""), timeoutMs, token: process.env.AI_SERVICE_INTERNAL_TOKEN };
}

/** Optional internal HTTP integration for future API routes; not mounted publicly. */
export async function sendStructuredOutputCheck(text: string): Promise<StructuredOutputResponse> {
  const config = serviceConfig();
  const response = await fetch(`${config.baseUrl}/v1/structured-output`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {})
    },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(config.timeoutMs)
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(body?.error?.message ?? "AI service request failed");
  return body as StructuredOutputResponse;
}

export async function analyzeJobs(profile: AnalysisProfile, jobs: import("@applypilot/shared").Job[]): Promise<JobAnalysisResult[]> {
  const config = serviceConfig();
  const payload = {
    profile: {
      skills: profile.skills,
      professionalSummary: profile.professionalSummary.slice(0, 1500),
      targetJobTitles: profile.targetJobTitles,
      preferredCountries: profile.preferredCountries,
      preferredLocations: profile.preferredLocations,
      workArrangements: profile.workArrangements,
      workAuthorization: profile.workAuthorization?.slice(0, 1000) ?? "",
      experience: profile.experience.slice(0, 8).map(item => ({ title: item.title, company: item.company, details: item.details.slice(0, 1200) }))
    },
    jobs: jobs.slice(0, 15).map(job => ({
      sourceId: job.sourceId, source: job.source, title: job.title, company: job.company, location: job.location, country: job.country,
      workArrangement: job.workArrangement, description: job.description.slice(0, 1500), remote: job.remote, tags: job.tags, jobTypes: job.jobTypes, url: job.url
    }))
  };
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/v1/workflows/job-analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(config.timeoutMs)
    });
  } catch (error) {
    throw new AIServiceError(error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "timeout" : "unavailable");
  }
  if (!response.ok) throw new AIServiceError(response.status === 504 ? "timeout" : "unavailable");
  try {
    const body = await response.json() as { results?: JobAnalysisResult[] };
    if (!Array.isArray(body.results)) throw new Error("Invalid result");
    return body.results;
  } catch {
    throw new AIServiceError("unavailable");
  }
}
