import assert from "node:assert/strict";
import { test } from "node:test";
import type { CandidateProfileRecord, Job, JobSearchInput } from "@applypilot/shared";
import { candidateProfileSchema } from "@applypilot/shared";
import type { AssistantRepository } from "./assistantRepository.js";
import { createDiscoveryRunner, startDiscoveryScheduler } from "./discovery.js";
import type { JobAnalysisResult } from "./aiServiceClient.js";

const job: Job = {
  sourceId: "stable-id",
  source: "arbeitnow",
  sourceAttribution: "Arbeitnow",
  title: "Engineer",
  company: "Example",
  location: "Remote",
  country: null,
  workArrangement: "remote",
  url: "https://example.test/job",
  description: "TypeScript engineer",
  remote: true,
  publishedAt: null,
  tags: [],
  jobTypes: []
};

const analysis: JobAnalysisResult = {
  sourceId: job.sourceId,
  source: job.source,
  title: job.title,
  company: job.company,
  location: job.location,
  country: job.country,
  workArrangement: job.workArrangement,
  url: job.url,
  remote: job.remote,
  score: 82,
  recommendation: "potential_match",
  confidence: "medium",
  confidenceReasons: [],
  factorBreakdown: [],
  matchedEvidence: ["TypeScript"],
  missingOrUnverified: ["Work authorization unknown"],
  explanation: ["Skills overlap."]
};

const profile: CandidateProfileRecord = {
  ...candidateProfileSchema.parse({ skills: ["TypeScript"] }),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

interface TestRun {
  id: string;
  status: string;
}

function makeQueue() {
  let lockHeld = false;
  let createdCount = 0;
  const runs: TestRun[] = [];
  const seenJobs = new Set<string>();

  // This focused fake models queue behavior without constructing Prisma rows.
  const repository = {
    async tryAcquireDiscoveryLock() {
      if (lockHeld) {
        return false;
      }
      lockHeld = true;
      return true;
    },
    async releaseDiscoveryLock() {
      lockHeld = false;
    },
    async createRun() {
      const run = { id: `run-${runs.length}`, status: "running" };
      runs.push(run);
      return {
        ...run,
        startedAt: new Date(),
        finishedAt: null,
        discoveredCount: 0,
        newCount: 0,
        sourceResults: [],
        errorMessage: null
      };
    },
    async finishRun(id: string, data: {
      status: string;
      discoveredCount: number;
      newCount: number;
      sourceResults: unknown;
      errorMessage?: string | null;
    }) {
      const run = runs.find(item => item.id === id);
      assert.ok(run, "the run should exist before it is finished");
      run.status = data.status;
      return {
        ...run,
        startedAt: new Date(),
        finishedAt: new Date(),
        discoveredCount: data.discoveredCount,
        newCount: data.newCount,
        sourceResults: data.sourceResults,
        errorMessage: data.errorMessage ?? null
      };
    },
    async upsertOpportunity(item: Job) {
      const key = `${item.source}:${item.sourceId}`;
      const isNew = !seenJobs.has(key);
      if (isNew) {
        seenJobs.add(key);
        createdCount += 1;
      }
      return {
        created: isNew,
        opportunity: {
          id: key,
          source: item.source,
          sourceId: item.sourceId,
          reviewStatus: "needs_review"
        }
      };
    },
    async getDashboard() {
      return {
        runs: [],
        opportunities: [],
        preparations: [],
        emailDrafts: [],
        actions: [],
        counts: {
          opportunities: 0,
          preparations: 0,
          emailDrafts: 0,
          approved: 0,
          completed: 0,
          failed: 0,
          skipped: 0
        }
      };
    },
    async reviewOpportunity() { return null; },
    async createPreparation() { return { id: "prep", status: "needs_review" }; },
    async skipPreparation() { return null; },
    async createEmailDraft() { return { id: "draft", status: "needs_review" }; },
    async updateEmailDraft() { return null; },
    async verifyEmailRecipient() { return null; },
    async approveEmailDraft() { return null; },
    async approvePreparation() { return null; }
  } as unknown as AssistantRepository;

  return {
    repository,
    runs,
    get createdCount() {
      return createdCount;
    }
  };
}

function emptySearch(query: JobSearchInput) {
  return {
    jobs: [],
    total: 0,
    page: query.page,
    pageSize: query.pageSize,
    hasNextPage: false
  };
}

test("discovery persists evaluated jobs, source failures, and idempotent results", async () => {
  const queue = makeQueue();
  const source = {
    async search(query: JobSearchInput) {
      return {
        ...emptySearch(query),
        jobs: [job],
        total: 1,
        sources: [
          { id: "arbeitnow", name: "Arbeitnow", status: "success" as const, fetched: 1, limitations: [] },
          { id: "remotive", name: "Remotive", status: "error" as const, fetched: 0, message: "timed out", limitations: [] }
        ]
      };
    }
  };
  const runner = createDiscoveryRunner(
    queue.repository,
    async () => profile,
    source,
    async () => [analysis]
  );

  const firstRun = await runner();
  const secondRun = await runner();

  assert.equal(firstRun.newOpportunities, 1);
  assert.equal(secondRun.newOpportunities, 0);
  assert.equal(queue.createdCount, 1);
  assert.equal(firstRun.sourceResults[1]?.status, "error");
  assert.equal(queue.runs[0]?.status, "completed");
});

test("discovery rejects overlapping runs without starting a second fetch", async () => {
  const queue = makeQueue();
  let releaseFetch!: () => void;
  let fetchCount = 0;
  const fetchBlocked = new Promise<void>(resolve => {
    releaseFetch = resolve;
  });
  const source = {
    async search(query: JobSearchInput) {
      fetchCount += 1;
      await fetchBlocked;
      return emptySearch(query);
    }
  };
  const runner = createDiscoveryRunner(
    queue.repository,
    async () => profile,
    source,
    async () => []
  );

  const firstRun = runner();
  await new Promise(resolve => setTimeout(resolve, 10));

  await assert.rejects(runner(), /already in progress/);
  assert.equal(fetchCount, 1);
  releaseFetch();
  await firstRun;
});

test("an empty profile records a skipped run without fetching jobs", async () => {
  const queue = makeQueue();
  let fetchCount = 0;
  const source = {
    async search(query: JobSearchInput) {
      fetchCount += 1;
      return emptySearch(query);
    }
  };
  const emptyProfile = candidateProfileSchema.parse({});
  const runner = createDiscoveryRunner(
    queue.repository,
    async () => emptyProfile,
    source,
    async () => []
  );

  await assert.rejects(runner(), /Complete your candidate profile/);

  assert.equal(fetchCount, 0);
  assert.equal(queue.runs[0]?.status, "skipped");
});

test("the scheduler starts only one local timer and does not run immediately", async () => {
  let runCount = 0;
  const stopFirstScheduler = startDiscoveryScheduler(async () => {
    runCount += 1;
  }, 0.01);
  const stopDuplicateScheduler = startDiscoveryScheduler(async () => {
    runCount += 100;
  }, 0.01);

  await new Promise(resolve => setTimeout(resolve, 650));
  stopFirstScheduler();
  stopDuplicateScheduler();

  assert.equal(runCount, 1);
});
