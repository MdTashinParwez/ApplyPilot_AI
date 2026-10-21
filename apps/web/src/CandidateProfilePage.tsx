import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  candidateProfileSchema,
  type CandidateProfileInput,
  type EducationEntry,
  type ExperienceEntry,
  type ProjectEntry
} from "@applypilot/shared";
import { addProfileItem, mergeResumeProfile, removeProfileItem, saveCandidateProfile, uploadResume } from "./profileForm.js";

const api = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const blankProfile = (): CandidateProfileInput => candidateProfileSchema.parse({});
const panel = "rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-soft)] sm:p-5";
const input = "min-h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--focus)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]";
const label = "flex flex-col gap-1.5 text-[11px] font-semibold text-[var(--text-secondary)]";
type FieldErrors = Record<string, string>;

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const id = `profile-${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
  return <section className={panel} aria-labelledby={id}>
    <div className="mb-4"><h2 className="text-sm font-bold text-[var(--text)]" id={id}>{title}</h2><p className="mt-1 text-[11px] text-[var(--text-muted)]">{description}</p></div>
    {children}
  </section>;
}

function TextField({ title, value, onChange, placeholder, maxLength, multiline = false, error, id: suppliedId, inputType = "text", min, step }: {
  title: string; value: string; onChange: (value: string) => void; placeholder?: string; maxLength?: number; multiline?: boolean; error?: string; id?: string; inputType?: string; min?: number; step?: number;
}) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const errorId = `${id}-error`;
  return <label className={label} htmlFor={id}>{title}{multiline
    ? <textarea id={id} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} className={`${input} min-h-24 resize-y`} value={value} maxLength={maxLength} placeholder={placeholder} onChange={event => onChange(event.target.value)} />
    : <input id={id} type={inputType} min={min} step={step} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} className={input} value={value} maxLength={maxLength} placeholder={placeholder} onChange={event => onChange(event.target.value)} />}
    {error && <span id={errorId} className="text-[10px] font-medium text-[var(--danger-text)]">{error}</span>}
  </label>;
}

function TagEditor({ title, values, placeholder, onChange, error, limit = 50 }: {
  title: string; values: string[]; placeholder: string; onChange: (values: string[]) => void; error?: string; limit?: number;
}) {
  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState("");
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const root = useRef<HTMLDivElement>(null);

  function add() {
    const result = addProfileItem(values, draft, limit);
    if (!result.added) {
      setFeedback(result.reason === "duplicate" ? "This item is already in the list." : result.reason === "limit" ? `You can add up to ${limit} items.` : "Enter an item first.");
      return;
    }
    onChange(result.values);
    setDraft("");
    setFeedback("");
    requestAnimationFrame(() => root.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true }));
  }

  function remove(index: number) {
    onChange(removeProfileItem(values, index));
    requestAnimationFrame(() => {
      const items = root.current?.querySelectorAll<HTMLButtonElement>("[data-remove-item]");
      (items?.[Math.min(index, (items.length ?? 1) - 1)] ?? root.current?.querySelector<HTMLInputElement>("input"))?.focus({ preventScroll: true });
    });
  }

  return <div ref={root}>
    <label className={`${label} mb-1.5`} htmlFor={inputId}>{title}</label>
    <div className="flex gap-2">
      <input id={inputId} className={input} value={draft} onChange={event => { setDraft(event.target.value); setFeedback(""); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder={placeholder} aria-invalid={Boolean(error || feedback)} aria-describedby={error || feedback ? errorId : undefined} />
      <button className="secondary shrink-0 px-3" type="button" disabled={!draft.trim() || values.length >= limit} onClick={add}>Add</button>
    </div>
    {(error || feedback) && <p id={errorId} className="mt-1 text-[10px] font-medium text-[var(--danger-text)]" role={feedback ? "status" : undefined}>{error || feedback}</p>}
    <ul className="mt-2 flex flex-wrap gap-2" aria-label={title}>{values.map((value, index) => <li key={`${value}-${index}`} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] py-1 pl-2.5 pr-1.5 text-[11px] text-[var(--accent-text)]">
      {value}<button type="button" data-remove-item className="rounded-full px-1 font-bold hover:bg-[var(--accent-border)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]" aria-label={`Remove ${value}`} onClick={() => remove(index)}>×</button>
    </li>)}</ul>
  </div>;
}

function RepeatableEntries<T>({ title, entries, empty, onAdd, onRemove, children }: {
  title: string; entries: T[]; empty: T; onAdd: (entry: T) => void; onRemove: (index: number) => void; children: (entry: T, index: number) => ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  function add() {
    onAdd(empty);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>("fieldset:last-of-type input, fieldset:last-of-type textarea")?.focus({ preventScroll: true }));
  }
  function remove(index: number) {
    onRemove(index);
    requestAnimationFrame(() => {
      const buttons = root.current?.querySelectorAll<HTMLButtonElement>("[data-remove-entry]");
      (buttons?.[Math.min(index, (buttons.length ?? 1) - 1)] ?? root.current?.querySelector<HTMLButtonElement>("[data-add-entry]"))?.focus({ preventScroll: true });
    });
  }
  return <div ref={root} className="space-y-3">
    {entries.map((entry, index) => <fieldset key={index} className="rounded-lg border border-[var(--border)] p-3 sm:p-4">
      <legend className="px-1 text-[10px] font-semibold text-[var(--text-muted)]">{title} {index + 1}</legend>
      <div className="grid gap-3 sm:grid-cols-2">{children(entry, index)}</div>
      <button type="button" data-remove-entry className="mt-3 text-[11px] font-semibold text-[var(--danger-text)] underline underline-offset-2" onClick={() => remove(index)}>Remove {title.toLowerCase()}</button>
    </fieldset>)}
    <button type="button" data-add-entry className="secondary" onClick={add}>Add {title.toLowerCase()}</button>
  </div>;
}

export default function CandidateProfilePage() {
  const [profile, setProfile] = useState<CandidateProfileInput>(blankProfile);
  const profileRef = useRef(profile);
  const savingRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeMessage, setResumeMessage] = useState("");
  const [resumePreview, setResumePreview] = useState<{ profile: CandidateProfileInput; contact: { email: string; phone: string }; found: string[]; uncertain: string[] } | null>(null);
  const successTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => { if (successTimer.current !== undefined) window.clearTimeout(successTimer.current); }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${api}/api/profile`, { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not load your profile.");
      const next = candidateProfileSchema.parse(body);
      profileRef.current = next;
      setProfile(next);
      setLoaded(true);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load your profile.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);

  function update<K extends keyof CandidateProfileInput>(key: K, value: CandidateProfileInput[K]) {
    const next = { ...profileRef.current, [key]: value };
    profileRef.current = next;
    setProfile(next);
    setFieldErrors(current => { const updated = { ...current }; delete updated[key]; return updated; });
  }

  function updateEntry<T, K extends keyof T>(list: T[], index: number, key: K, value: T[K], setList: (next: T[]) => void) {
    const collection = list === profileRef.current.education ? "education" : list === profileRef.current.experience ? "experience" : "projects";
    setList(list.map((entry, itemIndex) => itemIndex === index ? { ...entry, [key]: value } : entry));
    const path = `${collection}.${index}.${String(key)}`;
    setFieldErrors(current => { const updated = { ...current }; delete updated[path]; return updated; });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    if (successTimer.current !== undefined) window.clearTimeout(successTimer.current);
    setError(""); setSuccess(false); setFieldErrors({});
    const parsed = candidateProfileSchema.safeParse(profileRef.current);
    if (!parsed.success) {
      const nextErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) nextErrors[issue.path.join(".")] ??= issue.message;
      setFieldErrors(nextErrors);
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus({ preventScroll: true }));
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await saveCandidateProfile(parsed.data, fetch, `${api}/api/profile`);
      profileRef.current = saved;
      setProfile(saved);
      setSuccess(true);
      successTimer.current = window.setTimeout(() => setSuccess(false), 8000);
    } catch (cause) {
      if (cause && typeof cause === "object" && "details" in cause && typeof cause.details === "string" && cause.details) {
        const errors: FieldErrors = {};
        for (const detail of cause.details.split("\n")) { const [path, ...message] = detail.split(": "); errors[path] = message.join(": "); }
        setFieldErrors(errors);
      }
      const message = cause instanceof Error ? cause.message : "Could not save your profile.";
      setError(`${message}${cause && typeof cause === "object" && "details" in cause && cause.details ? " Correct the indicated fields and try again." : " Check the API/database connection and retry."}`);
    } finally { savingRef.current = false; setSaving(false); }
  }

  async function parseResume(file?: File) {
    if (!file) return;
    setResumeBusy(true); setResumeMessage(""); setResumePreview(null);
    try { setResumePreview(await uploadResume(file, fetch, `${api}/api/profile/resume`)); }
    catch (cause) { setResumeMessage(cause instanceof Error ? cause.message : "Could not parse this resume."); }
    finally { setResumeBusy(false); }
  }

  function editResumePreview<K extends keyof CandidateProfileInput>(key: K, value: CandidateProfileInput[K]) {
    setResumePreview(current => current ? { ...current, profile: { ...current.profile, [key]: value } } : current);
  }

  function importResume() {
    if (!resumePreview) return;
    const next = mergeResumeProfile(profileRef.current, resumePreview.profile);
    profileRef.current = next; setProfile(next); setResumePreview(null);
    setResumeMessage("Resume details imported. Review the profile and save when ready.");
  }

  const setEducation = (next: EducationEntry[]) => update("education", next);
  const setExperience = (next: ExperienceEntry[]) => update("experience", next);
  const setProjects = (next: ProjectEntry[]) => update("projects", next);
  const fieldError = (path: string) => fieldErrors[path];

  return <section className="mx-auto w-full max-w-[1176px] px-4 py-7 sm:px-6 md:py-10 lg:px-12">
    <div className="text-[10px] font-bold tracking-[1.15px] text-[var(--text-muted)]">YOUR WORKSPACE</div>
    <div className="mt-2"><h1 className="text-2xl font-bold tracking-tight text-[var(--text)] md:text-[29px]">Candidate profile</h1><p className="mt-1.5 text-xs text-[var(--text-muted)]">Keep your background and job preferences in one place. Fill in only what you want to share.</p></div>
    {error && <div className="alert" role="alert"><span>{error}</span>{!loaded && <button type="button" onClick={() => { setError(""); setLoading(true); setAttempt(value => value + 1); }}>Retry</button>}</div>}
    {success && <p className="mt-4 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-2.5 text-xs font-medium text-[var(--accent-text)]" role="status" aria-live="polite">Profile saved successfully.</p>}
    {loading ? <div className="mt-5 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-5 py-12 text-center text-xs text-[var(--text-secondary)]" role="status">Loading your profile…</div> : loaded && <form className="mt-5 space-y-4" onSubmit={save}>
      <Section title="Basic Details" description="The name and introduction you want associated with your job search.">
        <div className="grid gap-3 sm:grid-cols-2"><TextField title="Full name" value={profile.fullName} onChange={value => update("fullName", value)} maxLength={160} placeholder="Your name" error={fieldError("fullName")} /><TextField title="Professional summary" value={profile.professionalSummary} onChange={value => update("professionalSummary", value)} maxLength={4000} multiline placeholder="A short introduction (optional)" error={fieldError("professionalSummary")} /></div>
      </Section>
      <Section title="Skills" description="Add skills you want to keep with your profile."><TagEditor title="Skills" values={profile.skills} placeholder="e.g. TypeScript" limit={50} error={fieldError("skills")} onChange={values => update("skills", values)} /></Section>
      <Section title="Education & Experience" description="Add any education, roles, or projects you choose to include.">
        <div className="space-y-5">
          <RepeatableEntries title="Education" entries={profile.education} empty={{ institution: "", qualification: "", fieldOfStudy: "", location: "", startDate: "", endDate: "", details: "" }} onAdd={entry => setEducation([...profileRef.current.education, entry])} onRemove={index => setEducation(removeProfileItem(profileRef.current.education, index))}>
            {(entry, index) => <><TextField title="Institution" value={entry.institution} onChange={value => updateEntry(profile.education, index, "institution", value, setEducation)} error={fieldError(`education.${index}.institution`)} /><TextField title="Qualification" value={entry.qualification} onChange={value => updateEntry(profile.education, index, "qualification", value, setEducation)} error={fieldError(`education.${index}.qualification`)} /><TextField title="Field of study" value={entry.fieldOfStudy} onChange={value => updateEntry(profile.education, index, "fieldOfStudy", value, setEducation)} error={fieldError(`education.${index}.fieldOfStudy`)} /><TextField title="Location" value={entry.location} onChange={value => updateEntry(profile.education, index, "location", value, setEducation)} error={fieldError(`education.${index}.location`)} /><TextField title="Start date" value={entry.startDate} onChange={value => updateEntry(profile.education, index, "startDate", value, setEducation)} placeholder="e.g. 2020" error={fieldError(`education.${index}.startDate`)} /><TextField title="End date" value={entry.endDate} onChange={value => updateEntry(profile.education, index, "endDate", value, setEducation)} placeholder="e.g. 2024" error={fieldError(`education.${index}.endDate`)} /><div className="sm:col-span-2"><TextField title="Details" value={entry.details} onChange={value => updateEntry(profile.education, index, "details", value, setEducation)} multiline error={fieldError(`education.${index}.details`)} /></div></>}
          </RepeatableEntries>
          <RepeatableEntries title="Experience" entries={profile.experience} empty={{ company: "", title: "", location: "", startDate: "", endDate: "", current: false, details: "" }} onAdd={entry => setExperience([...profileRef.current.experience, entry])} onRemove={index => setExperience(removeProfileItem(profileRef.current.experience, index))}>
            {(entry, index) => <><TextField title="Company" value={entry.company} onChange={value => updateEntry(profile.experience, index, "company", value, setExperience)} error={fieldError(`experience.${index}.company`)} /><TextField title="Role" value={entry.title} onChange={value => updateEntry(profile.experience, index, "title", value, setExperience)} error={fieldError(`experience.${index}.title`)} /><TextField title="Location" value={entry.location} onChange={value => updateEntry(profile.experience, index, "location", value, setExperience)} error={fieldError(`experience.${index}.location`)} /><div className="grid grid-cols-2 gap-3"><TextField title="Start date" value={entry.startDate} onChange={value => updateEntry(profile.experience, index, "startDate", value, setExperience)} error={fieldError(`experience.${index}.startDate`)} /><TextField title="End date" value={entry.current ? "Present" : entry.endDate} onChange={value => updateEntry(profile.experience, index, "endDate", value, setExperience)} error={fieldError(`experience.${index}.endDate`)} /></div><label className="flex items-center gap-2 self-end pb-2 text-[11px] text-[var(--text-secondary)]"><input type="checkbox" checked={entry.current} onChange={event => updateEntry(profile.experience, index, "current", event.target.checked, setExperience)} /> Current role</label><div className="sm:col-span-2"><TextField title="Details" value={entry.details} onChange={value => updateEntry(profile.experience, index, "details", value, setExperience)} multiline error={fieldError(`experience.${index}.details`)} /></div></>}
          </RepeatableEntries>
          <RepeatableEntries title="Project" entries={profile.projects} empty={{ name: "", url: "", technologies: [], details: "" }} onAdd={entry => setProjects([...profileRef.current.projects, entry])} onRemove={index => setProjects(removeProfileItem(profileRef.current.projects, index))}>
            {(entry, index) => <><TextField title="Project name" value={entry.name} onChange={value => updateEntry(profile.projects, index, "name", value, setProjects)} error={fieldError(`projects.${index}.name`)} /><TextField title="Project URL" value={entry.url} onChange={value => updateEntry(profile.projects, index, "url", value, setProjects)} placeholder="https://…" error={fieldError(`projects.${index}.url`)} /><div className="sm:col-span-2"><TagEditor title="Project technologies" values={entry.technologies} placeholder="Add a technology" limit={30} error={fieldError(`projects.${index}.technologies`)} onChange={values => updateEntry(profile.projects, index, "technologies", values, setProjects)} /></div><div className="sm:col-span-2"><TextField title="Details" value={entry.details} onChange={value => updateEntry(profile.projects, index, "details", value, setProjects)} multiline error={fieldError(`projects.${index}.details`)} /></div></>}
          </RepeatableEntries>
        </div>
      </Section>
      <Section title="Target Roles & Locations" description="Describe the jobs and places you prefer.">
        <div className="space-y-4"><TagEditor title="Target job titles" values={profile.targetJobTitles} placeholder="e.g. Product Designer" limit={30} error={fieldError("targetJobTitles")} onChange={values => update("targetJobTitles", values)} /><TagEditor title="Preferred countries" values={profile.preferredCountries} placeholder="e.g. Canada" limit={30} error={fieldError("preferredCountries")} onChange={values => update("preferredCountries", values)} /><TagEditor title="Preferred locations" values={profile.preferredLocations} placeholder="e.g. Toronto" limit={50} error={fieldError("preferredLocations")} onChange={values => update("preferredLocations", values)} /></div>
      </Section>
      <Section title="Work Preferences" description="Set the work arrangements and minimum compensation you prefer.">
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset><legend className={`${label} mb-2`}>Work arrangements</legend><div className="flex flex-wrap gap-x-4 gap-y-2">{(["remote", "hybrid", "onsite"] as const).map(value => <label key={value} className="flex items-center gap-2 text-xs capitalize text-[var(--text-secondary)]"><input className="h-4 w-4 accent-[var(--accent)]" type="checkbox" checked={profile.workArrangements.includes(value)} onChange={event => update("workArrangements", event.target.checked ? [...profileRef.current.workArrangements, value] : profileRef.current.workArrangements.filter(item => item !== value))} />{value}</label>)}</div></fieldset>
          <TextField title="Minimum salary (optional)" inputType="number" min={0} step={1} value={profile.minimumSalary === null ? "" : String(profile.minimumSalary)} onChange={value => update("minimumSalary", value === "" ? null : Number(value))} placeholder="Amount in your preferred currency" error={fieldError("minimumSalary")} />
          <div className="sm:col-span-2"><TextField title="Work authorization details (optional)" value={profile.workAuthorization} onChange={value => update("workAuthorization", value)} maxLength={2000} multiline placeholder="Add only details you are comfortable storing locally." error={fieldError("workAuthorization")} /></div>
        </div>
      </Section>
      <Section title="Resume" description="Upload a PDF or DOCX to preview extracted details. Nothing is imported until you confirm.">
        <label className={label}>Resume file (PDF or DOCX, up to 5 MB)<input className={`${input} file:mr-3 file:rounded file:border-0 file:bg-[var(--accent-soft)] file:px-3 file:py-1 file:text-[var(--accent-text)]`} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={resumeBusy} onChange={event => { void parseResume(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>
        {resumeBusy && <p className="mt-3 text-xs text-[var(--text-secondary)]" role="status">Uploading and parsing resume…</p>}
        {resumeMessage && <p className="mt-3 text-xs text-[var(--text-secondary)]" role="status">{resumeMessage}</p>}
        {resumePreview && <div className="mt-4 space-y-3 rounded-lg border border-[var(--border)] p-3 sm:p-4">
          <div><h3 className="text-xs font-bold">Review extracted details</h3><p className="mt-1 text-[11px] text-[var(--text-muted)]">Edit anything that needs correction. Existing profile entries are preserved when imported.</p></div>
          <p className="text-[11px] text-[var(--text-secondary)]"><strong>Found:</strong> {resumePreview.found.join(", ") || "No fields"}</p>
          {(resumePreview.contact.email || resumePreview.contact.phone) && <p className="text-[11px] text-[var(--text-secondary)]"><strong>Detected contact:</strong> {[resumePreview.contact.email, resumePreview.contact.phone].filter(Boolean).join(" · ")} (contact fields aren’t part of the saved profile yet)</p>}
          {!!resumePreview.uncertain.length && <p className="text-[11px] text-[var(--text-secondary)]"><strong>Not found or uncertain:</strong> {resumePreview.uncertain.join(", ")}</p>}
          <TextField title="Full name" value={resumePreview.profile.fullName} onChange={value => editResumePreview("fullName", value)} />
          <TextField title="Professional summary" value={resumePreview.profile.professionalSummary} onChange={value => editResumePreview("professionalSummary", value)} multiline />
          <TextField title="Skills (one per line)" value={resumePreview.profile.skills.join("\n")} onChange={value => editResumePreview("skills", value.split("\n").map(item => item.trim()).filter(Boolean).slice(0, 50))} multiline />
          {(["education", "experience", "projects"] as const).map(key => <TextField key={key} title={`${key[0]?.toUpperCase()}${key.slice(1)} (editable JSON)`} value={JSON.stringify(resumePreview.profile[key], null, 2)} onChange={value => { try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) editResumePreview(key, parsed as never); } catch { /* Retain the last valid preview while JSON is edited. */ } }} multiline />)}
          <TextField title="Full extracted resume text" value={resumePreview.profile.resumeText} onChange={value => editResumePreview("resumeText", value)} maxLength={100000} multiline />
          <button className="primary" type="button" onClick={importResume}>Import to profile</button>
        </div>}
        <div className="mt-4"><TextField title="Resume text (optional)" value={profile.resumeText} onChange={value => update("resumeText", value)} maxLength={100000} multiline placeholder="Paste resume text here…" error={fieldError("resumeText")} /></div>
      </Section>
      <div className="flex flex-col-reverse gap-3 pb-4 sm:flex-row sm:items-center sm:justify-end"><p className="mr-auto text-[10px] text-[var(--text-muted)]">Optional fields can be left blank. Your profile is stored in this app’s database.</p><button className="primary min-w-32" type="submit" disabled={saving || loading}>{saving ? "Saving…" : "Save profile"}</button></div>
    </form>}
    <footer className="mt-4 flex flex-col justify-between gap-3 py-5 text-[10px] text-[var(--text-faint)] sm:flex-row"><span>Your information stays in your ApplyPilot workspace.</span><span>ApplyPilot AI <b>|</b> Made for the next move</span></footer>
  </section>;
}
