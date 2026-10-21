import { useEffect, useState, type FormEvent } from "react";
import { applicationStatuses, createApplicationSchema, type ApplicationRecord } from "@applypilot/shared";
import Icon from "./Icon.js";
import JobsPage from "./JobsPage.js";
import WorkspaceNav from "./WorkspaceNav.js";
import CandidateProfilePage from "./CandidateProfilePage.js";
import JobRecommendationsPage from "./JobRecommendationsPage.js";

const api = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const labels: Record<string, string> = { saved: "Saved", applied: "Applied", interview: "Interview", offer: "Offer", rejected: "Closed" };
type ThemeMode = "light" | "dark" | "system";
const themeOrder: ThemeMode[] = ["system", "light", "dark"];

function getInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem("applypilot-theme");
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch { /* Storage can be unavailable in restricted browser contexts. */ }
  return "system";
}

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function ThemeIcon({ theme }: { theme: "light" | "dark" }) {
  return theme === "light"
    ? <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.7" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg>
    : <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.2 15.3A8.4 8.4 0 0 1 8.7 3.8a8.5 8.5 0 1 0 11.5 11.5Z" /></svg>;
}

export default function App() {
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(getSystemTheme);
  const [page, setPage] = useState<"applications" | "discover" | "saved" | "recommendations" | "profile">("applications");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const activeTheme = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = activeTheme;
      setSystemTheme(media.matches ? "dark" : "light");
      const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (themeColor) themeColor.content = getComputedStyle(document.documentElement).getPropertyValue("--canvas").trim();
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    try { localStorage.setItem("applypilot-theme", theme); } catch { /* The active theme still works for this session. */ }
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

  async function load() {
    try {
      const response = await fetch(`${api}/api/applications`);
      if (!response.ok) throw new Error("Could not load applications. Check that the API and PostgreSQL are running.");
      setApplications(await response.json() as ApplicationRecord[]);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not connect to the API."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const parsed = createApplicationSchema.safeParse(data);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Please check the form."); setBusy(false); return; }
    try {
      const response = await fetch(`${api}/api/applications`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error?.message ?? "Could not save application."); }
      const created = await response.json() as ApplicationRecord;
      setApplications(current => [created, ...current]);
      setFormOpen(false);
      form.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save application."); }
    finally { setBusy(false); }
  }

  const counts = Object.fromEntries(applicationStatuses.map(status => [status, applications.filter(app => app.status === status).length]));
  const nextTheme = themeOrder[(themeOrder.indexOf(theme) + 1) % themeOrder.length];
  const iconTheme = theme === "system" ? systemTheme : theme;

  return <div className="layout">
    <aside className="sidebar">
      <a className="brand" href="#home"><span className="brand-mark">A</span><span>applypilot<span className="brand-ai"> AI</span></span></a>
      <div className="side-label">WORKSPACE</div>
      <WorkspaceNav page={page} applicationCount={applications.length} onSelect={setPage} />
      <div className="sidebar-bottom"><div className="profile"><div className="avatar">Y</div><div><strong>Your workspace</strong><small>Personal plan</small></div></div></div>
    </aside>
    <main className="main" id="home">
      <header className="topbar">
        <div className="crumb">Workspace <span>/</span> <strong>{page === "applications" ? "Applications" : page === "discover" ? "Discover jobs" : page === "saved" ? "Saved jobs" : page === "recommendations" ? "Recommendations" : "Candidate profile"}</strong></div>
        <div className="top-actions"><span className="today">Your search, at a glance</span><button className="theme-toggle" type="button" aria-label={`Theme is ${theme}. Switch to ${nextTheme}.`} title={`Theme: ${theme}. Switch to ${nextTheme}.`} onClick={() => setTheme(nextTheme)}><ThemeIcon theme={iconTheme} /><span>{theme[0].toUpperCase() + theme.slice(1)}</span></button><div className="avatar small">Y</div></div>
      </header>
      <section className="content" id="applications" hidden={page !== "applications"}>
        <div className="eyebrow">YOUR JOB SEARCH</div>
        <div className="heading-row"><div><h1>Applications</h1><p className="intro">Keep every opportunity moving forward.</p></div><button className="primary" onClick={() => setFormOpen(open => !open)}><Icon name="plus" className="mr-1 inline h-4 w-4 align-[-3px]" /> Add application</button></div>
        <div className="stats">
          <div className="stat"><span className="stat-icon lavender"><Icon name="grid" className="h-4 w-4" /></span><div><span className="stat-label">Total tracked</span><strong>{applications.length}</strong></div></div>
          <div className="stat"><span className="stat-icon blue"><Icon name="chart" className="h-4 w-4" /></span><div><span className="stat-label">In progress</span><strong>{counts.applied + counts.interview}</strong></div></div>
          <div className="stat"><span className="stat-icon amber"><Icon name="sparkles" className="h-4 w-4" /></span><div><span className="stat-label">Interviews</span><strong>{counts.interview}</strong></div></div>
          <div className="stat"><span className="stat-icon green"><Icon name="briefcase" className="h-4 w-4" /></span><div><span className="stat-label">Offers</span><strong>{counts.offer}</strong></div></div>
        </div>
        {formOpen && <form className="application-form" onSubmit={submit}>
          <div className="form-heading"><div><h2>New application</h2><p>Add an opportunity to your tracker.</p></div><button type="button" className="close" onClick={() => setFormOpen(false)} aria-label="Close"><Icon name="plus" className="h-4 w-4 rotate-45" /></button></div>
          <div className="form-grid"><label>Company *<input name="company" required maxLength={160} placeholder="e.g. Linear" /></label><label>Role *<input name="role" required maxLength={200} placeholder="e.g. Product Designer" /></label><label>Location<input name="location" maxLength={120} placeholder="e.g. Remote, US" /></label><label>Job URL<input name="jobUrl" type="url" placeholder="https://..." /></label><label>Status<select name="status" defaultValue="saved">{applicationStatuses.map(status => <option key={status} value={status}>{labels[status]}</option>)}</select></label><label className="wide">Notes<textarea name="notes" rows={2} maxLength={4000} placeholder="Anything you want to remember..." /></label></div>
          <div className="form-footer"><button type="button" className="secondary" onClick={() => setFormOpen(false)}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Saving..." : "Save application"}</button></div>
        </form>}
        {error && <div className="alert" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>Retry</button></div>}
        <div className="list-heading"><div><h2>All applications</h2><span className="record-count">{applications.length} {applications.length === 1 ? "opportunity" : "opportunities"}</span></div><button className="filter" type="button" aria-label="Filter applications"><Icon name="filter" className="h-3.5 w-3.5" /><span>All statuses</span><Icon name="chevronDown" className="h-3.5 w-3.5" /></button></div>
        <div className="table-wrap"><table><thead><tr><th>COMPANY &amp; ROLE</th><th>LOCATION</th><th>STATUS</th><th>ADDED</th><th></th></tr></thead><tbody>
          {loading ? <tr><td className="empty" colSpan={5}>Loading your applications...</td></tr> : applications.length ? applications.map(item => <tr key={item.id}><td><div className="company-cell"><span className="company-mark">{item.company.slice(0, 1).toUpperCase()}</span><div><strong>{item.company}</strong><small>{item.role}</small></div></div></td><td className="subtle">{item.location || "-"}</td><td><span className={`badge ${item.status}`}>{labels[item.status]}</span></td><td className="subtle">{new Date(item.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</td><td className="subtle"><Icon name="ellipsis" className="h-4 w-4" /></td></tr>) : <tr><td colSpan={5}><div className="empty-state"><span className="empty-icon"><Icon name="briefcase" className="h-5 w-5" /></span><strong>Your next opportunity starts here</strong><p>Add your first application to keep your search organized.</p><button className="secondary" type="button" onClick={() => setFormOpen(true)}><Icon name="plus" className="mr-1 inline h-4 w-4 align-[-3px]" /> Add an application</button></div></td></tr>}
        </tbody></table></div>
        <footer className="footer"><span>One step at a time. You have got this.</span><span>ApplyPilot AI <b>|</b> Made for the next move</span></footer>
      </section>
      {(page === "discover" || page === "saved") && <JobsPage view={page} onMoved={() => void load()} />}
      {page === "recommendations" && <JobRecommendationsPage onOpenProfile={() => setPage("profile")} />}
      {page === "profile" && <CandidateProfilePage />}
    </main>
  </div>;
}
