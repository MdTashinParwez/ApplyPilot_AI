import { createHash } from "node:crypto";
import type { Job, JobSearchInput } from "@applypilot/shared";
import type { JobAdapter, JobSource, SourceStatus } from "./arbeitnow.js";
import { createArbeitnowSource, JobSourceError } from "./arbeitnow.js";

type Fetcher = typeof fetch;
type Raw = Record<string, unknown>;

const SOURCE_NAMES: Record<string, string> = {
  arbeitnow: "Arbeitnow",
  remotive: "Remotive",
  remote_ok: "Remote OK",
  jobicy: "Jobicy",
  greenhouse: "Greenhouse",
  lever: "Lever"
};

const DEFAULT_AUTONOMOUS_GREENHOUSE_BOARDS = [
  "stripe",
  "figma",
  "datadog",
  "cloudflare",
  "openai",
  "vercel",
  "automattic",
  "gitlab",
  "docker",
  "supabase"
];

const DEFAULT_AUTONOMOUS_LEVER_SITES = [
  "netflix",
  "spotify",
  "atlassian",
  "palantir",
  "twitch",
  "rover",
  "coursera",
  "gusto"
];

const configuredSources = () => new Set(
  (process.env.JOB_SOURCES ?? "arbeitnow,remotive,remote_ok,jobicy,greenhouse,lever")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
);

const clean = (value: unknown, max = 5000) =>
  typeof value === "string"
    ? value
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max)
    : "";

function canonical(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_|ref$|gh_src$)/i.test(key)) {
      parsed.searchParams.delete(key);
    }
  }
  parsed.searchParams.sort();
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.pathname.length > 1) {
    parsed.pathname = parsed.pathname.replace(/\/$/, "");
  }
  return parsed.toString();
}

export function normalizeExternalJob(
  source: Job["source"],
  rawId: unknown,
  titleValue: unknown,
  companyValue: unknown,
  locationValue: unknown,
  urlValue: unknown,
  descValue: unknown,
  remoteValue: unknown,
  postedValue?: unknown,
  tagsValue?: unknown,
  attribution = ""
): Job | null {
  const title = clean(titleValue, 200);
  const company = clean(companyValue, 160);
  if (!title || !company) return null;

  let url: string;
  try {
    url = canonical(typeof urlValue === "string" ? urlValue : "");
    if (!/^https?:$/.test(new URL(url).protocol)) return null;
  } catch {
    return null;
  }

  const idText = typeof rawId === "string" || typeof rawId === "number" ? String(rawId).trim() : "";
  const sourceId = (idText || createHash("sha256").update(url).digest("hex")).slice(0, 200);
  const posted = typeof postedValue === "string" ? Date.parse(postedValue) : typeof postedValue === "number" ? postedValue * 1000 : NaN;
  const tags = Array.isArray(tagsValue) ? tagsValue.filter((x): x is string => typeof x === "string").map(x => clean(x, 100)).slice(0, 30) : [];
  const loc = clean(locationValue, 200);
  const country = inferCountry(loc);
  const remote = typeof remoteValue === "boolean" ? remoteValue : /remote|worldwide|anywhere/i.test(loc) ? true : null;

  return {
    sourceId,
    source,
    sourceAttribution: attribution,
    title,
    company,
    location: loc,
    country,
    workArrangement: remote === true ? "remote" : null,
    url,
    description: clean(descValue),
    remote,
    publishedAt: Number.isFinite(posted) ? new Date(posted).toISOString() : null,
    tags,
    jobTypes: []
  };
}

function inferCountry(location: string): string | null {
  const supported = [
    "United States", "USA", "Canada", "India", "United Kingdom", "UK", "Germany",
    "France", "Australia", "Singapore", "Ireland", "Netherlands", "Spain", "Brazil",
    "Mexico", "Japan", "South Korea", "New Zealand", "Sweden", "Norway", "Denmark",
    "Switzerland", "Italy", "Portugal", "Poland", "Austria", "Belgium", "South Africa",
    "Argentina", "Colombia", "Israel", "UAE", "United Arab Emirates"
  ];
  return supported.find(country =>
    new RegExp(`(^|[,\\s])${country.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}($|[,\\s])`, "i").test(location)
  ) ?? null;
}

async function getJson(fetcher: Fetcher, url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ApplyPilotAI/1.0 job-discovery"
      },
      signal: AbortSignal.timeout(8000)
    });
  } catch (error) {
    throw new JobSourceError(
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "timeout" : "unavailable",
      "A public job source could not be reached."
    );
  }

  if (response.status === 429) {
    throw new JobSourceError("rate_limited", "A public job source is rate limiting requests.");
  }
  if (!response.ok) {
    throw new JobSourceError("unavailable", `A public job source returned HTTP ${response.status}.`);
  }

  try {
    return await response.json();
  } catch {
    throw new JobSourceError("unavailable", "A public job source returned malformed JSON.");
  }
}

function asAdapter(
  id: JobAdapter["id"],
  name: string,
  attribution: string,
  limitations: string[],
  fetchJobs: JobAdapter["fetchJobs"]
): JobAdapter {
  return { id, name, attribution, limitations, fetchJobs };
}

