import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import request from "supertest";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { candidateProfileSchema, jobSearchSchema, type ApplicationRecord, type CandidateProfileInput, type CandidateProfileRecord, type CreateApplicationInput, type Job, type JobSearchInput, type SavedJob } from "@applypilot/shared";
import { createApp } from "./app.js";
import { AIServiceError, type JobAnalysisResult } from "./aiServiceClient.js";
import type { ApplicationRepository } from "./repository.js";
import { createArbeitnowSource, normalizeArbeitnowJob } from "./jobs/arbeitnow.js";

const now = new Date("2026-10-19T12:00:00.000Z");
const record: ApplicationRecord = {
  id: "application_123",
  company: "Linear",
  role: "Product Designer",
  location: "Remote",
  jobUrl: "https://linear.app/careers",
  status: "saved",
  notes: "Follow up next week",
  createdAt: now.toISOString(),
  updatedAt: now.toISOString()
};
const job: Job = { sourceId: "sample", source: "arbeitnow", sourceAttribution: "Arbeitnow", title: "Designer", company: "Linear", location: "Berlin", country: null, workArrangement: "remote", url: "https://jobs.example/1", description: "Design systems", remote: true, publishedAt: now.toISOString(), tags: ["design"], jobTypes: [] };
const saved: SavedJob = { ...job, id: "saved_1", applicationId: null, createdAt: now.toISOString(), updatedAt: now.toISOString() };

let originalConsoleError: typeof console.error;
before(() => { originalConsoleError = console.error; console.error = () => undefined; });
after(() => { console.error = originalConsoleError; });

function makeRepository(overrides: Partial<ApplicationRepository> = {}) {
  const repository: ApplicationRepository = {
    list: async () => [],
    create: async (_data: CreateApplicationInput) => record,
    listSavedJobs: async () => [],
    saveJob: async () => ({ job: saved, duplicate: false }),
    moveSavedJobToApplication: async () => ({ application: record, alreadyTracked: false }),
    getProfile: async () => null,
    upsertProfile: async data => ({ ...data, createdAt: now.toISOString(), updatedAt: now.toISOString() }),
    ping: async () => undefined,
    ...overrides
  };
  return repository;
}

test("GET /api/profile returns an empty profile before the first save", async () => {
  const response = await request(createApp(makeRepository())).get("/api/profile");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ...candidateProfileSchema.parse({}), createdAt: null, updatedAt: null });
});

test("job recommendations ask for a profile before accessing jobs or the AI service", async () => {
  let feedCalls = 0; let evaluatorCalls = 0;
  const feed = { search: async (query: JobSearchInput) => { feedCalls++; return { jobs: [], total: 0, page: query.page, pageSize: query.pageSize, hasNextPage: false }; } };
  const app = createApp(makeRepository(), feed, async () => { evaluatorCalls++; return []; });
  const response = await request(app).get("/api/job-recommendations");
  assert.equal(response.status, 200);
  assert.equal(response.body.status, "profile_incomplete");
  assert.match(response.body.message, /Complete your candidate profile/);
  assert.equal(feedCalls, 0); assert.equal(evaluatorCalls, 0);
});

test("job recommendations rank Arbeitnow feed jobs using persisted profile without writing data", async () => {
  const persisted: CandidateProfileRecord = { ...candidateProfileSchema.parse({ skills: ["Python"], targetJobTitles: ["Engineer"] }), createdAt: now.toISOString(), updatedAt: now.toISOString() };
  let receivedProfile: unknown; let receivedJobs: unknown;
  const recommendation: JobAnalysisResult = { sourceId: job.sourceId, source: job.source, title: job.title, company: job.company, location: job.location, country: job.country, workArrangement: job.workArrangement, url: job.url, remote: job.remote, score: 88, recommendation: "strong_match", confidence: "high", confidenceReasons: [], factorBreakdown: [], matchedEvidence: ["Skill match: Python."], missingOrUnverified: [], explanation: ["Profile signals align."] };
  const feed = { search: async (query: JobSearchInput) => ({ jobs: [job], total: 44, page: query.page, pageSize: query.pageSize, hasNextPage: true }) };
  const app = createApp(makeRepository({ getProfile: async () => persisted }), feed, async (profile, jobs) => { receivedProfile = profile; receivedJobs = jobs; return [recommendation]; });
  const response = await request(app).get("/api/job-recommendations");
  assert.equal(response.status, 200);
  assert.equal(response.body.status, "ready"); assert.equal(response.body.availableCount, 44); assert.equal(response.body.hasMore, true);
  assert.deepEqual(receivedProfile, { skills: ["Python"], professionalSummary: "", targetJobTitles: ["Engineer"], preferredCountries: [], preferredLocations: [], workArrangements: [], workAuthorization: "", experience: [] });
  assert.deepEqual(receivedJobs, [job]);
  assert.equal(response.body.recommendations[0].sourceId, job.sourceId);
  assert.equal(response.body.recommendations[0].url, job.url);
});

