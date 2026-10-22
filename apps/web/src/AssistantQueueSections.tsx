import { useEffect, useState, type FormEvent } from "react";
import { requestAssistantApi } from "./assistantClient.js";
import type { Approval, AssistantStatus, DiscoveryRun, EmailDraft, Opportunity, Preparation } from "./assistantTypes.js";

export type RunAssistantAction = (
  actionKey: string,
  operation: () => Promise<unknown>,
  successMessage: string
) => Promise<void>;

const secondaryButton = "secondary text-[10px]";

function statusLabel(status: AssistantStatus | DiscoveryRun["status"]): string {
  const labels: Record<AssistantStatus | DiscoveryRun["status"], string> = {
    needs_review: "Needs review",
    approved: "Approved",
    completed: "Completed",
    failed: "Failed",
    skipped: "Skipped",
    running: "Running"
  };
  return labels[status];
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Not run yet";
}

function getRoleLevelBadge(title: string) {
  const lower = title.toLowerCase();
  if (lower.includes("intern") || lower.includes("co-op")) {
    return <span className="inline-block rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-300">Internship</span>;
  }
  if (lower.includes("graduate") || lower.includes("new grad")) {
    return <span className="inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-[9px] font-semibold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">Graduate</span>;
  }
  if (lower.includes("junior") || lower.includes("entry") || lower.includes("associate")) {
    return <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Entry-level</span>;
  }
  if (lower.includes("director") || lower.includes("vp") || lower.includes("head of") || lower.includes("chief")) {
    return <span className="inline-block rounded-full bg-purple-100 px-2 py-0.5 text-[9px] font-semibold text-purple-800 dark:bg-purple-950 dark:text-purple-300">Executive</span>;
  }
  if (lower.includes("senior") || lower.includes("lead") || lower.includes("principal") || lower.includes("staff")) {
    return <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">Senior</span>;
  }
  return null;
}

function ContactBadge({ status }: { status?: string }) {
  if (status === "verified_published") {
    return <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Verified Recruiter Contact</span>;
  }
  if (status === "public_listed") {
    return <span className="inline-block rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-300">Public Company Route</span>;
  }
  if (status === "inferred_requires_verification") {
    return <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">Inferred (Requires Verification)</span>;
  }
  return <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">No Direct Contact Found</span>;
}

