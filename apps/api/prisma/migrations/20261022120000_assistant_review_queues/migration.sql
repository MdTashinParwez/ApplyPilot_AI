CREATE TYPE "AssistantReviewStatus" AS ENUM ('needs_review', 'approved', 'completed', 'failed', 'skipped');

CREATE TABLE "discovery_runs" (
  "id" TEXT NOT NULL, "status" VARCHAR(24) NOT NULL, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3), "discoveredCount" INTEGER NOT NULL DEFAULT 0, "newCount" INTEGER NOT NULL DEFAULT 0,
  "sourceResults" JSONB NOT NULL DEFAULT '[]', "errorMessage" VARCHAR(500),
  CONSTRAINT "discovery_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "discovery_runs_startedAt_idx" ON "discovery_runs"("startedAt");

CREATE TABLE "job_opportunities" (
  "id" TEXT NOT NULL, "source" VARCHAR(40) NOT NULL, "sourceId" VARCHAR(240) NOT NULL, "sourceAttribution" VARCHAR(120) NOT NULL DEFAULT '',
  "title" VARCHAR(200) NOT NULL, "company" VARCHAR(160) NOT NULL, "location" VARCHAR(200) NOT NULL DEFAULT '', "country" VARCHAR(100),
  "workArrangement" VARCHAR(24), "remote" BOOLEAN, "jobUrl" TEXT NOT NULL, "matchScore" INTEGER,
  "recommendation" VARCHAR(32) NOT NULL DEFAULT 'unknown', "confidence" VARCHAR(16) NOT NULL DEFAULT 'low',
  "matchedEvidence" JSONB NOT NULL DEFAULT '[]', "missingRequirements" JSONB NOT NULL DEFAULT '[]', "explanation" JSONB NOT NULL DEFAULT '[]',
  "factorBreakdown" JSONB NOT NULL DEFAULT '[]', "reviewStatus" "AssistantReviewStatus" NOT NULL DEFAULT 'needs_review',
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "job_opportunities_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "job_opportunities_source_sourceId_key" ON "job_opportunities"("source", "sourceId");
CREATE INDEX "job_opportunities_reviewStatus_matchScore_idx" ON "job_opportunities"("reviewStatus", "matchScore");
CREATE INDEX "job_opportunities_lastSeenAt_idx" ON "job_opportunities"("lastSeenAt");

CREATE TABLE "application_preparations" (
  "id" TEXT NOT NULL, "opportunityId" TEXT NOT NULL, "status" "AssistantReviewStatus" NOT NULL DEFAULT 'needs_review',
  "profileFactsSnapshot" JSONB NOT NULL DEFAULT '{}', "unansweredQuestions" JSONB NOT NULL DEFAULT '[]',
  "generatedMaterials" JSONB NOT NULL DEFAULT '[]', "submissionAvailable" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "application_preparations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "application_preparations_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "job_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "application_preparations_opportunityId_key" ON "application_preparations"("opportunityId");

CREATE TABLE "recruiter_email_drafts" (
  "id" TEXT NOT NULL, "opportunityId" TEXT NOT NULL, "recipientAddress" VARCHAR(320), "recipientProvenance" VARCHAR(1000) NOT NULL DEFAULT '',
  "recipientVerified" BOOLEAN NOT NULL DEFAULT false, "verifiedAt" TIMESTAMP(3), "subject" VARCHAR(300) NOT NULL DEFAULT '',
  "body" VARCHAR(10000) NOT NULL DEFAULT '', "factsUsed" JSONB NOT NULL DEFAULT '[]', "status" "AssistantReviewStatus" NOT NULL DEFAULT 'needs_review',
  "approvedBy" VARCHAR(100), "approvedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recruiter_email_drafts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recruiter_email_drafts_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "job_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "recruiter_email_drafts_opportunityId_key" ON "recruiter_email_drafts"("opportunityId");

CREATE TABLE "approved_actions" (
  "id" TEXT NOT NULL, "targetKey" VARCHAR(300) NOT NULL, "actionType" VARCHAR(32) NOT NULL,
  "status" "AssistantReviewStatus" NOT NULL DEFAULT 'approved', "approvedBy" VARCHAR(100) NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "outcome" VARCHAR(1000), "opportunityId" TEXT,
  "preparationId" TEXT, "emailDraftId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "approved_actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "approved_actions_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "job_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "approved_actions_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "application_preparations"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "approved_actions_emailDraftId_fkey" FOREIGN KEY ("emailDraftId") REFERENCES "recruiter_email_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "approved_actions_targetKey_key" ON "approved_actions"("targetKey");
CREATE INDEX "approved_actions_status_approvedAt_idx" ON "approved_actions"("status", "approvedAt");

CREATE TABLE "discovery_scheduler_locks" (
  "id" VARCHAR(40) NOT NULL DEFAULT 'job-discovery', "holder" VARCHAR(100) NOT NULL, "lockedUntil" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "discovery_scheduler_locks_pkey" PRIMARY KEY ("id")
);
