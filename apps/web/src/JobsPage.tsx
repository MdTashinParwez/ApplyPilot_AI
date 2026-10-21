import { useEffect, useState } from "react";
import type { Job, SavedJob } from "@applypilot/shared";
import Icon from "./Icon.js";

const api = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
type SourceInfo = { id: string; name: string; status: "available" | "disabled" | "error"; fetched: number; message?: string; limitations: string[] };
type SearchResponse = { jobs: Job[]; total: number; page: number; pageSize: number; hasNextPage: boolean; sources?: SourceInfo[]; coverageLimitations?: string[]; matchScores?: Record<string, { score: number | null; recommendation: string; confidence: string }>; evaluatorStatus?: string; evaluatorMessage?: string };

function JobCard({
  job, view, busy, message, match, onSave, onMove
}: {
  job: Job | SavedJob;
  view: "discover" | "saved";
  busy: boolean;
  message?: string;
  match?: { score: number | null; recommendation: string; confidence: string };
  onSave: (job: Job) => void;
  onMove: (job: SavedJob) => void;
}) {
  const savedJob = "id" in job;
  const isTracked = savedJob && Boolean(job.applicationId);
  return <article className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-soft)] transition duration-150 hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-card)] dark:shadow-[var(--shadow-card)] sm:p-5">
    <div className="flex items-center gap-2.5">
      <span className="company-mark" aria-hidden="true">{job.company.slice(0, 1).toUpperCase()}</span>
      <span className="ml-auto rounded-full bg-[var(--accent-soft)] px-2 py-1 text-[10px] font-semibold text-[var(--accent-text)]">{job.sourceAttribution || job.source}</span>
    </div>
    <h2 className="mt-3.5 text-[15px] font-bold leading-snug text-[var(--text)]">{job.title}</h2>
    <p className="mt-1 text-xs text-[var(--text-secondary)]">{job.company}</p>
    <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-muted)]">
      <span>{job.location || "Location not listed"}</span>
      {job.remote && <span className="rounded-full bg-[var(--accent-soft)] px-2 py-1 font-semibold text-[var(--accent-text)]">Remote</span>}
      {match && <span className="rounded-full border border-[var(--border)] px-2 py-1 font-semibold text-[var(--text-secondary)]">{match.score === null ? "Match unknown" : `${match.score}/100 match`}{match.confidence === "low" ? " · limited" : ""}</span>}
      {job.publishedAt && <time className="ml-auto" dateTime={job.publishedAt}>{new Date(job.publishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</time>}
    </div>
    {job.description && <details className="mt-3 border-t border-[var(--border)] pt-2.5">
      <summary className="cursor-pointer text-[11px] font-semibold text-[var(--accent-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]">View job details</summary>
      <p className="mt-2 max-h-36 overflow-auto text-[11px] leading-relaxed text-[var(--text-secondary)]">{job.description}</p>
    </details>}
    <div className="mt-4 flex gap-2">
      <a className="secondary inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 px-2.5 text-center text-[11px] no-underline" href={job.url} target="_blank" rel="noopener noreferrer">Open listing <Icon name="arrowUpRight" className="h-3.5 w-3.5" /></a>
      {view === "discover" ? <button className="primary min-h-9 flex-1 px-2.5 text-[11px]" type="button" disabled={busy} onClick={() => onSave(job)}>{busy ? "Saving…" : "Save job"}</button> : (savedJob && <button className="primary min-h-9 flex-1 px-2.5 text-[11px]" type="button" disabled={busy || isTracked} onClick={() => onMove(job)}>{isTracked ? "In applications" : busy ? "Adding…" : "Add to tracker"}</button>)}
    </div>
    {message && <p className="mt-2.5 text-[11px] text-[var(--accent-text)]" role="status">{message}</p>}
  </article>;
}

export default function JobsPage({ view, onMoved }: { view: "discover" | "saved"; onMoved: () => void }) {
  const [keyword, setKeyword] = useState("");
  const [location, setLocation] = useState("");
  const [country, setCountry] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [savedJobs, setSavedJobs] = useState<SavedJob[]>([]);
  const [total, setTotal] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [coverage, setCoverage] = useState<string[]>([]);
  const [matchScores, setMatchScores] = useState<SearchResponse["matchScores"]>({});
  const [evaluatorMessage, setEvaluatorMessage] = useState("");

  useEffect(() => { setPage(1); }, [keyword, location, country, remoteOnly]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    const load = async () => {
      setLoading(true); setError("");
      try {
        if (view === "saved") {
          const response = await fetch(`${api}/api/saved-jobs`, { signal: controller.signal });
          if (!response.ok) throw new Error("Could not load saved jobs. Check that the API and PostgreSQL are running.");
          setSavedJobs(await response.json() as SavedJob[]);
        } else {
          const params = new URLSearchParams({ keyword, location, country, remoteOnly: String(remoteOnly), includeMatches: "true", page: String(page), pageSize: "12" });
          const response = await fetch(`${api}/api/jobs?${params}`, { signal: controller.signal });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error?.message ?? "The job feed is unavailable. Please retry.");
          const result = body as SearchResponse;
          setJobs(result.jobs); setTotal(result.total); setHasNextPage(result.hasNextPage); setSources(result.sources ?? []); setCoverage(result.coverageLimitations ?? []); setMatchScores(result.matchScores ?? {}); setEvaluatorMessage(result.evaluatorMessage ?? (result.evaluatorStatus === "profile_incomplete" ? "Complete your candidate profile to see match scores." : ""));
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load jobs.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    if (view === "discover") timer = window.setTimeout(() => void load(), 350);
    else void load();
    return () => { controller.abort(); if (timer !== undefined) window.clearTimeout(timer); };
  }, [view, keyword, location, country, remoteOnly, page, attempt]);

  async function save(job: Job) {
    setBusyId(job.sourceId); setFeedback(current => ({ ...current, [job.sourceId]: "" }));
    try {
      const response = await fetch(`${api}/api/saved-jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(job) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not save this job.");
      setFeedback(current => ({ ...current, [job.sourceId]: body.duplicate ? "Already in Saved Jobs." : "Job saved." }));
    } catch (cause) { setFeedback(current => ({ ...current, [job.sourceId]: cause instanceof Error ? cause.message : "Could not save this job." })); }
    finally { setBusyId(""); }
  }

  async function move(job: SavedJob) {
    setBusyId(job.id); setFeedback(current => ({ ...current, [job.id]: "" }));
    try {
      const response = await fetch(`${api}/api/saved-jobs/${encodeURIComponent(job.id)}/move-to-application`, { method: "POST" });
      const body = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(body?.error?.message ?? "Could not add this job to applications.");
      if (typeof body?.application?.id !== "string") throw new Error("The API did not return the tracker record. Retry to check whether it was added.");
      setSavedJobs(current => current.map(item => item.id === job.id ? { ...item, applicationId: body.application.id } : item));
      setFeedback(current => ({ ...current, [job.id]: body.alreadyTracked ? "Already in your applications." : "Added to applications." }));
      onMoved();
    } catch (cause) { setFeedback(current => ({ ...current, [job.id]: cause instanceof Error ? cause.message : "Could not move this job." })); }
    finally { setBusyId(""); }
  }

  const cards: (Job | SavedJob)[] = view === "saved" ? savedJobs : jobs;
  return <section className="mx-auto w-full max-w-[1176px] px-4 py-7 sm:px-6 md:py-10 lg:px-12">
    <div className="text-[10px] font-bold tracking-[1.15px] text-[var(--text-muted)]">YOUR JOB SEARCH</div>
    <div className="mt-2 flex items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold tracking-tight text-[var(--text)] md:text-[29px]">{view === "saved" ? "Saved jobs" : "Discover jobs"}</h1><p className="mt-1.5 text-xs text-[var(--text-muted)]">{view === "saved" ? "Keep promising roles close, then add them to your tracker." : "Explore current listings from the Arbeitnow job board."}</p></div>
    </div>
    {view === "discover" && <form className="mt-5 grid items-end gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-soft)] md:mt-6 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" onSubmit={event => event.preventDefault()} role="search" aria-label="Filter jobs">
      <label className="flex flex-col gap-1.5 text-[11px] font-semibold text-[var(--text-secondary)]">Keyword<input className="min-h-[38px] w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-2 text-xs text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--focus)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]" value={keyword} onChange={event => setKeyword(event.target.value)} maxLength={100} placeholder="Title, company, skills" /></label>
      <label className="flex flex-col gap-1.5 text-[11px] font-semibold text-[var(--text-secondary)]">Location<input className="min-h-[38px] w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-2 text-xs text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--focus)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]" value={location} onChange={event => setLocation(event.target.value)} maxLength={100} placeholder="City or country" /></label>
      <label className="flex flex-col gap-1.5 text-[11px] font-semibold text-[var(--text-secondary)]">Country<input className="min-h-[38px] w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-2 text-xs text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--focus)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]" value={country} onChange={event => setCountry(event.target.value)} maxLength={100} placeholder="Any country" /></label>
      <label className="flex min-h-[38px] items-center gap-2 whitespace-nowrap text-[11px] font-semibold text-[var(--text-secondary)]"><input className="h-4 w-4 accent-[var(--accent)]" type="checkbox" checked={remoteOnly} onChange={event => setRemoteOnly(event.target.checked)} />Remote only</label>
    </form>}
    {view === "discover" && <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-[10px] text-[var(--text-secondary)]"><div className="flex flex-wrap items-center gap-2"><strong className="text-[var(--text)]">Sources</strong>{loading ? <span role="status">Checking feeds…</span> : sources.map(source => <span key={source.id} className={`rounded-full px-2 py-1 ${source.status === "available" ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : source.status === "error" ? "bg-red-500/10 text-red-600 dark:text-red-300" : "border border-[var(--border)] text-[var(--text-muted)]"}`}>{source.name}: {source.status === "available" ? `${source.fetched} fetched` : source.status}{source.message ? ` · ${source.message}` : ""}</span>)}</div>{evaluatorMessage && <p className="mt-2">{evaluatorMessage}</p>}{coverage.length > 0 && <details className="mt-2"><summary className="cursor-pointer font-semibold">Coverage limits</summary><ul className="mt-1 list-inside list-disc">{coverage.map(item => <li key={item}>{item}</li>)}</ul></details>}</div>}
    {view === "discover" && <div className="mb-3 mt-7 flex items-baseline justify-between"><h2 className="text-[15px] font-bold text-[var(--text)]">Job listings</h2><span className="text-[11px] text-[var(--text-muted)]">{loading ? "Searching…" : `${total} ${total === 1 ? "result" : "results"}`}</span></div>}
    {error && <div className="alert" role="alert"><span>{error}</span><button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>}
    {loading && <div className="mt-4 rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-5 py-11 text-center text-xs text-[var(--text-secondary)]" role="status">{view === "saved" ? "Loading saved jobs…" : "Searching current listings…"}</div>}
    {!loading && !error && cards.length === 0 && <div className="mt-4 rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-5 py-11 text-center text-[var(--text)]"><strong className="text-sm font-bold">{view === "saved" ? "No saved jobs yet" : "No matching jobs found"}</strong><p className="mt-2 text-[11px] text-[var(--text-muted)]">{view === "saved" ? "Save a listing from Job Discovery to see it here." : "Try another keyword or location, or clear the remote filter."}</p></div>}
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{!loading && !error && cards.map(job => <JobCard key={"id" in job ? job.id : `${job.source}:${job.sourceId}`} job={job} view={view} match={"id" in job ? undefined : matchScores?.[`${job.source}:${job.sourceId}`]} busy={busyId === ("id" in job ? job.id : job.sourceId)} message={feedback["id" in job ? job.id : job.sourceId]} onSave={save} onMove={move} />)}</div>
    {view === "discover" && <div className="my-6 flex items-center justify-center gap-4 text-[11px] text-[var(--text-muted)]"><button className="secondary min-w-[82px]" type="button" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page}</span><button className="secondary min-w-[82px]" type="button" disabled={!hasNextPage || loading} onClick={() => setPage(value => value + 1)}>Next</button></div>}
    <footer className="mt-6 flex flex-col justify-between gap-3 py-5 text-[10px] text-[var(--text-faint)] sm:flex-row"><span>Listings are attributed to their original job sources.</span><span>Listings open at their original source</span></footer>
  </section>;
}
