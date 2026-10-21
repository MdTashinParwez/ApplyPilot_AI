import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import type { Application, SavedJob as PrismaSavedJob } from "./generated/prisma/client.js";
import type { ApplicationRepository } from "./repository.js";
import { candidateProfileSchema, type ApplicationRecord, type CandidateProfileInput, type CandidateProfileRecord, type CreateApplicationInput, type Job, type SavedJob } from "@applypilot/shared";
import type { Prisma } from "./generated/prisma/client.js";

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
      preferredCountries: profile.preferredCountries,
      preferredLocations: profile.preferredLocations,
      workArrangements: profile.workArrangements,
      minimumSalary: profile.minimumSalary,
      workAuthorization: profile.workAuthorization,
      resumeText: profile.resumeText
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
    projects: data.projects as Prisma.InputJsonValue
  };
}

function isUniqueConflict(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "P2002";
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
  return { prisma, applicationRepository };
}
