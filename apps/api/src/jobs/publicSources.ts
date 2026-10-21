import { createHash } from "node:crypto";
import type { Job, JobSearchInput } from "@applypilot/shared";
import type { JobAdapter, JobSource, SourceStatus } from "./arbeitnow.js";
import { createArbeitnowSource, JobSourceError } from "./arbeitnow.js";

type Fetcher = typeof fetch;
type Raw = Record<string, unknown>;
const SOURCE_NAMES: Record<string, string> = { arbeitnow: "Arbeitnow", remotive: "Remotive", remote_ok: "Remote OK", greenhouse: "Greenhouse", lever: "Lever" };
const configuredSources = () => new Set((process.env.JOB_SOURCES ?? "arbeitnow,remotive,remote_ok").split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
const clean = (value: unknown, max = 5000) => typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim().slice(0, max) : "";
function canonical(url: string): string {
  const parsed = new URL(url); parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) if (/^(utm_|ref$|source$|gh_src$)/i.test(key)) parsed.searchParams.delete(key);
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/$/, "");
  return parsed.toString();
}
export function normalizeExternalJob(source: Job["source"], rawId: unknown, titleValue: unknown, companyValue: unknown, locationValue: unknown, urlValue: unknown, descValue: unknown, remoteValue: unknown, postedValue?: unknown, tagsValue?: unknown, attribution = "") : Job | null {
  const title = clean(titleValue, 200), company = clean(companyValue, 160);
  if (!title || !company) return null;
  let url: string;
  try { url = canonical(typeof urlValue === "string" ? urlValue : ""); if (!/^https?:$/.test(new URL(url).protocol)) return null; } catch { return null; }
  const idText = typeof rawId === "string" || typeof rawId === "number" ? String(rawId).trim() : "";
  const sourceId = (idText || createHash("sha256").update(url).digest("hex")).slice(0, 200);
  const posted = typeof postedValue === "string" ? Date.parse(postedValue) : typeof postedValue === "number" ? postedValue * 1000 : NaN;
  const tags = Array.isArray(tagsValue) ? tagsValue.filter((x): x is string => typeof x === "string").map(x => clean(x, 100)).slice(0, 30) : [];
  const loc = clean(locationValue, 200);
  const country = inferCountry(loc);
  const remote = typeof remoteValue === "boolean" ? remoteValue : /remote|worldwide|anywhere/i.test(`${loc} ${clean(descValue, 500)}`) ? true : null;
  return { sourceId, source, sourceAttribution: attribution, title, company, location: loc, country, workArrangement: remote === true ? "remote" : null, url, description: clean(descValue), remote, publishedAt: Number.isFinite(posted) ? new Date(posted).toISOString() : null, tags, jobTypes: [] };
}
function inferCountry(location: string): string | null {
  const supported = ["United States", "USA", "Canada", "India", "United Kingdom", "UK", "Germany", "France", "Australia", "Singapore", "Ireland", "Netherlands", "Spain", "Brazil", "Mexico", "Worldwide"];
  return supported.find(country => new RegExp(`(^|[,\\s])${country.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}($|[,\\s])`, "i").test(location)) ?? null;
}
async function getJson(fetcher: Fetcher, url: string): Promise<unknown> {
  let response: Response;
  try { response = await fetcher(url, { headers: { Accept: "application/json", "User-Agent": "ApplyPilotAI/1.0 job-discovery" }, signal: AbortSignal.timeout(8000) }); }
  catch (error) { throw new JobSourceError(error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "timeout" : "unavailable", "A public job source could not be reached."); }
  if (response.status === 429) throw new JobSourceError("rate_limited", "A public job source is rate limiting requests.");
  if (!response.ok) throw new JobSourceError("unavailable", `A public job source returned HTTP ${response.status}.`);
  try { return await response.json(); } catch { throw new JobSourceError("unavailable", "A public job source returned malformed JSON."); }
}
function asAdapter(id: JobAdapter["id"], name: string, attribution: string, limitations: string[], fetchJobs: JobAdapter["fetchJobs"]): JobAdapter { return { id, name, attribution, limitations, fetchJobs }; }

