import type { Job, JobSearchInput } from "@applypilot/shared";
import { createHash } from "node:crypto";

const ENDPOINT = "https://www.arbeitnow.com/api/job-board-api";
const SOURCE_PAGES = 3;
const CACHE_MS = 5 * 60 * 1000;

export class JobSourceError extends Error {
  constructor(readonly kind: "timeout" | "rate_limited" | "unavailable", message: string) {
    super(message);
    this.name = "JobSourceError";
  }
}

type FetchLike = typeof fetch;
type ArbeitnowRecord = {
  slug?: unknown; title?: unknown; company_name?: unknown; location?: unknown;
  url?: unknown; description?: unknown; remote?: unknown; created_at?: unknown;
  tags?: unknown; job_types?: unknown;
};

function cleanDescription(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim().slice(0, 5000);
}

export function normalizeArbeitnowJob(raw: ArbeitnowRecord): Job | null {
  if (typeof raw.title !== "string" || !raw.title.trim() || typeof raw.company_name !== "string" || !raw.company_name.trim() || typeof raw.url !== "string") return null;
  let url: URL;
  try { url = new URL(raw.url); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.hash = ""; for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key)) url.searchParams.delete(key);
  const created = typeof raw.created_at === "number" ? raw.created_at * 1000 : typeof raw.created_at === "string" ? Date.parse(raw.created_at) : NaN;
  const publishedAt = Number.isFinite(created) ? new Date(created).toISOString() : null;
  return {
    sourceId: (typeof raw.slug === "string" && raw.slug.trim() ? raw.slug.trim() : createHash("sha256").update(url.toString()).digest("hex")).slice(0, 200), source: "arbeitnow", sourceAttribution: "Arbeitnow", title: raw.title.trim().slice(0, 200),
    company: raw.company_name.trim().slice(0, 160), location: typeof raw.location === "string" ? raw.location.trim().slice(0, 200) : "",
    country: null, workArrangement: raw.remote === true ? "remote" : null,
    url: url.toString(), description: cleanDescription(raw.description), remote: typeof raw.remote === "boolean" ? raw.remote : null,
    publishedAt, tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 30) : [],
    jobTypes: Array.isArray(raw.job_types) ? raw.job_types.filter((type): type is string => typeof type === "string").slice(0, 20) : []
  };
}

export interface JobSource { search(query: JobSearchInput): Promise<{ jobs: Job[]; total: number; page: number; pageSize: number; hasNextPage: boolean; sources?: SourceStatus[]; coverageLimitations?: string[] }>; }
export interface SourceStatus { id: string; name: string; status: "available" | "disabled" | "error"; fetched: number; message?: string; limitations: string[]; }
export interface JobAdapter { readonly id: string; readonly name: string; readonly attribution: string; readonly limitations: string[]; fetchJobs(): Promise<Job[]>; }

export function createArbeitnowSource(fetcher: FetchLike = fetch, now: () => number = Date.now): JobSource & JobAdapter {
  let cached: { expires: number; jobs: Job[] } | undefined;
  let pending: Promise<Job[]> | undefined;

  async function loadJobs(): Promise<Job[]> {
    if (cached && cached.expires > now()) return cached.jobs;
    if (pending) return pending;
    pending = (async () => {
      try {
        const responses = await Promise.all(Array.from({ length: SOURCE_PAGES }, async (_, index) => {
          let response: Response;
          try { response = await fetcher(`${ENDPOINT}?page=${index + 1}`, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } }); }
          catch (error) {
            if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new JobSourceError("timeout", "The Arbeitnow job feed timed out.");
            throw new JobSourceError("unavailable", "The Arbeitnow job feed is unavailable.");
          }
          if (response.status === 429) throw new JobSourceError("rate_limited", "The job source is rate limiting requests. Please retry shortly.");
          if (!response.ok) throw new JobSourceError("unavailable", `The job source returned HTTP ${response.status}.`);
          let body: unknown;
          try { body = await response.json(); } catch { throw new JobSourceError("unavailable", "The job source returned malformed JSON."); }
          if (!body || typeof body !== "object" || !Array.isArray((body as { data?: unknown }).data)) throw new JobSourceError("unavailable", "The job source returned an unexpected response.");
          return (body as { data: ArbeitnowRecord[] }).data;
        }));
        const jobs = new Map<string, Job>();
        for (const row of responses.flat()) { const job = normalizeArbeitnowJob(row); if (job) jobs.set(job.sourceId, job); }
        const result = [...jobs.values()];
        cached = { jobs: result, expires: now() + CACHE_MS };
        return result;
      } finally { pending = undefined; }
    })();
    return pending;
  }

  const source: JobSource & JobAdapter = {
    id: "arbeitnow", name: "Arbeitnow", attribution: "Arbeitnow public job board API",
    limitations: ["Country and location filters are applied locally to the bounded recent feed."],
    async fetchJobs() { return loadJobs(); },
    async search(query) {
      const keyword = query.keyword.toLowerCase();
      const location = query.location.toLowerCase();
      const matching = (await loadJobs()).filter(job => {
        const text = [job.title, job.company, job.description, ...job.tags].join(" ").toLowerCase();
        const haystack = `${job.location} ${job.country ?? ""}`.toLowerCase();
        return (!keyword || text.includes(keyword)) && (!location || haystack.includes(location)) && (!query.country || haystack.includes(query.country.toLowerCase())) && (!query.remoteOnly || job.remote);
      });
      const start = (query.page - 1) * query.pageSize;
      return { jobs: matching.slice(start, start + query.pageSize), total: matching.length, page: query.page, pageSize: query.pageSize, hasNextPage: start + query.pageSize < matching.length };
    }
  };
  return source;
}