export function createPublicJobAdapters(fetcher: Fetcher = fetch): JobAdapter[] {
  const arbeitnow = createArbeitnowSource(fetcher);
  const adapters: JobAdapter[] = [
    arbeitnow,
    asAdapter("remotive", "Remotive", "Remotive", ["Public API feed is delayed; keyword and country filters are applied locally to a bounded feed."], async () => {
      const body = await getJson(fetcher, "https://remotive.com/api/remote-jobs?limit=100");
      const rows = body && typeof body === "object" ? (body as { jobs?: unknown }).jobs : null;
      if (!Array.isArray(rows)) throw new JobSourceError("unavailable", "Remotive returned an unexpected response.");
      const jobs = rows.slice(0, 100).map((item: Raw) => normalizeExternalJob("remotive", item.id, item.title, item.company_name, item.candidate_required_location, item.url, item.description, true, item.publication_date, [item.category, item.job_type].filter(Boolean), "Remotive")).filter((job): job is Job => job !== null);
      if (rows.length > 0 && jobs.length === 0) throw new JobSourceError("unavailable", "Remotive returned listings that could not be normalized.");
      return jobs;
    }),
    asAdapter("remote_ok", "Remote OK", "Remote OK", ["The public feed lists remote jobs; country eligibility is not guaranteed and filters are applied locally."], async () => {
      const body = await getJson(fetcher, "https://remoteok.com/api");
      if (!Array.isArray(body)) throw new JobSourceError("unavailable", "Remote OK returned an unexpected response.");
      const rows = body.filter((row: unknown) => !!row && typeof row === "object" && "id" in row).slice(0, 200) as Raw[];
      const jobs = rows.map((item: Raw) => normalizeExternalJob("remote_ok", item.id, item.position, item.company, item.location, item.url, item.description, true, item.date, item.tags, "Remote OK")).filter((job): job is Job => job !== null);
      if (rows.length > 0 && jobs.length === 0) throw new JobSourceError("unavailable", "Remote OK returned listings that could not be normalized.");
      return jobs;
    }),
    asAdapter("jobicy", "Jobicy", "Jobicy", ["Public feed lists remote jobs; country eligibility is filtered locally with original application URLs preserved."], async () => {
      const body = await getJson(fetcher, "https://jobicy.com/api/v2/remote-jobs?count=50");
      const rows = body && typeof body === "object" ? (body as { jobs?: unknown }).jobs : null;
      if (!Array.isArray(rows)) throw new JobSourceError("unavailable", "Jobicy returned an unexpected response.");
      const jobs = rows.slice(0, 50).map((item: Raw) => normalizeExternalJob(
        "jobicy",
        item.id,
        item.jobTitle,
        item.companyName,
        item.jobGeo,
        item.url,
        item.jobDescription,
        true,
        item.pubDate,
        [item.jobIndustry, item.jobType, item.jobLevel].filter(Boolean),
        "Jobicy"
      )).filter((job): job is Job => job !== null);
      if (rows.length > 0 && jobs.length === 0) throw new JobSourceError("unavailable", "Jobicy returned listings that could not be normalized.");
      return jobs;
    })
  ];

  // Greenhouse Autonomous Adapter
  const envBoards = (process.env.GREENHOUSE_BOARDS ?? "").split(",").map(x => x.trim()).filter(x => /^[a-z0-9_-]{1,80}$/i.test(x));
  const greenhouseBoards = envBoards.length > 0 ? envBoards : DEFAULT_AUTONOMOUS_GREENHOUSE_BOARDS;

  adapters.push(asAdapter("greenhouse", "Greenhouse", "Greenhouse public ATS", [
    `Autonomous ATS discovery across supported tech employers (${greenhouseBoards.slice(0, 4).join(", ")}, ...) with original application URLs preserved.`
  ], async () => {
    const results = await Promise.allSettled(greenhouseBoards.slice(0, 10).map(async board => {
      try {
        const body = await getJson(fetcher, `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`);
        const rows = body && typeof body === "object" ? (body as { jobs?: unknown }).jobs : null;
        if (!Array.isArray(rows)) return [];
        return rows.map((item: Raw) =>
          normalizeExternalJob("greenhouse", item.id, item.title, board, (item.location as Raw | undefined)?.name, item.absolute_url, item.content, null, item.updated_at, [], "Greenhouse")
        ).filter((job): job is Job => job !== null);
      } catch {
        return [];
      }
    }));

    const jobs = results.flatMap(r => r.status === "fulfilled" ? r.value : []);
    return jobs.slice(0, 200);
  }));

  // Lever Autonomous Adapter
  const envSites = (process.env.LEVER_SITES ?? "").split(",").map(x => x.trim()).filter(x => /^[a-z0-9_-]{1,80}$/i.test(x));
  const leverSites = envSites.length > 0 ? envSites : DEFAULT_AUTONOMOUS_LEVER_SITES;

  adapters.push(asAdapter("lever", "Lever", "Lever public ATS", [
    `Autonomous ATS discovery across supported tech employers (${leverSites.slice(0, 4).join(", ")}, ...) with original application URLs preserved.`
  ], async () => {
    const results = await Promise.allSettled(leverSites.slice(0, 10).map(async site => {
      try {
        const body = await getJson(fetcher, `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`);
        if (!Array.isArray(body)) return [];
        return body.map((item: Raw) =>
          normalizeExternalJob("lever", item.id, item.text, site, item.categories && typeof item.categories === "object" ? (item.categories as Raw).location : "", item.hostedUrl, item.descriptionPlain ?? item.description, null, item.createdAt, [], "Lever")
        ).filter((job): job is Job => job !== null);
      } catch {
        return [];
      }
    }));

    const jobs = results.flatMap(r => r.status === "fulfilled" ? r.value : []);
    return jobs.slice(0, 200);
  }));

  return adapters;
}

