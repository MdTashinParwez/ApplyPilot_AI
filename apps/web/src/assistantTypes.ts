import { z } from "zod";

const reviewStatusSchema = z.enum([
  "needs_review",
  "approved",
  "completed",
  "failed",
  "skipped"
]);

const sourceStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["success", "empty", "disabled", "error"]),
  fetched: z.number().int().nonnegative(),
  message: z.string().optional(),
  limitations: z.array(z.string())
});

const opportunitySchema = z.object({
  id: z.string(),
  source: z.string(),
  sourceId: z.string(),
  sourceAttribution: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  country: z.string().nullable(),
  workArrangement: z.string().nullable(),
  remote: z.boolean().nullable(),
  jobUrl: z.string().url(),
  matchScore: z.number().int().min(0).max(100).nullable(),
  recommendation: z.string(),
  confidence: z.string(),
  matchedEvidence: z.array(z.string()),
  missingRequirements: z.array(z.string()),
  explanation: z.array(z.string()),
  reviewStatus: reviewStatusSchema,
  isEligible: z.boolean().default(true),
  rejectionReason: z.string().nullable().default(null),
  rejectionCategory: z.string().nullable().default(null),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

const preparationSchema = z.object({
  id: z.string(),
  opportunityId: z.string(),
  status: reviewStatusSchema,
  unansweredQuestions: z.array(z.string()),
  submissionAvailable: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  opportunity: opportunitySchema
});

const emailDraftSchema = z.object({
  id: z.string(),
  opportunityId: z.string(),
  recipientAddress: z.string().nullable(),
  recipientProvenance: z.string(),
  recipientVerified: z.boolean(),
  verifiedAt: z.string().nullable(),
  subject: z.string(),
  body: z.string(),
  factsUsed: z.array(z.string()),
  status: reviewStatusSchema,
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  opportunity: opportunitySchema
});

const approvalSchema = z.object({
  id: z.string(),
  targetKey: z.string(),
  actionType: z.string(),
  status: reviewStatusSchema,
  approvedBy: z.string(),
  approvedAt: z.string(),
  outcome: z.string().nullable(),
  createdAt: z.string()
});

const discoveryRunSchema = z.object({
  id: z.string(),
  status: z.enum(["running", "completed", "failed", "skipped"]),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  discoveredCount: z.number().int().nonnegative(),
  newCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative().default(0),
  rejectionReasons: z.record(z.string(), z.number()).default({}),
  sourceResults: z.array(sourceStatusSchema),
  errorMessage: z.string().nullable()
});

export const assistantDashboardSchema = z.object({
  runs: z.array(discoveryRunSchema),
  opportunities: z.array(opportunitySchema),
  preparations: z.array(preparationSchema),
  emailDrafts: z.array(emailDraftSchema),
  actions: z.array(approvalSchema),
  counts: z.object({
    opportunities: z.number().int().nonnegative(),
    preparations: z.number().int().nonnegative(),
    emailDrafts: z.number().int().nonnegative(),
    approved: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative()
  }),
  scheduler: z.object({
    enabled: z.boolean(),
    status: z.enum(["idle", "running", "scheduled", "disabled"]).default("disabled"),
    intervalMinutes: z.number().positive().nullable(),
    lastRunAt: z.string().nullable().default(null),
    lastSuccessfulRunAt: z.string().nullable().default(null),
    lastFailureAt: z.string().nullable().default(null),
    lastFailureMessage: z.string().nullable().default(null),
    nextRunAt: z.string().nullable().default(null),
    configuredSources: z.array(z.string()).default([]),
    acceptedJobCount: z.number().int().default(0),
    rejectedJobCount: z.number().int().default(0)
  })
});

export type AssistantStatus = z.infer<typeof reviewStatusSchema>;
export type SourceStatus = z.infer<typeof sourceStatusSchema>;
export type Opportunity = z.infer<typeof opportunitySchema>;
export type Preparation = z.infer<typeof preparationSchema>;
export type EmailDraft = z.infer<typeof emailDraftSchema>;
export type Approval = z.infer<typeof approvalSchema>;
export type DiscoveryRun = z.infer<typeof discoveryRunSchema>;
export type AssistantDashboard = z.infer<typeof assistantDashboardSchema>;
