import type { CandidateProfileInput, Job } from "@applypilot/shared";
import type {
  ApprovedAction,
  ApplicationPreparation,
  DiscoveryRun,
  JobOpportunity,
  Prisma,
  RecruiterEmailDraft
} from "./generated/prisma/client.js";
import type { JobAnalysisResult } from "./aiServiceClient.js";
import type { SourceStatus } from "./jobs/arbeitnow.js";

/** Discovery status is stored as varchar for backward compatibility with the migration. */
export type DiscoveryRunStatus = "running" | "completed" | "failed" | "skipped";

export type OpportunityRecommendation = JobAnalysisResult["recommendation"];

export type MatchConfidence = JobAnalysisResult["confidence"];

export type CandidateProfileReviewFacts = Pick<
  CandidateProfileInput,
  | "fullName"
  | "professionalSummary"
  | "skills"
  | "education"
  | "experience"
  | "projects"
  | "targetJobTitles"
  | "workAuthorization"
>;

/** A validated domain view over the discovery run's persisted JSON and varchar fields. */
export type RunResult = Omit<DiscoveryRun, "status" | "sourceResults" | "rejectionReasons"> & {
  status: DiscoveryRunStatus;
  sourceResults: SourceStatus[];
  rejectionReasons: Record<string, number>;
};

/** A validated domain view over JSON fields written by the evaluator. */
export type OpportunityRecord = Omit<
  JobOpportunity,
  | "recommendation"
  | "confidence"
  | "matchedEvidence"
  | "missingRequirements"
  | "explanation"
  | "factorBreakdown"
> & {
  recommendation: OpportunityRecommendation;
  confidence: MatchConfidence;
  matchedEvidence: string[];
  missingRequirements: string[];
  explanation: string[];
  factorBreakdown: JobAnalysisResult["factorBreakdown"];
};

export type PreparationRecord = Omit<
  ApplicationPreparation,
  "profileFactsSnapshot" | "unansweredQuestions" | "generatedMaterials"
> & {
  profileFactsSnapshot: CandidateProfileReviewFacts;
  unansweredQuestions: string[];
  generatedMaterials: Prisma.JsonValue[];
};

export type EmailDraftRecord = Omit<RecruiterEmailDraft, "factsUsed"> & {
  factsUsed: string[];
};

export interface QueueCounts {
  opportunities: number;
  preparations: number;
  emailDrafts: number;
  approved: number;
  completed: number;
  failed: number;
  skipped: number;
}

export interface AssistantDashboardData {
  runs: RunResult[];
  opportunities: OpportunityRecord[];
  preparations: Array<PreparationRecord & { opportunity: OpportunityRecord }>;
  emailDrafts: Array<EmailDraftRecord & { opportunity: OpportunityRecord }>;
  actions: ApprovedAction[];
  counts: QueueCounts;
}

export interface DiscoveryRunUpdate {
  status: Exclude<DiscoveryRunStatus, "running">;
  discoveredCount: number;
  newCount: number;
  rejectedCount?: number;
  rejectionReasons?: Record<string, number>;
  sourceResults: SourceStatus[];
  errorMessage?: string | null;
}

export interface OpportunityUpsertResult {
  opportunity: OpportunityRecord;
  created: boolean;
}

export interface OpportunityReviewResult {
  opportunity: OpportunityRecord;
  action: ApprovedAction;
}

export interface ApprovedDraftResult {
  draft: EmailDraftRecord;
  action: ApprovedAction;
}

export interface ApprovedPreparationResult {
  preparation: PreparationRecord;
  action: ApprovedAction;
}

export type OpportunityDecision = "approved" | "skipped";

export interface AssistantRepository {
  /** Claims the lease atomically; false means another active run owns it. */
  tryAcquireDiscoveryLock(holder: string, until: Date): Promise<boolean>;
  /** Releases the lease only when this caller still owns it. */
  releaseDiscoveryLock(holder: string): Promise<void>;
  createRun(): Promise<RunResult>;
  /** A run is written once as completed, failed, or skipped; missing IDs reject. */
  finishRun(id: string, data: DiscoveryRunUpdate): Promise<RunResult>;
  /** Upserts by stable source ID and preserves a prior review decision. */
  upsertOpportunity(job: Job, analysis: JobAnalysisResult): Promise<OpportunityUpsertResult>;
  getDashboard(): Promise<AssistantDashboardData>;
  /** Transitions only needs_review opportunities; null means missing or already reviewed. */
  reviewOpportunity(
    id: string,
    decision: OpportunityDecision,
    actor: string
  ): Promise<OpportunityReviewResult | null>;
  createPreparation(
    opportunityId: string,
    profileFacts: CandidateProfileReviewFacts,
    generatedMaterials?: Prisma.JsonValue[],
    unansweredQuestions?: string[]
  ): Promise<PreparationRecord>;
  updatePreparation(
    id: string,
    generatedMaterials: Prisma.JsonValue[]
  ): Promise<PreparationRecord | null>;
  /** Transitions only needs_review tasks; null means missing or no longer reviewable. */
  skipPreparation(id: string): Promise<PreparationRecord | null>;
  createEmailDraft(
    opportunityId: string,
    recipientAddress: string,
    recipientProvenance: string,
    subject: string,
    body: string,
    factsUsed: string[]
  ): Promise<EmailDraftRecord>;
  updateEmailDraft(
    id: string,
    subject: string,
    body: string
  ): Promise<EmailDraftRecord | null>;
  /** Null means the draft is missing, unverified, or outside needs_review. */
  verifyEmailRecipient(id: string): Promise<EmailDraftRecord | null>;
  approveEmailDraft(id: string, actor: string): Promise<ApprovedDraftResult | null>;
  approvePreparation(id: string, actor: string): Promise<ApprovedPreparationResult | null>;
}
