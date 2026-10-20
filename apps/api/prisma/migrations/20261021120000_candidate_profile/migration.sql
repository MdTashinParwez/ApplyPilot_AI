CREATE TABLE "candidate_profiles" (
    "id" VARCHAR(20) NOT NULL DEFAULT 'local',
    "fullName" VARCHAR(160) NOT NULL DEFAULT '',
    "professionalSummary" VARCHAR(4000) NOT NULL DEFAULT '',
    "skills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "education" JSONB NOT NULL DEFAULT '[]',
    "experience" JSONB NOT NULL DEFAULT '[]',
    "projects" JSONB NOT NULL DEFAULT '[]',
    "targetJobTitles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "preferredCountries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "preferredLocations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "workArrangements" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "minimumSalary" INTEGER,
    "workAuthorization" VARCHAR(2000) NOT NULL DEFAULT '',
    "resumeText" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_profiles_pkey" PRIMARY KEY ("id")
);
