import { useEffect, useState, type FormEvent } from "react";
import { applicationStatuses, createApplicationSchema, type ApplicationRecord } from "@applypilot/shared";

const api = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const labels: Record<string, string> = { saved: "Saved", applied: "Applied", interview: "Interview", offer: "Offer", rejected: "Closed" };

export default function App() {
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const response = await fetch(`${api}/api/applications`);
      if (!response.ok) throw new Error("Could not load applications. Check that the API and MongoDB are running.");
      setApplications(await response.json() as ApplicationRecord[]);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not connect to the API."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const parsed = createApplicationSchema.safeParse(data);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Please check the form."); setBusy(false); return; }
    try {
      const response = await fetch(`${api}/api/applications`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error?.message ?? "Could not save application."); }
      const created = await response.json() as ApplicationRecord;
      setApplications(current => [created, ...current]); setFormOpen(false); event.currentTarget.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save application."); }
    finally { setBusy(false); }
  }

  const counts = Object.fromEntries(applicationStatuses.map(status => [status, applications.filter(app => app.status === status).length]));
  return <div className="layout">
    <aside className="sidebar"><a className="brand" href="#home"><span className="brand-mark">A</span><span>applypilot<span className="brand-ai"> AI</span></span></a><div className="side-label">WORKSPACE</div><a className="nav active" href="#applications"><span>▦</span> Applications <span className="nav-count">{applications.length}</span></a><a className="nav muted" href="#today"><span>◷</span> Today</a><div className="sidebar-bottom"><div className="profile"><div className="avatar">Y</div><div><strong>Your workspace</strong><small>Personal plan</small></div><span className="dots">···</span></div></div></aside>
    <main className="main" id="home"><header className="topbar"><div className="crumb">Workspace <span>/</span> <strong>Applications</strong></div><div className="top-actions"><span className="today">Your search, at a glance</span><div className="avatar small">Y</div></div></header>
      <section className="content" id="applications"><div className="eyebrow">YOUR JOB SEARCH</div><div className="heading-row"><div><h1>Applications</h1><p className="intro">Keep every opportunity moving forward.</p></div><button className="primary" onClick={() => setFormOpen(open => !open)}><span>＋</span> Add application</button></div>
      <div className="stats"><div className="stat"><span className="stat-icon lavender">▦</span><div><span className="stat-label">Total tracked</span><strong>{applications.length}</strong></div></div><div className="stat"><span className="stat-icon blue">↗</span><div><span className="stat-label">In progress</span><strong>{counts.applied + counts.interview}</strong></div></div><div className="stat"><span className="stat-icon amber">✳</span><div><span className="stat-label">Interviews</span><strong>{counts.interview}</strong></div></div><div className="stat"><span className="stat-icon green">⌁</span><div><span className="stat-label">Offers</span><strong>{counts.offer}</strong></div></div></div>
      {formOpen && <form className="application-form" onSubmit={submit}><div className="form-heading"><div><h2>New application</h2><p>Add an opportunity to your tracker.</p></div><button type="button" className="close" onClick={() => setFormOpen(false)} aria-label="Close">×</button></div><div className="form-grid"><label>Company *<input name="company" required maxLength={120} placeholder="e.g. Linear" /></label><label>Role *<input name="role" required maxLength={120} placeholder="e.g. Product Designer" /></label><label>Location<input name="location" maxLength={120} placeholder="e.g. Remote, US" /></label><label>Job URL<input name="jobUrl" type="url" placeholder="https://..." /></label><label>Status<select name="status" defaultValue="saved">{applicationStatuses.map(status => <option key={status} value={status}>{labels[status]}</option>)}</select></label><label className="wide">Notes<textarea name="notes" rows={2} maxLength={4000} placeholder="Anything you want to remember…" /></label></div><div className="form-footer"><button type="button" className="secondary" onClick={() => setFormOpen(false)}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save application"}</button></div></form>}
      {error && <div className="alert" role="alert"><span>{error}</span><button onClick={() => void load()}>Retry</button></div>}
      <div className="list-heading"><div><h2>All applications</h2><span className="record-count">{applications.length} {applications.length === 1 ? "opportunity" : "opportunities"}</span></div><button className="filter" aria-label="Filter applications">☷ <span>All statuses</span>⌄</button></div>
      <div className="table-wrap"><table><thead><tr><th>COMPANY & ROLE</th><th>LOCATION</th><th>STATUS</th><th>ADDED</th><th></th></tr></thead><tbody>{loading ? <tr><td className="empty" colSpan={5}>Loading your applications…</td></tr> : applications.length ? applications.map(item => <tr key={item.id}><td><div className="company-cell"><span className="company-mark">{item.company.slice(0, 1).toUpperCase()}</span><div><strong>{item.company}</strong><small>{item.role}</small></div></div></td><td className="subtle">{item.location || "—"}</td><td><span className={`badge ${item.status}`}>{labels[item.status]}</span></td><td className="subtle">{new Date(item.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</td><td className="subtle">···</td></tr>) : <tr><td colSpan={5}><div className="empty-state"><span className="empty-icon">▦</span><strong>Your next opportunity starts here</strong><p>Add your first application to keep your search organized.</p><button className="secondary" onClick={() => setFormOpen(true)}>＋ Add an application</button></div></td></tr>}</tbody></table></div>
      <footer className="footer"><span>One step at a time. You’ve got this.</span><span>ApplyPilot AI <b>·</b> Made for the next move</span></footer></section>
    </main>
  </div>;
}
