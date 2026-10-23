import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import type {
  Application,
  ApplicationPreparation as PrismaApplicationPreparation,
  DiscoveryRun as PrismaDiscoveryRun,
  JobOpportunity as PrismaJobOpportunity,
  RecruiterEmailDraft as PrismaRecruiterEmailDraft,
  SavedJob as PrismaSavedJob
} from "./generated/prisma/client.js";
import type { ApplicationRepository } from "./repository.js";
import { candidateProfileSchema, type ApplicationRecord, type CandidateProfileInput, type CandidateProfileRecord, type CreateApplicationInput, type Job, type SavedJob } from "@applypilot/shared";
import type { Prisma } from "./generated/prisma/client.js";
import { z } from "zod";
import type {
  AssistantRepository,
  CandidateProfileReviewFacts,
  EmailDraftRecord,
  OpportunityRecord,
  PreparationRecord,
  QueueCounts,
  RunResult
} from "./assistantRepository.js";
import type { SourceStatus } from "./jobs/arbeitnow.js";

const sourceStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["success", "empty", "disabled", "error"]),
  fetched: z.number().int().nonnegative(),
  message: z.string().optional(),
  limitations: z.array(z.string())
}) satisfies z.ZodType<SourceStatus>;

const discoveryRunStatusSchema = z.enum(["running", "completed", "failed", "skipped"]);
const opportunityAnalysisFieldsSchema = z.object({
  recommendation: z.enum(["strong_match", "potential_match", "low_match", "ineligible", "unknown"]),
  confidence: z.enum(["high", "medium", "low"]),
  matchedEvidence: z.array(z.string()),
  missingRequirements: z.array(z.string()),
  explanation: z.array(z.string()),
  factorBreakdown: z.array(z.object({
    name: z.enum(["skills", "role", "experience", "location"]),
    score: z.number().nullable(),
    weight: z.number(),
    available: z.boolean(),
    matchedEvidence: z.array(z.string()),
    limitations: z.array(z.string())
  }))
});
const reviewFactsSchema = candidateProfileSchema.pick({
  fullName: true,
  professionalSummary: true,
  skills: true,
  education: true,
  experience: true,
  projects: true,
  targetJobTitles: true,
  workAuthorization: true
});

function toRunResult(run: PrismaDiscoveryRun): RunResult {
  return {
    ...run,
    status: discoveryRunStatusSchema.parse(run.status),
    sourceResults: z.array(sourceStatusSchema).parse(run.sourceResults),
    rejectionReasons: (run.rejectionReasons && typeof run.rejectionReasons === "object"
      ? run.rejectionReasons as Record<string, number>
      : {})
  };
}

function toOpportunityRecord(
  opportunity: PrismaJobOpportunity
): OpportunityRecord {
  return {
    ...opportunity,
    ...opportunityAnalysisFieldsSchema.parse(opportunity)
  };
}

function toPreparationRecord(
  preparation: PrismaApplicationPreparation
): PreparationRecord {
  return {
    ...preparation,
    profileFactsSnapshot: reviewFactsSchema.parse(preparation.profileFactsSnapshot),
    unansweredQuestions: z.array(z.string()).parse(preparation.unansweredQuestions),
    generatedMaterials: z.array(z.unknown()).parse(preparation.generatedMaterials) as Prisma.JsonValue[]
  };
}

function toEmailDraftRecord(
  draft: PrismaRecruiterEmailDraft
): EmailDraftRecord {
  return {
    ...draft,
    factsUsed: z.array(z.string()).parse(draft.factsUsed)
  };
}

/** Copies only profile facts allowed in a review snapshot; preferences and resume text stay out. */
export function profileFactsForReview(
  profile: CandidateProfileReviewFacts
): CandidateProfileReviewFacts {
  return {
    fullName: profile.fullName,
    professionalSummary: profile.professionalSummary,
    skills: profile.skills,
    education: profile.education,
    experience: profile.experience,
    projects: profile.projects,
    targetJobTitles: profile.targetJobTitles,
    workAuthorization: profile.workAuthorization
  };
}