test("job recommendation service failures return a safe retryable API error", async () => {
  const profile = { ...candidateProfileSchema.parse({ skills: ["Python"] }), createdAt: now.toISOString(), updatedAt: now.toISOString() };
  const feed = { search: async (query: JobSearchInput) => ({ jobs: [job], total: 1, page: query.page, pageSize: query.pageSize, hasNextPage: false }) };
  const response = await request(createApp(makeRepository({ getProfile: async () => profile }), feed, async () => { throw new AIServiceError("timeout"); })).get("/api/job-recommendations");
  assert.equal(response.status, 504);
  assert.deepEqual(response.body.error, { code: "AI_SERVICE_TIMEOUT", message: "Job analysis is temporarily unavailable. Please retry shortly." });
});

test("empty job sources return status details without calling the evaluator", async () => {
  const profile = { ...candidateProfileSchema.parse({ skills: ["Python"] }), createdAt: now.toISOString(), updatedAt: now.toISOString() };
  let evaluatorCalls = 0;
  const feed = { search: async (query: JobSearchInput) => ({ jobs: [], total: 0, page: query.page, pageSize: query.pageSize, hasNextPage: false, sources: [{ id: "remotive", name: "Remotive", status: "error" as const, fetched: 0, message: "unavailable", limitations: [] }] }) };
  const response = await request(createApp(makeRepository({ getProfile: async () => profile }), feed, async () => { evaluatorCalls++; return []; })).get("/api/job-recommendations");
  assert.equal(response.status, 200);
  assert.equal(response.body.status, "ready");
  assert.equal(response.body.sources[0].status, "error");
  assert.equal(evaluatorCalls, 0);
});

test("resume endpoint rejects unsupported types and removes temporary uploads after parser failures", async () => {
  const app = createApp(makeRepository());
  const unsupported = await request(app).post("/api/profile/resume").attach("resume", Buffer.from("plain text"), { filename: "resume.txt", contentType: "text/plain" });
  assert.equal(unsupported.status, 400); assert.equal(unsupported.body.error.code, "UNSUPPORTED_FILE");
  const invalid = await request(app).post("/api/profile/resume").attach("resume", Buffer.from("%PDF-1.4 invalid"), { filename: "resume.pdf", contentType: "application/pdf" });
  assert.equal(invalid.status, 422); assert.equal(invalid.body.error.code, "INVALID_DOCUMENT");
  const temp = path.join(tmpdir(), "applypilot-resumes");
  const files = await readdir(temp).catch(() => []);
  assert.deepEqual(files, []);
});

test("resume endpoint enforces its configured maximum upload size", async () => {
  const response = await request(createApp(makeRepository())).post("/api/profile/resume").attach("resume", Buffer.alloc(5 * 1024 * 1024 + 1), { filename: "large.pdf", contentType: "application/pdf" });
  assert.equal(response.status, 413); assert.equal(response.body.error.code, "RESUME_TOO_LARGE");
});

test("PUT /api/profile validates, creates and persists profile data", async () => {
  let persisted: CandidateProfileRecord | null = null;
  const app = createApp(makeRepository({
    getProfile: async () => persisted,
    upsertProfile: async data => { persisted = { ...data, createdAt: now.toISOString(), updatedAt: now.toISOString() }; return persisted; }
  }));
  const body: CandidateProfileInput = {
    ...candidateProfileSchema.parse({}),
    fullName: "Jordan Lee",
    skills: ["TypeScript", "React"],
    education: [{ institution: "Example University", qualification: "BSc", fieldOfStudy: "Computer Science", location: "", startDate: "2020", endDate: "2024", details: "" }],
    targetJobTitles: ["Frontend Engineer"],
    preferredCountries: ["Canada"],
    workArrangements: ["remote"]
  };
  const savedResponse = await request(app).put("/api/profile").send(body);
  assert.equal(savedResponse.status, 200);
  assert.equal(savedResponse.body.fullName, "Jordan Lee");
  assert.deepEqual(savedResponse.body.skills, ["TypeScript", "React"]);
  assert.equal(savedResponse.body.education[0].institution, "Example University");
  const loadedResponse = await request(app).get("/api/profile");
  assert.equal(loadedResponse.status, 200);
  assert.deepEqual(loadedResponse.body, savedResponse.body);
});

