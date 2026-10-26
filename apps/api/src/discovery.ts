import { randomUUID } from "node:crypto";
import {
  candidateProfileSchema,
  deriveSearchStrategy,
  jobSearchSchema,
  type CandidateProfileInput,
  type Job
} from "@applypilot/shared";
import type { JobAnalyzer, JobAnalysisResult, AnalysisProfile } from "./aiServiceClient.js";
import type { AssistantRepository } from "./assistantRepository.js";
import type { JobSource, SourceStatus } from "./jobs/arbeitnow.js";
import { evaluateJobsLocally } from "./matching/evaluator.js";

const MAX_DISCOVERY_JOBS = 100;
const DISCOVERY_LOCK_LEASE_MS = 10 * 60_000;

function hasProfileDetails(profile: CandidateProfileInput): boolean {
  return Boolean(
    profile.skills.length
    || profile.targetJobTitles.length
    || profile.technicalDomains.length
    || profile.preferredCountries.length
    || profile.preferredLocations.length
    || profile.workArrangements.length
    || profile.professionalSummary.trim()
    || profile.experience.length
  );
}

function toAnalysisProfile(profile: CandidateProfileInput): AnalysisProfile {
  return {
    skills: profile.skills,
    professionalSummary: profile.professionalSummary,
    targetJobTitles: profile.targetJobTitles,
    technicalDomains: profile.technicalDomains,
    jobTypes: profile.jobTypes,
    languages: profile.languages,
    preferredCountries: profile.preferredCountries,
    preferredLocations: profile.preferredLocations,
    workArrangements: profile.workArrangements,
    workAuthorization: profile.workAuthorization,
    experience: profile.experience.map(({ title, company, details }) => ({
      title,
      company,
      details
    }))
  };
}

export class DiscoveryBusyError extends Error {
  constructor() {
    super("A discovery run is already in progress.");
    this.name = "DiscoveryBusyError";
  }
}

export class DiscoveryProfileError extends Error {
  constructor() {
    super("Complete your candidate profile before running discovery.");
    this.name = "DiscoveryProfileError";
  }
}

export function createDiscoveryRunner(
  repository: AssistantRepository,
  getProfile: () => Promise<unknown>,
  source: JobSource,
  analyze: JobAnalyzer
) {
  return async function runDiscovery(trigger: "scheduled" | "manual" = "manual") {
    const holder = `${trigger}:${randomUUID()}`;
    const leaseUntil = new Date(Date.now() + DISCOVERY_LOCK_LEASE_MS);
    const acquired = await repository.tryAcquireDiscoveryLock(holder, leaseUntil);

    if (!acquired) {
      throw new DiscoveryBusyError();
    }

    let run: Awaited<ReturnType<AssistantRepository["createRun"]>> | undefined;
    let sourceResults: SourceStatus[] = [];
    let discoveredCount = 0;
    let newCount = 0;

    try {
      run = await repository.createRun();
      const savedProfile = await getProfile();
      const profile = candidateProfileSchema.parse(savedProfile ?? {});

      if (!hasProfileDetails(profile)) {
        await repository.finishRun(run.id, {
          status: "skipped",
          discoveredCount: 0,
          newCount: 0,
          sourceResults: [],
          errorMessage: "Candidate profile is incomplete."
        });
        throw new DiscoveryProfileError();
      }

      // Automatically derive and align search strategy from authoritative candidate profile
      const strategy = deriveSearchStrategy(profile);
      profile.searchStrategy = strategy;

      const query = jobSearchSchema.parse({ page: 1, pageSize: MAX_DISCOVERY_JOBS });
      const search = await source.search(query);
      const jobs = search.jobs.slice(0, MAX_DISCOVERY_JOBS);
      sourceResults = search.sources ?? [];
      discoveredCount = jobs.length;

      let analyses: JobAnalysisResult[] = [];
      if (jobs.length > 0) {
        try {
          analyses = await analyze(toAnalysisProfile(profile), jobs);
        } catch {
          // Graceful degradation: evaluate locally if external evaluator is unavailable
          analyses = evaluateJobsLocally(toAnalysisProfile(profile), jobs);
        }
      }
      const analysisBySourceId = indexAnalyses(analyses);

      let rejectedCount = 0;
      const rejectionReasons: Record<string, number> = {};

      for (const job of jobs) {
        const analysis = analysisBySourceId.get(getJobKey(job));
        if (!analysis) {
          continue;
        }

        const isEligible = analysis.eligible !== false && analysis.recommendation !== "ineligible";

        if (!isEligible) {
          rejectedCount += 1;
          const category = analysis.rejectionCategory ?? "ineligible";
          rejectionReasons[category] = (rejectionReasons[category] ?? 0) + 1;
          // Keep rejected jobs OUT of the primary recommended queue
          continue;
        }

        const result = await repository.upsertOpportunity(job, analysis);
        if (result.created) {
          newCount += 1;
        }
      }

      const runStatus = getRunStatus(jobs.length, analyses.length, sourceResults);
      const finishedRun = await repository.finishRun(run.id, {
        status: runStatus,
        discoveredCount,
        newCount,
        rejectedCount,
        rejectionReasons,
        sourceResults,
        errorMessage: null
      });

      // Update truthful scheduler stats
      recordSuccessfulDiscoveryRun(newCount, rejectedCount);

      return {
        run: finishedRun,
        opportunities: jobs.length,
        eligibleOpportunities: jobs.length - rejectedCount,
        newOpportunities: newCount,
        rejectedOpportunities: rejectedCount,
        rejectionBreakdown: rejectionReasons,
        sourceResults,
        coverageLimitations: search.coverageLimitations ?? []
      };
    } catch (error) {
      if (run && !(error instanceof DiscoveryProfileError)) {
        recordFailedDiscoveryRun(error instanceof Error ? error.message : "Discovery run failed");
        await finishFailedRun(repository, run.id, {
          discoveredCount,
          newCount,
          sourceResults
        });
      }
      throw error;
    } finally {
      await releaseDiscoveryLease(repository, holder);
    }
  };
}