function toRecord(application: Application): ApplicationRecord {
  return {
    ...application,
    createdAt: application.createdAt.toISOString(),
    updatedAt: application.updatedAt.toISOString()
  };
}

function toSavedJob(job: PrismaSavedJob): SavedJob {
  return {
    id: job.id, sourceId: job.sourceId, source: job.source as SavedJob["source"], sourceAttribution: ({ arbeitnow: "Arbeitnow", remotive: "Remotive", remote_ok: "Remote OK", greenhouse: "Greenhouse", lever: "Lever" } as Record<string, string>)[job.source] ?? job.source, title: job.title, company: job.company,
    location: job.location, country: null, workArrangement: job.remote ? "remote" : null, url: job.jobUrl, description: job.description, remote: job.remote,
    publishedAt: job.publishedAt?.toISOString() ?? null, tags: job.tags, jobTypes: job.jobTypes,
    applicationId: job.applicationId, createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString()
  };
}

function toCandidateProfile(profile: Awaited<ReturnType<PrismaClient["candidateProfile"]["findUnique"]>>): CandidateProfileRecord | null {
  if (!profile) return null;
  return {
    ...candidateProfileSchema.parse({
      fullName: profile.fullName,
      professionalSummary: profile.professionalSummary,
      skills: profile.skills,
      education: profile.education,
      experience: profile.experience,
      projects: profile.projects,
      targetJobTitles: profile.targetJobTitles,
      technicalDomains: profile.technicalDomains ?? [],
      jobTypes: profile.jobTypes ?? [],
      languages: profile.languages ?? [],
      graduationDate: profile.graduationDate ?? "",
      preferredCountries: profile.preferredCountries,
      preferredLocations: profile.preferredLocations,
      workArrangements: profile.workArrangements,
      minimumSalary: profile.minimumSalary,
      workAuthorization: profile.workAuthorization,
      resumeText: profile.resumeText,
      searchStrategy: profile.searchStrategy ?? {}
    }),
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString()
  };
}

function profileData(data: CandidateProfileInput) {
  return {
    ...data,
    education: data.education as Prisma.InputJsonValue,
    experience: data.experience as Prisma.InputJsonValue,
    projects: data.projects as Prisma.InputJsonValue,
    searchStrategy: data.searchStrategy as Prisma.InputJsonValue
  };
}

function isUniqueConflict(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "P2002";
}

async function getQueueCounts(prisma: PrismaClient): Promise<QueueCounts> {
  const [
    opportunities,
    preparations,
    emailDrafts,
    approved,
    completed,
    failed,
    skippedPreparations,
    skippedEmailDrafts
  ] = await Promise.all([
    prisma.jobOpportunity.count({ where: { reviewStatus: "needs_review", isEligible: true, recommendation: { not: "ineligible" } } }),
    prisma.applicationPreparation.count({ where: { status: "needs_review" } }),
    prisma.recruiterEmailDraft.count({ where: { status: "needs_review" } }),
    prisma.approvedAction.count({ where: { status: "approved" } }),
    prisma.approvedAction.count({ where: { status: "completed" } }),
    prisma.approvedAction.count({ where: { status: "failed" } }),
    prisma.applicationPreparation.count({ where: { status: "skipped" } }),
    prisma.recruiterEmailDraft.count({ where: { status: "skipped" } })
  ]);

  return {
    opportunities,
    preparations,
    emailDrafts,
    approved,
    completed,
    failed,
    skipped: skippedPreparations + skippedEmailDrafts
  };
}

