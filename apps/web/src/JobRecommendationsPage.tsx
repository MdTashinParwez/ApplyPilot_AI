import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon.js";

const api = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
type Factor = { name: string; score: number | null; weight: number; available: boolean; matchedEvidence: string[]; limitations: string[] };
type Recommendation = {
  sourceId: string; source: string; title: string; company: string; location: string; country: string | null; workArrangement: string | null; url: string; remote: boolean | null;
  score: number | null; recommendation: string; confidence: string; confidenceReasons: string[];
  factorBreakdown: Factor[]; matchedEvidence: string[]; missingOrUnverified: string[]; explanation: string[];
};
type ResponseBody = { status: "ready" | "profile_incomplete"; message?: string; evaluatedCount: number; availableCount: number; hasMore: boolean; recommendations: Recommendation[]; sources: Array<{ id: string; name: string; status: string; fetched: number; message?: string; limitations: string[] }>; coverageLimitations: string[] };

const badgeText: Record<string, string> = { strong_match: "Strong match", potential_match: "Potential match", low_match: "Lower match", ineligible: "Known preference conflict", unknown: "Not enough information" };
const factorLabels: Record<string, string> = { skills: "Skills", role: "Role relevance", experience: "Experience evidence", location: "Location & work preferences" };

export default function JobRecommendationsPage({ onOpenProfile }: { onOpenProfile: () => void }) {
  const [data, setData] = useState<ResponseBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`${api}/api/job-recommendations`, { signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not evaluate current jobs.");
      setData(body as ResponseBody);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Could not evaluate current jobs.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [attempt, load]);

  return <section className="mx-auto w-full max-w-[1176px] px-4 py-7 sm:px-6 md:py-10 lg:px-12">
    <div className="text-[10px] font-bold tracking-[1.15px] text-[var(--text-muted)]">YOUR JOB SEARCH</div>
    <div className="mt-2 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold tracking-tight text-[var(--text)] md:text-[29px]">Job recommendations</h1><p className="mt-1.5 text-xs text-[var(--text-muted)]">Rankings compare available job sources with the details in your profile. Review each explanation before deciding what to do.</p></div><button className="secondary" type="button" disabled={loading} onClick={() => setAttempt(value => value + 1)}><Icon name="chart" className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" />{loading ? "Evaluating…" : "Refresh recommendations"}</button></div>
    {loading && <div className="mt-5 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-5 py-12 text-center text-xs text-[var(--text-secondary)]" role="status">Comparing current listings with your profile…</div>}
    {error && <div className="alert" role="alert"><span>{error}</span><button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>}
    {!loading && !error && data?.status === "profile_incomplete" && <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-soft)]"><h2 className="text-sm font-bold text-[var(--text)]">Add profile details to get recommendations</h2><p className="mt-2 text-xs text-[var(--text-secondary)]">{data.message}</p><button className="primary mt-4" type="button" onClick={onOpenProfile}>Complete candidate profile</button></div>}
    {!loading && !error && data?.status === "ready" && <>
      <div className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-[10px] text-[var(--text-secondary)]"><strong className="text-[var(--text)]">Sources searched</strong><div className="mt-2 flex flex-wrap gap-2">{data.sources?.map(source => <span key={source.id} className={`rounded-full px-2 py-1 ${source.status === "available" ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : source.status === "error" ? "bg-red-500/10 text-red-600 dark:text-red-300" : "border border-[var(--border)] text-[var(--text-muted)]"}`}>{source.name}: {source.status === "available" ? `${source.fetched} fetched` : source.status}{source.message ? ` · ${source.message}` : ""}</span>)}</div>{!!data.coverageLimitations?.length && <details className="mt-2"><summary className="cursor-pointer font-semibold">Coverage limits</summary><ul className="mt-1 list-inside list-disc">{data.coverageLimitations.map(item => <li key={item}>{item}</li>)}</ul></details>}</div>
      <div className="mb-3 mt-7 flex items-baseline justify-between"><h2 className="text-[15px] font-bold text-[var(--text)]">Ranked listings</h2><span className="text-[11px] text-[var(--text-muted)]">Evaluated {data.evaluatedCount} of {data.availableCount} available jobs</span></div>
      {data.recommendations.length === 0 ? <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-5 py-12 text-center text-xs text-[var(--text-secondary)]">No current listings were available to evaluate. Refresh to try again.</div> : <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{data.recommendations.map((item, index) => <article key={`${item.source}:${item.sourceId}`} className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-soft)] sm:p-5">
        <div className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold text-[var(--text-muted)]">#{index + 1} · {item.source}</p><h3 className="mt-1 text-[15px] font-bold leading-snug text-[var(--text)]">{item.title}</h3><p className="mt-1 text-xs text-[var(--text-secondary)]">{item.company} · {item.location || "Location not listed"}{item.remote === true ? " · Remote" : ""}</p></div><div className="shrink-0 text-right"><div className="text-xl font-bold text-[var(--accent-text)]">{item.score === null ? "—" : `${item.score}`}<span className="text-[11px]">{item.score === null ? "" : "/100"}</span></div><span className="inline-block rounded-full bg-[var(--accent-soft)] px-2 py-1 text-[10px] font-semibold text-[var(--accent-text)]">{badgeText[item.recommendation] ?? item.recommendation}</span></div></div>
        <div className="mt-4 space-y-2.5">{item.factorBreakdown.map(factor => <div key={factor.name} className="grid grid-cols-[minmax(112px,1fr)_2fr_36px] items-center gap-2 text-[10px]"><span className="text-[var(--text-secondary)]">{factorLabels[factor.name] ?? factor.name}</span><div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-hover)]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${factor.available && factor.score !== null ? Math.max(0, Math.min(100, factor.score)) : 0}%` }} /></div><span className="text-right text-[var(--text-muted)]">{factor.available && factor.score !== null ? `${factor.score}` : "Unknown"}</span></div>)}</div>
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">{item.explanation.join(" ")}</p>
        <p className="mt-2 text-[10px] text-[var(--text-muted)]">Confidence: <strong className="capitalize">{item.confidence}</strong>{item.confidenceReasons.length ? ` · ${item.confidenceReasons.join(" ")}` : ""}</p>
        {!!item.matchedEvidence.length && <div className="mt-3"><h4 className="text-[10px] font-bold text-[var(--text)]">Matched evidence</h4><ul className="mt-1 list-inside list-disc space-y-1 text-[10px] text-[var(--text-secondary)]">{item.matchedEvidence.slice(0, 6).map((evidence, i) => <li key={`${i}-${evidence}`}>{evidence}</li>)}</ul></div>}
        {!!item.missingOrUnverified.length && <div className="mt-3"><h4 className="text-[10px] font-bold text-[var(--text)]">Missing or unverified</h4><ul className="mt-1 list-inside list-disc space-y-1 text-[10px] text-[var(--text-secondary)]">{item.missingOrUnverified.slice(0, 6).map((evidence, i) => <li key={`${i}-${evidence}`}>{evidence}</li>)}</ul></div>}
        <div className="mt-4"><a className="secondary inline-flex min-h-9 w-full items-center justify-center gap-1.5 px-2.5 text-center text-[11px] no-underline" href={item.url} target="_blank" rel="noopener noreferrer">Open original listing <Icon name="arrowUpRight" className="h-3.5 w-3.5" /></a></div>
      </article>)}</div>}
      {data.hasMore && <p className="mt-4 text-center text-[10px] text-[var(--text-muted)]">Recommendations evaluate the first page of current available listings.</p>}
    </>}
    <footer className="mt-6 flex flex-col justify-between gap-3 py-5 text-[10px] text-[var(--text-faint)] sm:flex-row"><span>Recommendations are read-only and are not applications.</span><span>ApplyPilot AI <b>|</b> Made for the next move</span></footer>
  </section>;
}
