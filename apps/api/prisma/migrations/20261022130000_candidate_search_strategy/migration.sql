-- AlterTable
ALTER TABLE "candidate_profiles" ADD COLUMN "technicalDomains" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "candidate_profiles" ADD COLUMN "jobTypes" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "candidate_profiles" ADD COLUMN "graduationDate" VARCHAR(40) NOT NULL DEFAULT '';
ALTER TABLE "candidate_profiles" ADD COLUMN "searchStrategy" JSONB NOT NULL DEFAULT '{}';