test("PUT /api/profile allows omitted optional data and rejects invalid input before writing", async () => {
  let writes = 0;
  const app = createApp(makeRepository({ upsertProfile: async data => { writes++; return { ...data, createdAt: now.toISOString(), updatedAt: now.toISOString() }; } }));
  const empty = await request(app).put("/api/profile").send({});
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { ...candidateProfileSchema.parse({}), createdAt: now.toISOString(), updatedAt: now.toISOString() });
  const invalid = await request(app).put("/api/profile").send({ fullName: "Too long", workArrangements: ["flexible"], minimumSalary: -5 });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "VALIDATION_ERROR");
  assert.ok(invalid.body.error.details.length >= 2);
  assert.equal(writes, 1);
});

test("profile database errors use the standard unavailable response without leaking internals", async () => {
  const app = createApp(makeRepository({ getProfile: async () => { throw new Error("secret connection detail"); } }));
  const response = await request(app).get("/api/profile");
  assert.equal(response.status, 503);
  assert.deepEqual(response.body.error, { code: "DATABASE_UNAVAILABLE", message: "The database is temporarily unavailable" });
  assert.equal(JSON.stringify(response.body).includes("secret"), false);
});

test("POST /api/applications validates and creates a record", async () => {
  let received: CreateApplicationInput | undefined;
  const app = createApp(makeRepository({ create: async data => { received = data; return record; } }));
  const response = await request(app).post("/api/applications").send({
    company: "Linear", role: "Product Designer", location: "Remote", jobUrl: "https://linear.app/careers", notes: "Follow up next week"
  });

  assert.equal(response.status, 201);
  assert.deepEqual(received, { company: "Linear", role: "Product Designer", location: "Remote", jobUrl: "https://linear.app/careers", status: "saved", notes: "Follow up next week" });
  assert.deepEqual(response.body, record);
});

test("POST /api/applications rejects invalid input before writing", async () => {
  let createCalled = false;
  const app = createApp(makeRepository({ create: async () => { createCalled = true; return record; } }));
  const response = await request(app).post("/api/applications").send({ company: "", role: "Designer", status: "pending" });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
  assert.ok(response.body.error.details.length > 0);
  assert.equal(createCalled, false);
});

test("database errors return a consistent 503 response without leaking details", async () => {
  const app = createApp(makeRepository({ list: async () => { throw new Error("password=do-not-leak"); } }));
  const response = await request(app).get("/api/applications");

  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: { code: "DATABASE_UNAVAILABLE", message: "The database is temporarily unavailable" } });
  assert.equal(JSON.stringify(response.body).includes("do-not-leak"), false);
});

test("database create failures return the same service-unavailable error", async () => {
  const app = createApp(makeRepository({ create: async () => { throw new Error("connection refused"); } }));
  const response = await request(app).post("/api/applications").send({ company: "Linear", role: "Designer" });

  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, "DATABASE_UNAVAILABLE");
  assert.equal(response.body.error.message, "The database is temporarily unavailable");
});

test("health contract reports a disconnected database without taking the API offline", async () => {
  const app = createApp(makeRepository({ ping: async () => { throw new Error("offline"); } }));
  const response = await request(app).get("/api/health");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: "ok", database: "disconnected" });
});

test("Arbeitnow normalization converts feed fields and safely strips HTML", () => {
  const normalized = normalizeArbeitnowJob({ slug: "product-designer", title: " Product Designer ", company_name: "Linear", location: "Berlin", url: "https://jobs.example/1", description: "<p>Build&nbsp;great &amp; useful things</p>", remote: true, created_at: 1792411200, tags: ["design"] });
  assert.ok(normalized);
  assert.equal(normalized.title, "Product Designer");
  assert.equal(normalized.description, "Build great & useful things");
  assert.equal(normalized.remote, true);
  assert.equal(normalized.publishedAt, "2026-10-19T12:00:00.000Z");
  assert.equal(normalizeArbeitnowJob({}), null);
});

test("GET /api/jobs validates filters and caps source pagination", async () => {
  let received: unknown;
  const app = createApp(makeRepository(), { search: async query => { received = query; return { jobs: [job], total: 1, page: query.page, pageSize: query.pageSize, hasNextPage: false }; } });
  const response = await request(app).get("/api/jobs?keyword=design&location=Berlin&remoteOnly=true&page=2&pageSize=8");
  assert.equal(response.status, 200);
  assert.deepEqual(received, { keyword: "design", location: "Berlin", country: "", remoteOnly: true, sources: "", includeMatches: false, page: 2, pageSize: 8 });
  const invalid = await request(app).get("/api/jobs?page=99");
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "VALIDATION_ERROR");
});