export function createDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required.");
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const applicationRepository: ApplicationRepository = {
    async list() {
      const applications = await prisma.application.findMany({ orderBy: { createdAt: "desc" } });
      return applications.map(toRecord);
    },
    async create(data: CreateApplicationInput) {
      return toRecord(await prisma.application.create({ data }));
    },
    async listSavedJobs() {
      return (await prisma.savedJob.findMany({ orderBy: { createdAt: "desc" } })).map(toSavedJob);
    },
    async saveJob(data: Job) {
      const createData = {
        sourceId: data.sourceId, source: data.source, title: data.title, company: data.company,
        location: data.location, jobUrl: data.url, description: data.description, remote: data.remote ?? false,
        publishedAt: data.publishedAt ? new Date(data.publishedAt) : null, tags: data.tags, jobTypes: data.jobTypes
      };
      try { return { job: toSavedJob(await prisma.savedJob.create({ data: createData })), duplicate: false }; }
      catch (error) {
        if (!isUniqueConflict(error)) throw error;
        const existing = await prisma.savedJob.findFirst({ where: { OR: [{ source: data.source, sourceId: data.sourceId }, { jobUrl: data.url }] } });
        if (!existing) throw error;
        return { job: toSavedJob(existing), duplicate: true };
      }
    },
    async moveSavedJobToApplication(id: string) {
      return prisma.$transaction(async tx => {
        const saved = await tx.savedJob.findUnique({ where: { id } });
        if (!saved) return null;
        if (saved.applicationId) {
          const linked = await tx.application.findUnique({ where: { id: saved.applicationId } });
          if (linked) return { application: toRecord(linked), alreadyTracked: true };
        }
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${saved.company.toLowerCase()}), hashtext(${saved.title.toLowerCase()}))`;
        const existing = await tx.application.findFirst({ where: { OR: [{ jobUrl: saved.jobUrl }, { company: saved.company, role: saved.title }] }, orderBy: { createdAt: "asc" } });
        const application = existing ?? await tx.application.create({ data: {
          company: saved.company, role: saved.title, location: saved.location, jobUrl: saved.jobUrl,
          status: "saved", notes: ""
        } });
        if (!saved.applicationId) await tx.savedJob.update({ where: { id }, data: { applicationId: application.id } });
        return { application: toRecord(application), alreadyTracked: !!existing };
      });
    },
    async getProfile() {
      return toCandidateProfile(await prisma.candidateProfile.findUnique({ where: { id: "local" } }));
    },
    async upsertProfile(data) {
      const profile = await prisma.candidateProfile.upsert({
        where: { id: "local" },
        create: { id: "local", ...profileData(data) },
        update: profileData(data)
      });
      return toCandidateProfile(profile)!;
    },
    async ping() {
      await prisma.$queryRaw`SELECT 1`;
    }
  };
  const assistantRepository: AssistantRepository = {
    async tryAcquireDiscoveryLock(holder, until) {
      // A single conditional upsert makes lock acquisition atomic across API instances.
      const updatedRows = await prisma.$executeRaw`
        INSERT INTO "discovery_scheduler_locks" ("id", "holder", "lockedUntil", "updatedAt")
        VALUES ('job-discovery', ${holder}, ${until}, CURRENT_TIMESTAMP)
        ON CONFLICT ("id") DO UPDATE
        SET "holder" = EXCLUDED."holder",
            "lockedUntil" = EXCLUDED."lockedUntil",
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "discovery_scheduler_locks"."lockedUntil" < CURRENT_TIMESTAMP
      `;
      return updatedRows === 1;
    },

    async releaseDiscoveryLock(holder) {
      await prisma.discoverySchedulerLock.deleteMany({
        where: { id: "job-discovery", holder }
      });
    },

    async createRun() {
      const run = await prisma.discoveryRun.create({ data: { status: "running" } });
      return toRunResult(run);
    },

    async finishRun(id, data) {
      const run = await prisma.discoveryRun.update({
        where: { id },
        data: {
          ...data,
          sourceResults: data.sourceResults as unknown as Prisma.InputJsonValue,
          rejectionReasons: (data.rejectionReasons ?? {}) as Prisma.InputJsonValue
        }
      });
      return toRunResult(run);
    },

    async upsertOpportunity(job, analysis) {
      const isEligible = analysis.eligible !== false && analysis.recommendation !== "ineligible";
      const opportunityData = {
        source: job.source,
        sourceId: job.sourceId,
        sourceAttribution: job.sourceAttribution,
        title: job.title,
        company: job.company,
        location: job.location,
        country: job.country,
        workArrangement: job.workArrangement,
        remote: job.remote,
        jobUrl: job.url,
        matchScore: analysis.score,
        recommendation: analysis.recommendation,
        confidence: analysis.confidence,
        isEligible,
        rejectionReason: analysis.rejectionReason ?? null,
        rejectionCategory: analysis.rejectionCategory ?? null,
        matchedEvidence: analysis.matchedEvidence,
        missingRequirements: analysis.missingOrUnverified,
        explanation: analysis.explanation,
        factorBreakdown: analysis.factorBreakdown as unknown as Prisma.InputJsonValue,
        lastSeenAt: new Date()
      };
      const existingOpportunity = await prisma.jobOpportunity.findUnique({
        where: {
          source_sourceId: {
            source: job.source,
            sourceId: job.sourceId
          }
        }
      });

      // Updating analysis never resets an opportunity the user already reviewed.
      const opportunity = existingOpportunity
        ? await prisma.jobOpportunity.update({
          where: { id: existingOpportunity.id },
          data: opportunityData
        })
        : await prisma.jobOpportunity.create({ data: opportunityData });

      return {
        opportunity: toOpportunityRecord(opportunity),
        created: existingOpportunity === null
      };
    },

    async getDashboard() {
      const [runs, opportunities, preparations, emailDrafts, actions, counts] = await Promise.all([
        prisma.discoveryRun.findMany({
          orderBy: { startedAt: "desc" },
          take: 20
        }),
        prisma.jobOpportunity.findMany({
          where: { isEligible: true, recommendation: { not: "ineligible" } },
          orderBy: [{ matchScore: "desc" }, { lastSeenAt: "desc" }],
          take: 100
        }),
        prisma.applicationPreparation.findMany({
          include: { opportunity: true },
          orderBy: { updatedAt: "desc" },
          take: 100
        }),
        prisma.recruiterEmailDraft.findMany({
          include: { opportunity: true },
          orderBy: { updatedAt: "desc" },
          take: 100
        }),
        prisma.approvedAction.findMany({
          orderBy: { approvedAt: "desc" },
          take: 100
        }),
        getQueueCounts(prisma)
      ]);

      return {
        runs: runs.map(toRunResult),
        opportunities: opportunities.map(toOpportunityRecord),
        preparations: preparations.map(preparation => ({
          ...toPreparationRecord(preparation),
          opportunity: toOpportunityRecord(preparation.opportunity)
        })),
        emailDrafts: emailDrafts.map(draft => ({
          ...toEmailDraftRecord(draft),
          opportunity: toOpportunityRecord(draft.opportunity)
        })),
        actions,
        counts
      };
    },

    async reviewOpportunity(id, decision, actor) {
      return prisma.$transaction(async transaction => {
        const opportunity = await transaction.jobOpportunity.findUnique({
          where: { id }
        });
        if (!opportunity || opportunity.reviewStatus !== "needs_review") {
          return null;
        }

        const targetKey = `job_opportunity_review:${opportunity.id}`;
        const action = await transaction.approvedAction.upsert({
          where: { targetKey },
          create: {
            targetKey,
            actionType: "job_opportunity_review",
            status: decision,
            approvedBy: actor,
            opportunityId: opportunity.id
          },
          update: {}
        });
        const reviewedOpportunity = await transaction.jobOpportunity.update({
          where: { id },
          data: { reviewStatus: decision }
        });

        return {
          opportunity: toOpportunityRecord(reviewedOpportunity),
          action
        };
      });
    },

    async createPreparation(opportunityId, profileFacts, generatedMaterials = [], unansweredQuestions = []) {
      const candidateProfileFacts = profileFactsForReview(profileFacts);
      const defaultQuestions = unansweredQuestions.length > 0
        ? unansweredQuestions
        : ["Confirm required qualifications and work authorization directly in the employer form."];

      const preparation = await prisma.applicationPreparation.upsert({
        where: { opportunityId },
        create: {
          opportunityId,
          profileFactsSnapshot: candidateProfileFacts as unknown as Prisma.InputJsonValue,
          unansweredQuestions: defaultQuestions,
          generatedMaterials: generatedMaterials as unknown as Prisma.InputJsonValue,
          submissionAvailable: false
        },
        update: {
          profileFactsSnapshot: candidateProfileFacts as unknown as Prisma.InputJsonValue,
          unansweredQuestions: defaultQuestions,
          generatedMaterials: generatedMaterials as unknown as Prisma.InputJsonValue
        }
      });
      return toPreparationRecord(preparation);
    },

    async updatePreparation(id, generatedMaterials) {
      const updatedRows = await prisma.applicationPreparation.updateMany({
        where: { id, status: "needs_review" },
        data: {
          generatedMaterials: generatedMaterials as unknown as Prisma.InputJsonValue
        }
      });
      if (updatedRows.count === 0) {
        return null;
      }
      const preparation = await prisma.applicationPreparation.findUnique({ where: { id } });
      return preparation ? toPreparationRecord(preparation) : null;
    },

    async skipPreparation(id) {
      const updatedRows = await prisma.applicationPreparation.updateMany({
        where: { id, status: "needs_review" },
        data: { status: "skipped" }
      });
      if (updatedRows.count === 0) {
        return null;
      }
      const preparation = await prisma.applicationPreparation.findUnique({ where: { id } });
      return preparation ? toPreparationRecord(preparation) : null;
    },

    async createEmailDraft(opportunityId, recipientAddress, recipientProvenance, subject, body, factsUsed) {
      const draft = await prisma.recruiterEmailDraft.upsert({
        where: { opportunityId },
        create: {
          opportunityId,
          recipientAddress,
          recipientProvenance,
          subject,
          body,
          factsUsed
        },
        update: {}
      });
      return toEmailDraftRecord(draft);
    },

    async updateEmailDraft(id, subject, body) {
      const updatedRows = await prisma.recruiterEmailDraft.updateMany({
        where: { id, status: "needs_review" },
        data: { subject, body }
      });
      if (updatedRows.count === 0) {
        return null;
      }
      const draft = await prisma.recruiterEmailDraft.findUnique({ where: { id } });
      return draft ? toEmailDraftRecord(draft) : null;
    },

    async verifyEmailRecipient(id) {
      const draft = await prisma.recruiterEmailDraft.findUnique({ where: { id } });
      const hasProvenance = Boolean(draft?.recipientProvenance.trim());
      if (!draft?.recipientAddress || !hasProvenance || draft.status !== "needs_review") {
        return null;
      }

      const verifiedDraft = await prisma.recruiterEmailDraft.update({
        where: { id },
        data: { recipientVerified: true, verifiedAt: new Date() }
      });
      return toEmailDraftRecord(verifiedDraft);
    },

    async approveEmailDraft(id, actor) {
      return prisma.$transaction(async transaction => {
        const draft = await transaction.recruiterEmailDraft.findUnique({
          where: { id }
        });
        if (
          !draft
          || !draft.recipientVerified
          || !draft.recipientAddress
          || draft.status !== "needs_review"
        ) {
          return null;
        }

        const targetKey = `send_email:${draft.id}`;
        const action = await transaction.approvedAction.upsert({
          where: { targetKey },
          create: {
            targetKey,
            actionType: "send_email",
            status: "approved",
            approvedBy: actor,
            emailDraftId: draft.id,
            opportunityId: draft.opportunityId
          },
          update: {}
        });
        const approvedDraft = await transaction.recruiterEmailDraft.update({
          where: { id },
          data: {
            status: "approved",
            approvedBy: actor,
            approvedAt: action.approvedAt
          }
        });

        return { draft: toEmailDraftRecord(approvedDraft), action };
      });
    },

    async approvePreparation(id, actor) {
      return prisma.$transaction(async transaction => {
        const preparation = await transaction.applicationPreparation.findUnique({
          where: { id }
        });
        if (!preparation || preparation.status !== "needs_review") {
          return null;
        }

        const targetKey = `application_preparation_review:${preparation.id}`;
        const action = await transaction.approvedAction.upsert({
          where: { targetKey },
          create: {
            targetKey,
            actionType: "application_preparation_review",
            status: "approved",
            approvedBy: actor,
            preparationId: preparation.id,
            opportunityId: preparation.opportunityId
          },
          update: {}
        });
        const approvedPreparation = await transaction.applicationPreparation.update({
          where: { id },
          data: { status: "approved" }
        });

        return { preparation: toPreparationRecord(approvedPreparation), action };
      });
    }
  };

  return { prisma, applicationRepository, assistantRepository };
}