export function createPublicJobAdapters(fetcher: Fetcher = fetch): JobAdapter[] {
  const arbeitnow = createArbeitnowSource(fetcher);
  const adapters: JobAdapter[] = [arbeitnow,
    asAdapter("remotive", "Remotive", "Remotive", ["Public API feed is delayed; keyword and country filters are applied locally to a bounded feed."], async () => {
      const body = await getJson(fetcher, "https://remotive.com/api/remote-jobs?limit=100");
      const rows = body && typeof body === "object" ? (body as { jobs?: unknown }).jobs : null;
      if (!Array.isArray(rows)) throw new JobSourceError("unavailable", "Remotive returned an unexpected response.");
      return rows.map((item: Raw) => normalizeExternalJob("remotive", item.id, item.title, item.company_name, item.candidate_required_location, item.url, item.description, true, item.publication_date, [item.category, item.job_type].filter(Boolean), "Remotive")).filter((job): job is Job => job !== null);
    }),
    asAdapter("remote_ok", "Remote OK", "Remote OK", ["The public feed lists remote jobs; country eligibility is not guaranteed and filters are applied locally."], async () => {
      const body = await getJson(fetcher, "https://remoteok.com/api");
      if (!Array.isArray(body)) throw new JobSourceError("unavailable", "Remote OK returned an unexpected response.");
      return body.filter((row: unknown) => !!row && typeof row === "object" && "id" in row).map((item: Raw) => normalizeExternalJob("remote_ok", item.id, item.position, item.company, item.location, item.url, item.description, true, item.date, item.tags, "Remote OK")).filter((job): job is Job => job !== null).slice(0, 200);
    })
  ];
  const boards = (process.env.GREENHOUSE_BOARDS ?? "").split(",").map(x => x.trim()).filter(x => /^[a-z0-9_-]{1,80}$/i.test(x));
  if (boards.length) adapters.push(asAdapter("greenhouse", "Greenhouse", "Greenhouse public job board", ["Only configured company boards are searched; the API does not discover board names."], async () => {
    const results = await Promise.all(boards.slice(0, 10).map(async board => {
      const body = await getJson(fetcher, `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`);
      const rows = body && typeof body === "object" ? (body as { jobs?: unknown }).jobs : null;
      if (!Array.isArray(rows)) throw new JobSourceError("unavailable", "Greenhouse returned an unexpected response.");
      return rows.map((item: Raw) => normalizeExternalJob("greenhouse", item.id, item.title, board, (item.location as Raw | undefined)?.name, item.absolute_url, item.content, null, item.updated_at, [], "Greenhouse"));
    }));
    return results.flat().filter((job): job is Job => job !== null).slice(0, 200);
  }));
  const leverSites = (process.env.LEVER_SITES ?? "").split(",").map(x => x.trim()).filter(x => /^[a-z0-9_-]{1,80}$/i.test(x));
  if (leverSites.length) adapters.push(asAdapter("lever", "Lever", "Lever public postings API", ["Only configured company sites are searched; the API does not discover site names."], async () => {
    const results = await Promise.all(leverSites.slice(0, 10).map(async site => {
      const body = await getJson(fetcher, `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`);
      if (!Array.isArray(body)) throw new JobSourceError("unavailable", "Lever returned an unexpected response.");
      return body.map((item: Raw) => normalizeExternalJob("lever", item.id, item.text, site, item.categories && typeof item.categories === "object" ? (item.categories as Raw).location : "", item.hostedUrl, item.descriptionPlain ?? item.description, null, item.createdAt, [], "Lever"));
    }));
    return results.flat().filter((job): job is Job => job !== null).slice(0, 200);
  }));
  return adapters;
}

export function createJobSourceRegistry(adapters = createPublicJobAdapters()): JobSource {
  const enabled = configuredSources();
  return { async search(query: JobSearchInput) {
    const requested = query.sources ? new Set(query.sources.split(",").map(x => x.trim().toLowerCase()).filter(Boolean)) : null;
    const candidates = adapters.filter(adapter => enabled.has(adapter.id) && (!requested || requested.has(adapter.id)));
    const statuses: SourceStatus[] = adapters.map(adapter => ({ id: adapter.id, name: adapter.name, status: !enabled.has(adapter.id) || (requested && !requested.has(adapter.id)) ? "disabled" : "available", fetched: 0, limitations: adapter.limitations }));
    for (const id of ["greenhouse", "lever"]) if (!adapters.some(adapter => adapter.id === id)) statuses.push({ id, name: SOURCE_NAMES[id]!, status: "disabled", fetched: 0, limitations: [`Configure ${id === "greenhouse" ? "GREENHOUSE_BOARDS" : "LEVER_SITES"} with known public board identifiers to enable.`] });
    const results = await Promise.all(candidates.map(async adapter => {
      try { const jobs = await adapter.fetchJobs(); return { adapter, jobs, error: "" }; }
      catch (error) { return { adapter, jobs: [] as Job[], error: error instanceof JobSourceError ? error.message : "This source is temporarily unavailable." }; }
    }));
    const all: Job[] = [];
    const byCanonical = new Set<string>();
    const bySourceId = new Set<string>();
    const limitations: string[] = [];
    for (const result of results) {
      const status = statuses.find(item => item.id === result.adapter.id)!;
      if (result.error) { status.status = "error"; status.message = result.error; continue; }
      status.fetched = result.jobs.length;
      limitations.push(...result.adapter.limitations);
      for (const job of result.jobs) {
        let key = ""; try { key = canonical(job.url); } catch { continue; }
        const sourceKey = `${job.source}:${job.sourceId}`;
        if (bySourceId.has(sourceKey) || byCanonical.has(key)) continue;
        bySourceId.add(sourceKey); byCanonical.add(key); all.push(job);
      }
    }
    const keyword = query.keyword.toLowerCase(), location = query.location.toLowerCase(), country = query.country.toLowerCase();
    const matching = all.filter(job => {
      const text = `${job.title} ${job.company} ${job.description} ${job.tags.join(" ")}`.toLowerCase();
      return (!keyword || text.includes(keyword)) && (!location || job.location.toLowerCase().includes(location)) && (!country || `${job.country ?? ""} ${job.location}`.toLowerCase().includes(country)) && (!query.remoteOnly || job.remote);
    });
    const start = (query.page - 1) * query.pageSize;
    return { jobs: matching.slice(start, start + query.pageSize), total: matching.length, page: query.page, pageSize: query.pageSize, hasNextPage: start + query.pageSize < matching.length, sources: statuses, coverageLimitations: [...new Set(limitations)] };
  } };
}