function indexAnalyses(analyses: JobAnalysisResult[]): Map<string, JobAnalysisResult> {
  return new Map(analyses.map(analysis => [
    `${analysis.source}:${analysis.sourceId}`,
    analysis
  ]));
}

function getJobKey(job: Job): string {
  return `${job.source}:${job.sourceId}`;
}

function getRunStatus(
  jobCount: number,
  analysisCount: number,
  sourceResults: SourceStatus[]
): "completed" | "failed" {
  if (jobCount > 0 && analysisCount > 0) {
    return "completed";
  }

  const hasAvailableSource = sourceResults.some(source =>
    source.status === "success" || source.status === "empty"
  );
  return hasAvailableSource ? "completed" : "failed";
}

async function finishFailedRun(
  repository: AssistantRepository,
  runId: string,
  counts: { discoveredCount: number; newCount: number; sourceResults: SourceStatus[] }
): Promise<void> {
  try {
    await repository.finishRun(runId, {
      ...counts,
      status: "failed",
      errorMessage: "Discovery could not complete. Check service status and retry."
    });
  } catch {
    console.error("Could not record the failed discovery run.");
  }
}

async function releaseDiscoveryLease(
  repository: AssistantRepository,
  holder: string
): Promise<void> {
  try {
    await repository.releaseDiscoveryLock(holder);
  } catch {
    // The lease expires automatically if the API cannot release it.
    console.error("Could not release the discovery lease; it will expire automatically.");
  }
}

export interface SchedulerStatus {
  enabled: boolean;
  status: "idle" | "running" | "scheduled" | "disabled";
  intervalMinutes: number | null;
  lastRunAt: string | null;
  lastSuccessfulRunAt: string | null;
  lastFailureAt: string | null;
  lastFailureMessage: string | null;
  nextRunAt: string | null;
  configuredSources: string[];
  acceptedJobCount: number;
  rejectedJobCount: number;
}

const getConfiguredSources = (): string[] =>
  (process.env.JOB_SOURCES ?? "arbeitnow,remotive,remote_ok,jobicy,greenhouse,lever,ashby,search_discovery,career_page")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

const schedulerStatus: SchedulerStatus = {
  enabled: false,
  status: "disabled",
  intervalMinutes: null,
  lastRunAt: null,
  lastSuccessfulRunAt: null,
  lastFailureAt: null,
  lastFailureMessage: null,
  nextRunAt: null,
  configuredSources: getConfiguredSources(),
  acceptedJobCount: 0,
  rejectedJobCount: 0
};

export function recordSuccessfulDiscoveryRun(accepted: number, rejected: number): void {
  schedulerStatus.lastSuccessfulRunAt = new Date().toISOString();
  schedulerStatus.acceptedJobCount += accepted;
  schedulerStatus.rejectedJobCount += rejected;
}

export function recordFailedDiscoveryRun(errorMessage: string): void {
  schedulerStatus.lastFailureAt = new Date().toISOString();
  schedulerStatus.lastFailureMessage = errorMessage;
}

export function getSchedulerStatus(): SchedulerStatus {
  return {
    ...schedulerStatus,
    configuredSources: getConfiguredSources()
  };
}

let schedulerStarted = false;

export function startDiscoveryScheduler(
  run: () => Promise<unknown>,
  intervalMinutes: number,
  options?: { runOnStartup?: boolean }
): () => void {
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0 || schedulerStarted) {
    return () => undefined;
  }

  schedulerStarted = true;
  const boundedMinutes = Math.min(7 * 24 * 60, intervalMinutes);
  const intervalMilliseconds = boundedMinutes * 60_000;
  let isRunning = false;

  schedulerStatus.enabled = true;
  schedulerStatus.status = "scheduled";
  schedulerStatus.intervalMinutes = boundedMinutes;
  schedulerStatus.nextRunAt = new Date(Date.now() + intervalMilliseconds).toISOString();

  const runScheduledDiscovery = async (): Promise<void> => {
    if (isRunning) {
      return;
    }

    isRunning = true;
    schedulerStatus.status = "running";
    schedulerStatus.lastRunAt = new Date().toISOString();

    try {
      await run();
    } catch (error) {
      if (!(error instanceof DiscoveryBusyError) && !(error instanceof DiscoveryProfileError)) {
        const msg = error instanceof Error ? error.message : "Scheduled discovery failed";
        recordFailedDiscoveryRun(msg);
        console.error("Scheduled discovery failed:", msg);
      }
    } finally {
      isRunning = false;
      schedulerStatus.status = "scheduled";
      schedulerStatus.nextRunAt = new Date(Date.now() + intervalMilliseconds).toISOString();
    }
  };

  const timer = setInterval(() => {
    void runScheduledDiscovery();
  }, intervalMilliseconds);
  timer.unref();

  let startupTimer: NodeJS.Timeout | undefined;
  if (options?.runOnStartup) {
    startupTimer = setTimeout(() => {
      void runScheduledDiscovery();
    }, 5000);
    startupTimer.unref();
  }

  return () => {
    clearInterval(timer);
    if (startupTimer) clearTimeout(startupTimer);
    schedulerStarted = false;
    schedulerStatus.enabled = false;
    schedulerStatus.status = "disabled";
    schedulerStatus.nextRunAt = null;
  };
}
