-- AlterTable
ALTER TABLE "candidate_profiles" ADD COLUMN "languages" TEXT[] NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "discovery_runs" ADD COLUMN "rejectedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "discovery_runs" ADD COLUMN "rejectionReasons" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "job_opportunities" ADD COLUMN "isEligible" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "job_opportunities" ADD COLUMN "rejectionReason" VARCHAR(500);
ALTER TABLE "job_opportunities" ADD COLUMN "rejectionCategory" VARCHAR(60);