test("Arbeitnow location filtering is trimmed and case-insensitive before pagination", async () => {
  const pages = [
    [
      { slug: "berlin-role", title: "Engineer", company_name: "Berlin Works", location: "Berlin, Germany", url: "https://jobs.example/berlin" },
      { slug: "paris-one", title: "Designer", company_name: "Paris Studio", location: "Paris, Île-de-France, France", url: "https://jobs.example/paris-one" }
    ],
    [
      { slug: "paris-two", title: "Researcher", company_name: "Marais Labs", location: "Paris, France", url: "https://jobs.example/paris-two" },
      { slug: "london-role", title: "Engineer", company_name: "London Works", location: "London, UK", url: "https://jobs.example/london" }
    ],
    []
  ];
  const source = createArbeitnowSource(async input => {
    const page = Number(new URL(String(input)).searchParams.get("page")) - 1;
    return new Response(JSON.stringify({ data: pages[page] ?? [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const firstPage = await source.search(jobSearchSchema.parse({ location: "  pArIs  ", page: 1, pageSize: 1 }));
  const secondPage = await source.search(jobSearchSchema.parse({ location: "  pArIs  ", page: 2, pageSize: 1 }));
  assert.equal(firstPage.total, 2);
  assert.equal(firstPage.jobs[0]?.sourceId, "paris-one");
  assert.equal(firstPage.hasNextPage, true);
  assert.equal(secondPage.jobs[0]?.sourceId, "paris-two");
  assert.equal(secondPage.hasNextPage, false);

  const all = await source.search(jobSearchSchema.parse({ location: "   ", page: 1, pageSize: 10 }));
  assert.equal(all.total, 4);
  assert.equal(all.jobs.length, 4);
});

test("job source failures return a clear retryable upstream error", async () => {
  const source = createArbeitnowSource(async () => new Response("upstream unavailable", { status: 503 }));
  const app = createApp(makeRepository(), source);
  const response = await request(app).get("/api/jobs");
  assert.equal(response.status, 502);
  assert.equal(response.body.error.code, "JOB_SOURCE_UNAVAILABLE");
  assert.match(response.body.error.message, /HTTP 503/);
});

test("POST /api/saved-jobs reports duplicate saves without duplicating records", async () => {
  let writes = 0;
  const persisted = new Map<string, SavedJob>();
  const app = createApp(makeRepository({ saveJob: async data => {
    const key = `${data.source}:${data.sourceId}`;
    const existing = persisted.get(key);
    if (existing) return { job: existing, duplicate: true };
    writes++;
    persisted.set(key, saved);
    return { job: saved, duplicate: false };
  } }));
  const first = await request(app).post("/api/saved-jobs").send(job);
  const second = await request(app).post("/api/saved-jobs").send(job);
  assert.equal(first.status, 201);
  assert.equal(first.body.duplicate, false);
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(writes, 1);
  assert.equal(persisted.size, 1);
});

test("moving a saved job returns the existing tracker record when one already matches", async () => {
  let requestedId = "";
  let createdAnotherApplication = false;
  const app = createApp(makeRepository({
    create: async () => { createdAnotherApplication = true; return record; },
    moveSavedJobToApplication: async id => { requestedId = id; return { application: record, alreadyTracked: true }; }
  }));
  const response = await request(app).post("/api/saved-jobs/saved_1/move-to-application");
  assert.equal(response.status, 200);
  assert.equal(requestedId, "saved_1");
  assert.equal(response.body.alreadyTracked, true);
  assert.equal(response.body.application.id, record.id);
  assert.equal(createdAnotherApplication, false);
});

test("moving a saved job returns the newly created Application", async () => {
  let receivedId = "";
  let createCalls = 0;
  const app = createApp(makeRepository({ moveSavedJobToApplication: async id => {
    receivedId = id;
    createCalls++;
    return { application: record, alreadyTracked: false };
  } }));
  const response = await request(app).post("/api/saved-jobs/saved_1/move-to-application");
  assert.equal(response.status, 200);
  assert.equal(receivedId, "saved_1");
  assert.equal(createCalls, 1);
  assert.equal(response.body.alreadyTracked, false);
  assert.deepEqual(response.body.application, record);
});

test("move-to-application reports database failures instead of returning success", async () => {
  const app = createApp(makeRepository({ moveSavedJobToApplication: async () => { throw new Error("database unavailable"); } }));
  const response = await request(app).post("/api/saved-jobs/saved_1/move-to-application");
  assert.equal(response.status, 503);
  assert.deepEqual(response.body.error, { code: "DATABASE_UNAVAILABLE", message: "The database is temporarily unavailable" });
});