function configuredTimeout(): number {
  const parsed = Number(process.env.JOB_SOURCE_TIMEOUT_MS ?? 8000);
  return Number.isFinite(parsed) ? Math.min(20000, Math.max(100, parsed)) : 8000;
}

function sameListing(left: Job, right: Job): boolean {
  const norm = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  return norm(left.title) === norm(right.title) && norm(left.company) === norm(right.company) && norm(left.location) === norm(right.location);
}

export function createJobSourceRegistry(adapters = createPublicJobAdapters(), sourceTimeoutMs = configuredTimeout()): JobSource {
  const enabled = configuredSources();
  return {
    async search(query: JobSearchInput) {
      const requested = query.sources ? new Set(query.sources.split(",").map(x => x.trim().toLowerCase()).filter(Boolean)) : null;
      const candidates = adapters.filter(adapter => enabled.has(adapter.id) && (!requested || requested.has(adapter.id)));
      const statuses: SourceStatus[] = adapters.map(adapter => ({
        id: adapter.id,
        name: adapter.name,
        status: !enabled.has(adapter.id) || (requested && !requested.has(adapter.id)) ? "disabled" : "success",
        fetched: 0,
        limitations: adapter.limitations
      }));

      for (const id of ["greenhouse", "lever"]) {
        if (!adapters.some(adapter => adapter.id === id)) {
          statuses.push({
            id,
            name: SOURCE_NAMES[id]!,
            status: "disabled",
            fetched: 0,
            limitations: [`Configure ${id === "greenhouse" ? "GREENHOUSE_BOARDS" : "LEVER_SITES"} with known public board identifiers to enable.`]
          });
        }
      }

      const results = await Promise.all(candidates.map(async adapter => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const timedOut = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new JobSourceError("timeout", `${adapter.name} did not respond before the source timeout.`)), sourceTimeoutMs);
          });
          const jobs = await Promise.race([adapter.fetchJobs(), timedOut]);
          return { adapter, jobs, error: "" };
        } catch (error) {
          return { adapter, jobs: [] as Job[], error: error instanceof JobSourceError ? error.message : "This source is temporarily unavailable." };
        } finally {
          if (timer) clearTimeout(timer);
        }
      }));

      const all: Job[] = [];
      const byCanonical = new Map<string, Job>();
      const bySourceId = new Map<string, Job>();
      const limitations: string[] = [];

      for (const result of results) {
        const status = statuses.find(item => item.id === result.adapter.id)!;
        if (result.error) {
          status.status = "error";
          status.message = result.error;
          continue;
        }
        status.fetched = result.jobs.length;
        status.status = result.jobs.length ? "success" : "empty";
        limitations.push(...result.adapter.limitations);

        for (const job of result.jobs) {
          let key = "";
          try {
            key = canonical(job.url);
          } catch {
            continue;
          }
          const sourceKey = `${job.source}:${job.sourceId}`;
          const existingById = bySourceId.get(sourceKey);
          const existingByUrl = byCanonical.get(key);
          if ((existingById && sameListing(existingById, job)) || (existingByUrl && sameListing(existingByUrl, job))) {
            continue;
          }
          if (!existingById) bySourceId.set(sourceKey, job);
          if (!existingByUrl) byCanonical.set(key, job);
          all.push(job);
        }
      }

      const keyword = query.keyword.toLowerCase();
      const location = query.location.toLowerCase();
      const country = query.country.toLowerCase();

      const matching = all.filter(job => {
        const text = `${job.title} ${job.company} ${job.description} ${job.tags.join(" ")}`.toLowerCase();
        return (
          (!keyword || text.includes(keyword)) &&
          (!location || job.location.toLowerCase().includes(location)) &&
          (!country || `${job.country ?? ""} ${job.location}`.toLowerCase().includes(country)) &&
          (!query.remoteOnly || job.remote)
        );
      });

      const start = (query.page - 1) * query.pageSize;
      return {
        jobs: matching.slice(start, start + query.pageSize),
        total: matching.length,
        page: query.page,
        pageSize: query.pageSize,
        hasNextPage: start + query.pageSize < matching.length,
        sources: statuses,
        coverageLimitations: [...new Set(limitations)]
      };
    }
  };
}