function OpportunityCard({
  opportunity,
  busy,
  onOpenProfile,
  onAction
}: {
  opportunity: Opportunity;
  busy: boolean;
  onOpenProfile: () => void;
  onAction: RunAssistantAction;
}) {
  const [draftFormOpen, setDraftFormOpen] = useState(false);
  const [recipientAddress, setRecipientAddress] = useState("");
  const [recipientProvenance, setRecipientProvenance] = useState("");
  const [contactInfo, setContactInfo] = useState<{ email?: string | null; verificationStatus?: string } | null>(null);

  useEffect(() => {
    let active = true;
    void requestAssistantApi(`/api/job-opportunities/${opportunity.id}/recruiter-contact`)
      .then(data => {
        if (active && data && typeof data === "object") {
          setContactInfo(data as { email?: string | null; verificationStatus?: string });
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [opportunity.id]);

  function createEmailDraft(event?: FormEvent<HTMLFormElement>) {
    if (event) event.preventDefault();
    void onAction(
      `email-${opportunity.id}`,
      () => requestAssistantApi("/api/recruiter-email-drafts", {
        method: "POST",
        body: JSON.stringify({
          opportunityId: opportunity.id,
          recipientAddress: recipientAddress.trim() || undefined,
          recipientProvenance: recipientProvenance.trim() || undefined
        })
      }),
      "Recruiter outreach draft created autonomously for review."
    );
  }

  return (
    <article className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-soft)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-[var(--text-muted)]">
            {opportunity.sourceAttribution || opportunity.source}
            {" · "}{opportunity.country || "Country unknown"}
            {" · "}{statusLabel(opportunity.reviewStatus)}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <h3 className="text-sm font-bold text-[var(--text)]">{opportunity.title}</h3>
            {getRoleLevelBadge(opportunity.title)}
            <ContactBadge status={contactInfo?.verificationStatus} />
          </div>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {opportunity.company}
            {" · "}{opportunity.location || "Location unknown"}
            {" · "}{opportunity.workArrangement || "Work arrangement unknown"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {opportunity.matchScore !== null && (
            <span className="inline-block rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-bold text-[var(--accent-text)]">
              {opportunity.matchScore}% match
            </span>
          )}
          <a
            className="mt-1.5 block text-[10px] font-semibold text-[var(--accent-text)] underline"
            href={opportunity.jobUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Original listing ↗
          </a>
        </div>
      </div>

      {opportunity.matchedEvidence.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-semibold text-emerald-800 dark:text-emerald-300">Verified Evidence Matches</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {opportunity.matchedEvidence.slice(0, 6).map((item, index) => (
              <span key={index} className="rounded bg-emerald-50 px-2 py-0.5 text-[9px] text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                ✓ {item}
              </span>
            ))}
          </div>
        </div>
      )}

      {opportunity.missingRequirements.length > 0 && (
        <div className="mt-2">
          <p className="text-[10px] font-semibold text-amber-800 dark:text-amber-300">Missing / Unverified Requirements</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {opportunity.missingRequirements.slice(0, 4).map((item, index) => (
              <span key={index} className="rounded bg-amber-50 px-2 py-0.5 text-[9px] text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                △ {item}
              </span>
            ))}
          </div>
        </div>
      )}

      {opportunity.explanation.length > 0 && (
        <p className="mt-2 text-[10px] italic text-[var(--text-muted)]">
          {opportunity.explanation[0]}
        </p>
      )}

      {opportunity.reviewStatus === "needs_review" && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
          <button
            className="primary text-[10px]"
            disabled={busy}
            onClick={() => void onAction(
              `prepare-${opportunity.id}`,
              () => requestAssistantApi("/api/application-preparations", {
                method: "POST",
                body: JSON.stringify({ opportunityId: opportunity.id })
              }),
              "Application materials queued for preparation."
            )}
          >
            Prepare application
          </button>
          <button
            className={secondaryButton}
            disabled={busy}
            onClick={() => createEmailDraft()}
          >
            Autonomous recruiter outreach
          </button>
          <button
            className="text-[10px] text-[var(--text-muted)] underline hover:text-[var(--text)]"
            type="button"
            onClick={() => setDraftFormOpen(!draftFormOpen)}
          >
            {draftFormOpen ? "Hide recipient override" : "Custom recipient override"}
          </button>
          <button
            className={secondaryButton}
            disabled={busy}
            onClick={() => void onAction(
              `skip-${opportunity.id}`,
              () => requestAssistantApi(`/api/job-opportunities/${opportunity.id}/review`, {
                method: "POST",
                body: JSON.stringify({ decision: "skipped" })
              }),
              "Opportunity skipped."
            )}
          >
            Skip
          </button>
        </div>
      )}

      {draftFormOpen && (
        <form
          className="mt-3 grid gap-2 rounded-lg border border-[var(--border)] p-3"
          onSubmit={createEmailDraft}
        >
          <p className="text-[10px] text-[var(--text-muted)]">
            Recipient contacts are autonomously discovered from job postings and company careers routes. You can optionally override or provide a direct contact below.
          </p>
          <label className="text-[10px] text-[var(--text-secondary)]">
            Recruiter email address (optional override)
            <input
              className="mt-1 w-full"
              type="email"
              maxLength={320}
              placeholder="e.g. recruiter@company.com"
              value={recipientAddress}
              onChange={event => setRecipientAddress(event.target.value)}
            />
          </label>
          <label className="text-[10px] text-[var(--text-secondary)]">
            Address provenance
            <input
              className="mt-1 w-full"
              required
              maxLength={1000}
              placeholder="Where you found this address"
              value={recipientProvenance}
              onChange={event => setRecipientProvenance(event.target.value)}
            />
          </label>
          <button className="primary justify-self-start text-[10px]" disabled={busy}>
            {busy ? "Creating draft…" : "Create draft"}
          </button>
        </form>
      )}
      {!opportunity.matchedEvidence.length && !opportunity.missingRequirements.length && (
        <button className="mt-3 text-[10px] font-semibold text-[var(--accent-text)] underline" onClick={onOpenProfile}>
          Review your candidate profile
        </button>
      )}
    </article>
  );
}

