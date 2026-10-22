import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon.js";
import { loadAssistantDashboard, requestAssistantApi } from "./assistantClient.js";
import {
  ActionHistory,
  DiscoveryHistory,
  EmailDraftQueue,
  OpportunityQueue,
  PreparationQueue,
  type RunAssistantAction
} from "./AssistantQueueSections.js";
import type { AssistantDashboard } from "./assistantTypes.js";

export default function AssistantDashboardPage({ onOpenProfile }: { onOpenProfile: () => void }) {
  const [dashboard, setDashboard] = useState<AssistantDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeAction, setActiveAction] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const loadDashboard = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      setDashboard(await loadAssistantDashboard());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not load the assistant dashboard.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const runAction: RunAssistantAction = async (actionKey, operation, message) => {
    setActiveAction(actionKey);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await operation();
      setSuccessMessage(message);
      await loadDashboard();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "The request could not be completed.");
    } finally {
      setActiveAction("");
    }
  };

  return (
    <section className="mx-auto w-full max-w-[1176px] px-4 py-7 sm:px-6 md:py-10 lg:px-12">
      <div className="text-[10px] font-bold tracking-[1.15px] text-[var(--text-muted)]">
        YOUR JOB SEARCH
      </div>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)] md:text-[29px]">
            Review queue
          </h1>
          <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-[var(--text-muted)]">
            Prioritize opportunities, review preparation tasks and edit recruiter drafts. Queueing or approving never submits an application or sends an email.
          </p>
        </div>
        <button
          className="primary"
          type="button"
          disabled={Boolean(activeAction) || isLoading}
          onClick={() => void runAction(
            "discovery-run",
            () => requestAssistantApi("/api/discovery/run-once", { method: "POST" }),
            "Discovery run finished."
          )}
        >
          <Icon name="sparkles" className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" />
          {activeAction === "discovery-run" ? "Discovering…" : "Run discovery once"}
        </button>
      </div>

      {dashboard && <DashboardSummary dashboard={dashboard} />}
      {errorMessage && (
        <div className="alert mt-4" role="alert">
          <span>{errorMessage}</span>
          <button type="button" onClick={() => void loadDashboard()}>Retry</button>
        </div>
      )}
      {successMessage && (
        <p className="mt-3 rounded-lg bg-[var(--accent-soft)] p-3 text-xs text-[var(--accent-text)]" role="status">
          {successMessage}
        </p>
      )}
      {isLoading && (
        <div
          className="mt-5 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-5 py-12 text-center text-xs text-[var(--text-secondary)]"
          role="status"
        >
          Loading review queues…
        </div>
      )}
      {!isLoading && dashboard && (
        <>
          <QueueCounts dashboard={dashboard} />
          <OpportunityQueue
            opportunities={dashboard.opportunities}
            busy={Boolean(activeAction)}
            onOpenProfile={onOpenProfile}
            onAction={runAction}
          />
          <ActionHistory actions={dashboard.actions} />
          <div className="mt-8 grid gap-6 xl:grid-cols-2">
            <PreparationQueue
              preparations={dashboard.preparations}
              busy={Boolean(activeAction)}
              onAction={runAction}
            />
            <EmailDraftQueue
              drafts={dashboard.emailDrafts}
              busy={Boolean(activeAction)}
              onAction={runAction}
            />
          </div>
          <DiscoveryHistory runs={dashboard.runs} />
        </>
      )}
      <footer className="mt-8 py-4 text-[10px] text-[var(--text-faint)]">
        Approvals are recorded locally. No browser submission or email service is connected.
      </footer>
    </section>
  );
}

function DashboardSummary({ dashboard }: { dashboard: AssistantDashboard }) {
  const lastRun = dashboard.runs[0];
  const lastRunTime = lastRun?.finishedAt ?? lastRun?.startedAt ?? null;
  const schedulerActive = dashboard.scheduler.enabled || dashboard.scheduler.status === "scheduled" || dashboard.scheduler.status === "running";

  return (
    <div className="mt-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-secondary)]">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-medium ${schedulerActive ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" : "border-[var(--border)]"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${schedulerActive ? "bg-emerald-500 animate-pulse" : "bg-gray-400"}`} />
          Scheduler: {dashboard.scheduler.status === "running" ? "Running now…" : schedulerActive ? `Active (every ${dashboard.scheduler.intervalMinutes ?? 360} min)` : "Manual only"}
        </span>
        {dashboard.scheduler.nextRunAt && (
          <span className="rounded-full border border-[var(--border)] px-3 py-1.5">
            Next run: {formatDate(dashboard.scheduler.nextRunAt)}
          </span>
        )}
        <span className="rounded-full border border-[var(--border)] px-3 py-1.5">
          Last run: {formatDate(lastRunTime)}
        </span>
        {lastRun && (
          <span className="rounded-full border border-[var(--border)] px-3 py-1.5">
            Discovered: {lastRun.discoveredCount} ({lastRun.newCount} new{lastRun.rejectedCount > 0 ? `, ${lastRun.rejectedCount} filtered out` : ""}) · {statusLabel(lastRun.status)}
          </span>
        )}
        {dashboard.scheduler.configuredSources.length > 0 && (
          <span className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[var(--text-muted)]">
            Sources: {dashboard.scheduler.configuredSources.join(", ")}
          </span>
        )}
        {dashboard.scheduler.lastFailureMessage && (
          <span className="rounded-full border border-red-300 bg-red-50 px-3 py-1.5 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            Last failure: {dashboard.scheduler.lastFailureMessage}
          </span>
        )}
      </div>
      <p className="text-[10px] text-[var(--text-muted)]">
        Autonomous discovery scans supported public feeds (Arbeitnow, Remotive, Remote OK, Jobicy, Greenhouse, Lever) based on your saved candidate profile and derived strategy.
      </p>
    </div>
  );
}

function QueueCounts({ dashboard }: { dashboard: AssistantDashboard }) {
  const counts = [
    { label: "New jobs", value: dashboard.counts.opportunities },
    { label: "Preparation", value: dashboard.counts.preparations },
    { label: "Email drafts", value: dashboard.counts.emailDrafts },
    { label: "Approved", value: dashboard.counts.approved },
    { label: "Completed", value: dashboard.counts.completed },
    { label: "Failed / skipped", value: dashboard.counts.failed + dashboard.counts.skipped }
  ];

  return (
    <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {counts.map(item => (
        <div key={item.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="text-[10px] text-[var(--text-muted)]">{item.label}</div>
          <div className="mt-1 text-xl font-bold text-[var(--text)]">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Not run yet";
}

function statusLabel(status: AssistantDashboard["runs"][number]["status"]): string {
  const labels = {
    running: "Running",
    completed: "Completed",
    failed: "Failed",
    skipped: "Skipped"
  } satisfies Record<AssistantDashboard["runs"][number]["status"], string>;
  return labels[status];
}
