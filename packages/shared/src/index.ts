import { z } from "zod";

export const applicationStatuses = ["saved", "applied", "interview", "offer", "rejected"] as const;
export const createApplicationSchema = z.object({
  company: z.string().trim().min(1).max(160),
  role: z.string().trim().min(1).max(200),
  location: z.string().trim().max(120).default(""),
  jobUrl: z.union([z.literal(""), z.url()]).default(""),
  status: z.enum(applicationStatuses).default("saved"),
  notes: z.string().trim().max(4000).default("")
});

export type ApplicationStatus = (typeof applicationStatuses)[number];
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
export interface ApplicationRecord extends CreateApplicationInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export const jobSearchSchema = z.object({
  keyword: z.string().trim().max(100).default(""),
  location: z.string().trim().max(100).default(""),
  country: z.string().trim().max(100).default(""),
  remoteOnly: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  sources: z.string().trim().max(300).default(""),
  includeMatches: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  page: z.coerce.number().int().min(1).max(5).default(1),
  pageSize: z.coerce.number().int().min(1).max(25).default(12)
});

export const jobSchema = z.object({
  sourceId: z.string().min(1).max(200),
  source: z.enum(["arbeitnow", "remotive", "remote_ok", "greenhouse", "lever", "jobicy"]),
  sourceAttribution: z.string().max(200).default(""),
  title: z.string().trim().min(1).max(200),
  company: z.string().trim().min(1).max(160),
  location: z.string().trim().max(200).default(""),
  country: z.string().trim().max(120).nullable().default(null),
  workArrangement: z.enum(["remote", "hybrid", "onsite"]).nullable().default(null),
  url: z.url(),
  description: z.string().max(5000).default(""),
  remote: z.boolean().nullable().default(null),
  publishedAt: z.string().datetime().nullable(),
  tags: z.array(z.string().max(100)).max(30).default([]),
  jobTypes: z.array(z.string().max(100)).max(20).default([])
});

export const saveJobSchema = jobSchema;
export type JobSearchInput = z.infer<typeof jobSearchSchema>;
export type Job = z.infer<typeof jobSchema>;
export interface SavedJob extends Job {
  id: string;
  applicationId: string | null;
  createdAt: string;
  updatedAt: string;
}

const profileText = (max: number) => z.string().trim().max(max).default("");
const profileEntryText = (max: number) => z.string().trim().max(max).default("");

export const educationEntrySchema = z.object({
  institution: profileEntryText(200),
  qualification: profileEntryText(160),
  fieldOfStudy: profileEntryText(160),
  location: profileEntryText(160),
  startDate: profileEntryText(40),
  endDate: profileEntryText(40),
  details: profileEntryText(2000)
});

export const experienceEntrySchema = z.object({
  company: profileEntryText(160),
  title: profileEntryText(160),
  location: profileEntryText(160),
  startDate: profileEntryText(40),
  endDate: profileEntryText(40),
  current: z.boolean().default(false),
  details: profileEntryText(3000)
});

export const projectEntrySchema = z.object({
  name: profileEntryText(160),
  url: z.union([z.literal(""), z.url()]).default(""),
  technologies: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  details: profileEntryText(2000)
});

export type EducationEntry = z.infer<typeof educationEntrySchema>;
export type ExperienceEntry = z.infer<typeof experienceEntrySchema>;
export type ProjectEntry = z.infer<typeof projectEntrySchema>;

export const searchStrategySchema = z.object({
  targetTitles: z.array(z.string().trim().min(1).max(160)).default([]),
  queries: z.array(z.string().trim().min(1).max(160)).default([]),
  keywords: z.array(z.string().trim().min(1).max(80)).default([]),
  technicalDomains: z.array(z.string().trim().min(1).max(80)).default([]),
  jobTypes: z.array(z.string().trim().min(1).max(60)).default([]),
  lastDerivedAt: z.string().datetime().nullable().default(null)
}).default({
  targetTitles: [],
  queries: [],
  keywords: [],
  technicalDomains: [],
  jobTypes: [],
  lastDerivedAt: null
});

export type SearchStrategy = z.infer<typeof searchStrategySchema>;

export const candidateProfileSchema = z.object({
  fullName: profileText(160),
  professionalSummary: profileText(4000),
  skills: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  education: z.array(educationEntrySchema).max(20).default([]),
  experience: z.array(experienceEntrySchema).max(30).default([]),
  projects: z.array(projectEntrySchema).max(30).default([]),
  targetJobTitles: z.array(z.string().trim().min(1).max(160)).max(30).default([]),
  technicalDomains: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  jobTypes: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  languages: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  graduationDate: profileText(40),
  preferredCountries: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  preferredLocations: z.array(z.string().trim().min(1).max(160)).max(50).default([]),
  workArrangements: z.array(z.enum(["remote", "hybrid", "onsite"])).max(3).default([]),
  minimumSalary: z.number().int().min(0).max(100000000).nullable().default(null),
  workAuthorization: profileText(2000),
  resumeText: profileText(100000),
  searchStrategy: searchStrategySchema
});

export type CandidateProfileInput = z.infer<typeof candidateProfileSchema>;
export interface CandidateProfileRecord extends CandidateProfileInput {
  createdAt: string | null;
  updatedAt: string | null;
}

export * from "./searchStrategy.js";