export function OpportunityQueue({
  opportunities,
  busy,
  onOpenProfile,
  onAction
}: {
  opportunities: Opportunity[];
  busy: boolean;
  onOpenProfile: () => void;
  onAction: RunAssistantAction;
}) {
  const [recFilter, setRecFilter] = useState<string>("all");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const sources = [...new Set(opportunities.map(o => o.source))];

  const filtered = opportunities.filter(op => {
    if (recFilter !== "all" && op.recommendation !== recFilter) return false;
    if (sourceFilter !== "all" && op.source !== sourceFilter) return false;
    if (statusFilter !== "all" && op.reviewStatus !== statusFilter) return false;
    if (levelFilter === "internship" && !op.title.toLowerCase().includes("intern")) return false;
    if (levelFilter === "graduate" && !op.title.toLowerCase().includes("grad")) return false;
    if (levelFilter === "entry_level" && !/junior|entry|associate/i.test(op.title)) return false;
    if (levelFilter === "senior" && !/senior|lead|principal|staff|director|vp/i.test(op.title)) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const text = `${op.title} ${op.company} ${op.location} ${op.country ?? ""}`.toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  });

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-[var(--text)]">Curated review queue</h2>
        <span className="text-[10px] text-[var(--text-muted)]">
          Showing {filtered.length} of {opportunities.length} opportunities
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5">
        <input
          type="text"
          className="min-h-8 flex-1 rounded border border-[var(--border-strong)] bg-transparent px-2.5 py-1 text-xs text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none"
          placeholder="Filter by title, company, or location…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        <select
          className="min-h-8 rounded border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text)]"
          value={recFilter}
          onChange={e => setRecFilter(e.target.value)}
        >
          <option value="all">All recommendations</option>
          <option value="strong_match">Strong match</option>
          <option value="potential_match">Potential match</option>
          <option value="low_match">Low match</option>
        </select>
        <select
          className="min-h-8 rounded border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text)]"
          value={levelFilter}
          onChange={e => setLevelFilter(e.target.value)}
        >
          <option value="all">All role levels</option>
          <option value="internship">Internships & Co-ops</option>
          <option value="graduate">Graduate & New Grad</option>
          <option value="entry_level">Entry-level & Junior</option>
          <option value="senior">Senior & Lead</option>
        </select>
        {sources.length > 1 && (
          <select
            className="min-h-8 rounded border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text)] capitalize"
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value)}
          >
            <option value="all">All sources</option>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <select
          className="min-h-8 rounded border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text)]"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="all">All review states</option>
          <option value="needs_review">Needs review</option>
          <option value="approved">Worth applying</option>
          <option value="skipped">Skipped</option>
        </select>
      </div>

      {opportunities.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-8 text-center text-xs text-[var(--text-secondary)]">
          No opportunities are queued. Run discovery after completing your profile.{" "}
          <button className="font-bold text-[var(--accent-text)] underline" onClick={onOpenProfile}>
            Open profile
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-6 text-center text-xs text-[var(--text-secondary)]">
          No opportunities match your selected filters.{" "}
          <button
            className="font-bold text-[var(--accent-text)] underline"
            onClick={() => {
              setRecFilter("all");
              setLevelFilter("all");
              setSourceFilter("all");
              setStatusFilter("all");
              setSearchQuery("");
            }}
          >
            Reset filters
          </button>
        </div>
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {filtered.map(opportunity => (
            <OpportunityCard
              key={opportunity.id}
              opportunity={opportunity}
              busy={busy}
              onOpenProfile={onOpenProfile}
              onAction={onAction}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function PreparationQueue({
  preparations,
  busy,
  onAction
}: {
  preparations: Preparation[];
  busy: boolean;
  onAction: RunAssistantAction;
}) {
  const [fillingTaskId, setFillingTaskId] = useState<string | null>(null);
  const [fillResult, setFillResult] = useState<any>(null);
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [explicitlyApproved, setExplicitlyApproved] = useState<boolean>(false);
  const [submissionReceipt, setSubmissionReceipt] = useState<any>(null);

  async function handleAutoFillForm(task: Preparation) {
    setFillingTaskId(task.id);
    setFillResult(null);
    setSubmissionReceipt(null);
    try {
      const result = await requestAssistantApi(`/api/application-preparations/${task.id}/fill-form`, {
        method: "POST",
        body: JSON.stringify({ answers: userAnswers })
      });
      setFillResult(result);
    } catch (err) {
      setFillResult({ status: "failed", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleSubmitApplication(task: Preparation) {
    if (!explicitlyApproved) {
      alert("Please confirm explicit candidate approval before submitting.");
      return;
    }
    setSubmissionReceipt(null);
    void onAction(
      `submit-application-${task.id}`,
      async () => {
        const result = await requestAssistantApi(`/api/application-preparations/${task.id}/execute-submit`, {
          method: "POST",
          body: JSON.stringify({
            userExplicitlyApproved: true,
            answers: userAnswers
          })
        });
        setSubmissionReceipt(result);
        return result;
      },
      "Application submitted and receipt verified by employer portal."
    );
  }

  return (
    <section>
      <h2 className="text-base font-bold text-[var(--text)]">Application preparation & browser execution</h2>
      <p className="mt-1 text-[10px] text-[var(--text-muted)]">
        Autonomous Playwright form automation. Form fields are inspected and populated from verified candidate facts. Final submission strictly requires your explicit approval.
      </p>
      <div className="mt-3 space-y-3">
        {preparations.length === 0 ? (
          <EmptyQueue message="No preparation tasks queued." />
        ) : preparations.map(task => (
          <article key={task.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-soft)]">
            <QueueHeading title={`${task.opportunity.title} · ${task.opportunity.company}`} status={task.status} />

            <div className="mt-2 text-[10px] text-[var(--text-secondary)]">
              <span className="font-semibold">Portal:</span> {task.opportunity.jobUrl}
            </div>

            {task.unansweredQuestions.length > 0 && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/50 p-2 text-[10px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                <span className="font-bold">Pending candidate questions:</span>
                <ul className="mt-1 list-inside list-disc">
                  {task.unansweredQuestions.map((q, idx) => <li key={idx}>{q}</li>)}
                </ul>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="primary text-[10px]"
                disabled={busy}
                onClick={() => handleAutoFillForm(task)}
              >
                Auto-fill form in browser (Playwright)
              </button>

              {task.status === "needs_review" && (
                <>
                  <button
                    className={secondaryButton}
                    disabled={busy}
                    onClick={() => void onAction(
                      `approve-preparation-${task.id}`,
                      () => requestAssistantApi(`/api/application-preparations/${task.id}/approve`, { method: "POST" }),
                      "Application preparation approved."
                    )}
                  >
                    Approve materials
                  </button>
                  <button
                    className={secondaryButton}
                    disabled={busy}
                    onClick={() => void onAction(
                      `skip-preparation-${task.id}`,
                      () => requestAssistantApi(`/api/application-preparations/${task.id}/skip`, { method: "POST" }),
                      "Task skipped."
                    )}
                  >
                    Skip
                  </button>
                </>
              )}
            </div>

            {/* In-place Form Inspection and Playwright Execution Modal / Drawer */}
            {fillingTaskId === task.id && fillResult && (
              <div className="mt-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-elevated)] p-3 text-[10px]">
                <h4 className="font-bold text-xs text-[var(--text)]">Playwright Browser Inspection & Fill Status</h4>
                <p className="mt-1 text-[var(--text-secondary)]">{fillResult.message}</p>

                {fillResult.botProtectionDetected && (
                  <div className="mt-2 rounded bg-amber-100 p-2 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    <strong>Human Action Needed:</strong> {fillResult.handoffReason}
                    <div className="mt-1">
                      <a href={task.opportunity.jobUrl} target="_blank" rel="noopener noreferrer" className="font-bold underline">
                        Open Portal Directly in Browser ↗
                      </a>
                    </div>
                  </div>
                )}

                {fillResult.fieldsFilled?.length > 0 && (
                  <div className="mt-2">
                    <p className="font-semibold text-emerald-800 dark:text-emerald-300">Populated Form Fields:</p>
                    <div className="mt-1 grid grid-cols-2 gap-1">
                      {fillResult.fieldsFilled.map((f: any, idx: number) => (
                        <div key={idx} className="rounded bg-[var(--surface)] p-1 border border-[var(--border)]">
                          <span className="font-semibold">{f.label}:</span> {f.value}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {fillResult.unansweredSensitiveQuestions?.length > 0 && (
                  <div className="mt-2">
                    <p className="font-semibold text-amber-800 dark:text-amber-300">Sensitive / Consequential Questions:</p>
                    <div className="mt-1 space-y-1">
                      {fillResult.unansweredSensitiveQuestions.map((q: any, idx: number) => (
                        <label key={idx} className="block text-[10px]">
                          {q.prompt}
                          <input
                            type="text"
                            className="mt-0.5 w-full rounded border border-[var(--border)] bg-transparent px-2 py-0.5 text-xs"
                            placeholder="Your confirmed response..."
                            value={userAnswers[q.fieldId] || ""}
                            onChange={e => setUserAnswers({ ...userAnswers, [q.fieldId]: e.target.value })}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Explicit Approval Submission Gate */}
                <div className="mt-3 border-t border-[var(--border)] pt-2">
                  <label className="flex items-center gap-1.5 cursor-pointer font-semibold text-[var(--text)]">
                    <input
                      type="checkbox"
                      checked={explicitlyApproved}
                      onChange={e => setExplicitlyApproved(e.target.checked)}
                    />
                    I have reviewed my verified answers and explicitly approve submitting this application.
                  </label>

                  <div className="mt-2 flex gap-2">
                    <button
                      className="primary text-[10px]"
                      disabled={busy || !explicitlyApproved}
                      onClick={() => handleSubmitApplication(task)}
                    >
                      {busy ? "Submitting…" : "Confirm & Submit Application"}
                    </button>
                    <button
                      className={secondaryButton}
                      onClick={() => setFillingTaskId(null)}
                    >
                      Close inspector
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Submission Receipt Display */}
            {submissionReceipt && (
              <div className="mt-3 rounded-lg border border-emerald-500 bg-emerald-50/80 p-3 text-[10px] text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                <p className="font-bold text-xs">Submission Confirmed!</p>
                <p className="mt-0.5">{submissionReceipt.message}</p>
                {submissionReceipt.submissionOutcome?.confirmationId && (
                  <p className="mt-1 font-mono text-[9px]">Receipt ID: {submissionReceipt.submissionOutcome.confirmationId}</p>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

export function EmailDraftQueue({
  drafts,
  busy,
  onAction
}: {
  drafts: EmailDraft[];
  busy: boolean;
  onAction: RunAssistantAction;
}) {
  return (
    <section>
      <h2 className="text-base font-bold text-[var(--text)]">Recruiter outreach & email dispatch</h2>
      <p className="mt-1 text-[10px] text-[var(--text-muted)]">
        Recruiter contacts are discovered from official listings and verified company channels. Approved drafts can be dispatched through your authorized email integration or copied directly.
      </p>
      <div className="mt-3 space-y-3">
        {drafts.length === 0 ? (
          <EmptyQueue message="No recruiter drafts queued." />
        ) : drafts.map(draft => (
          <EmailDraftCard key={draft.id} draft={draft} busy={busy} onAction={onAction} />
        ))}
      </div>
    </section>
  );
}

function EmailDraftCard({ draft, busy, onAction }: { draft: EmailDraft; busy: boolean; onAction: RunAssistantAction }) {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [sendStatus, setSendStatus] = useState<any>(null);

  useEffect(() => {
    setSubject(draft.subject);
    setBody(draft.body);
  }, [draft.subject, draft.body]);

  const reviewable = draft.status === "needs_review";

  function copyToClipboard() {
    const text = `To: ${draft.recipientAddress || ""}\nSubject: ${subject}\n\n${body}`;
    void navigator.clipboard.writeText(text);
    alert("Outreach message copied to clipboard!");
  }

  async function handleSendEmail() {
    setSendStatus(null);
    void onAction(
      `send-draft-${draft.id}`,
      async () => {
        const result = await requestAssistantApi(`/api/recruiter-email-drafts/${draft.id}/dispatch`, {
          method: "POST",
          body: JSON.stringify({ userExplicitlyApproved: true })
        });
        setSendStatus(result);
        return result;
      },
      "Email dispatch request submitted."
    );
  }

  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-soft)]">
      <QueueHeading title={`${draft.opportunity.title} · ${draft.opportunity.company}`} status={draft.status} />
      <p className="mt-2 break-all text-[10px] text-[var(--text-secondary)]">
        To: <span className="font-semibold text-[var(--text)]">{draft.recipientAddress || "No address"}</span>
        {" · "}
        <span className={draft.recipientVerified ? "text-emerald-700 font-bold" : "text-amber-700"}>
          {draft.recipientVerified ? "Verified recipient" : "Unverified"}
        </span>
        {" · "}{draft.recipientProvenance}
      </p>

      <label className="mt-3 block text-[10px] text-[var(--text-secondary)]">
        Subject
        <input
          className="mt-1 w-full"
          maxLength={300}
          value={subject}
          disabled={!reviewable}
          onChange={event => setSubject(event.target.value)}
        />
      </label>
      <label className="mt-2 block text-[10px] text-[var(--text-secondary)]">
        Draft
        <textarea
          className="mt-1 w-full font-mono text-[11px]"
          rows={6}
          maxLength={10000}
          value={body}
          disabled={!reviewable}
          onChange={event => setBody(event.target.value)}
        />
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        {reviewable && (
          <>
            <button
              className={secondaryButton}
              disabled={busy}
              onClick={() => void onAction(
                `edit-draft-${draft.id}`,
                () => requestAssistantApi(`/api/recruiter-email-drafts/${draft.id}`, {
                  method: "PUT",
                  body: JSON.stringify({ subject, body })
                }),
                "Draft changes saved."
              )}
            >
              Save edits
            </button>
            {!draft.recipientVerified && (
              <button
                className={secondaryButton}
                disabled={busy}
                onClick={() => void onAction(
                  `verify-recipient-${draft.id}`,
                  () => requestAssistantApi(`/api/recruiter-email-drafts/${draft.id}/verify-recipient`, { method: "POST" }),
                  "Recipient verified."
                )}
              >
                Mark recipient verified
              </button>
            )}
            <button
              className="primary text-[10px]"
              disabled={busy}
              onClick={() => void onAction(
                `approve-draft-${draft.id}`,
                () => requestAssistantApi(`/api/recruiter-email-drafts/${draft.id}/approve`, { method: "POST" }),
                "Draft approved."
              )}
            >
              Approve draft
            </button>
          </>
        )}

        {draft.status === "approved" && (
          <button
            className="primary text-[10px]"
            disabled={busy}
            onClick={handleSendEmail}
          >
            Send email via integration
          </button>
        )}

        <button
          className={secondaryButton}
          onClick={copyToClipboard}
        >
          Copy to clipboard
        </button>
      </div>

      {sendStatus && (
        <div className={`mt-3 rounded-lg p-2.5 text-[10px] ${sendStatus.success
          ? "bg-emerald-50 text-emerald-900 border border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200"
          : "bg-amber-50 text-amber-900 border border-amber-300 dark:bg-amber-950/40 dark:text-amber-200"}`}
        >
          <strong>{sendStatus.success ? "Dispatched:" : "Dispatch Status:"}</strong> {sendStatus.message}
        </div>
      )}
    </article>
  );
}

export function ActionHistory({ actions }: { actions: Approval[] }) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-bold text-[var(--text)]">Approval and outcome history</h2>
      <div className="mt-3 space-y-2">
        {actions.length === 0 ? (
          <EmptyQueue message="No actions have been approved or recorded yet." />
        ) : actions.map(action => (
          <div key={action.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-[10px]">
            <span className="font-semibold text-[var(--text)]">{action.actionType.replaceAll("_", " ")}</span>
            <span className="text-[var(--text-secondary)]">
              {statusLabel(action.status)} · {action.approvedBy} · {formatDate(action.approvedAt)}
            </span>
            {action.outcome && <span className="text-[var(--text-muted)]">{action.outcome}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

export function DiscoveryHistory({ runs }: { runs: DiscoveryRun[] }) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-bold text-[var(--text)]">Discovery run history</h2>
      <div className="mt-3 space-y-2">
        {runs.length === 0 ? (
          <EmptyQueue message="No discovery runs recorded." />
        ) : runs.map(run => (
          <details key={run.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
            <summary className="cursor-pointer text-xs text-[var(--text)]">
              {formatDate(run.startedAt)} · {statusLabel(run.status)} · {run.newCount} new / {run.discoveredCount} evaluated {run.rejectedCount > 0 ? `(${run.rejectedCount} filtered out)` : ""}
            </summary>
            {run.rejectedCount > 0 && run.rejectionReasons && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className="font-semibold text-[var(--text-secondary)]">Eligibility filters applied:</span>
                {Object.entries(run.rejectionReasons).map(([category, count]) => (
                  <span key={category} className="rounded bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    {category.replaceAll("_", " ")}: {count}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {run.sourceResults.map(source => (
                <span
                  key={source.id}
                  className={`rounded-full px-2 py-1 text-[10px] ${source.status === "error"
                    ? "bg-red-500/10 text-red-600 dark:text-red-300"
                    : "bg-[var(--accent-soft)] text-[var(--accent-text)]"}`}
                >
                  {source.name}: {source.status} ({source.fetched})
                  {source.message ? ` · ${source.message}` : ""}
                </span>
              ))}
            </div>
            {run.errorMessage && <p className="mt-2 text-[10px] text-red-600 dark:text-red-300">{run.errorMessage}</p>}
          </details>
        ))}
      </div>
    </section>
  );
}

function QueueHeading({ title, status }: { title: string; status: AssistantStatus }) {
  return (
    <div className="flex justify-between gap-2">
      <strong className="text-xs text-[var(--text)]">{title}</strong>
      <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{statusLabel(status)}</span>
    </div>
  );
}

function EmptyQueue({ message }: { message: string }) {
  return (
    <p className="rounded-xl border border-dashed border-[var(--border-strong)] p-5 text-xs text-[var(--text-muted)]">
      {message}
    </p>
  );
}
