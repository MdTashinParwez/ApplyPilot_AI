CREATE TYPE "ApplicationStatus" AS ENUM ('saved', 'applied', 'interview', 'offer', 'rejected');

CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "company" VARCHAR(120) NOT NULL,
    "role" VARCHAR(120) NOT NULL,
    "location" VARCHAR(120) NOT NULL DEFAULT '',
    "jobUrl" TEXT NOT NULL DEFAULT '',
    "status" "ApplicationStatus" NOT NULL DEFAULT 'saved',
    "notes" VARCHAR(4000) NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "applications_createdAt_idx" ON "applications"("createdAt");
