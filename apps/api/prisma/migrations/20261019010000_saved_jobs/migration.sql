CREATE TABLE "saved_jobs" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "company" VARCHAR(160) NOT NULL,
    "location" VARCHAR(200) NOT NULL DEFAULT '',
    "jobUrl" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "remote" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "jobTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "applicationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "saved_jobs_jobUrl_key" ON "saved_jobs"("jobUrl");
CREATE UNIQUE INDEX "saved_jobs_applicationId_key" ON "saved_jobs"("applicationId");
CREATE UNIQUE INDEX "saved_jobs_source_sourceId_key" ON "saved_jobs"("source", "sourceId");
CREATE INDEX "saved_jobs_createdAt_idx" ON "saved_jobs"("createdAt");

ALTER TABLE "saved_jobs" ADD CONSTRAINT "saved_jobs_applicationId_fkey"
FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
