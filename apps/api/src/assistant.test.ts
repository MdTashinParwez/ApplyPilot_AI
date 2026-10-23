import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import {
  candidateProfileSchema,
  type CandidateProfileRecord,
  type JobSearchInput
} from "@applypilot/shared";
import { createApp } from "./app.js";
import type { AssistantRepository, DiscoveryRunUpdate } from "./assistantRepository.js";
import { profileFactsForReview } from "./database.js";
import type { ApplicationRepository } from "./repository.js";

const profile: CandidateProfileRecord = {
  ...candidateProfileSchema.parse({ fullName: "Jordan Lee", skills: ["TypeScript"] }),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const opportunity = {
  id: "opp-1",
  source: "arbeitnow",
  sourceId: "job-1",
  title: "Engineer",
  company: "Example",
  jobUrl: "https://example.test/job",
  reviewStatus: "needs_review"
};

test("profile review snapshots keep only the declared candidate facts", () => {
  const profileInput = candidateProfileSchema.parse({
    fullName: "Jordan Lee",
    skills: ["TypeScript"],
    resumeText: "private resume body",
    preferredLocations: ["Remote"],
    workAuthorization: "Unknown"
  });

  assert.deepEqual(profileFactsForReview(profileInput), {
    fullName: "Jordan Lee",
    professionalSummary: "",
    skills: ["TypeScript"],
    education: [],
    experience: [],
    projects: [],
    targetJobTitles: [],
    workAuthorization: "Unknown"
  });
});

interface TestQueueItem {
  id: string;
  status: string;
  opportunityId?: string;
  unansweredQuestions?: string[];
  recipientAddress?: string;
  recipientProvenance?: string;
  subject?: string;
  body?: string;
  factsUsed?: string[];
  recipientVerified?: boolean;
  verifiedAt?: string;
  approvedBy?: string;
  actionType?: string;
}

function createTestAssistantRepository(): AssistantRepository {
  const preparations = new Map<string, TestQueueItem>();
  const drafts = new Map<string, TestQueueItem>();
  const actions = new Map<string, TestQueueItem>();

  const baseDashboard = {
    runs: [],
    opportunities: [opportunity],
    preparations: [],
    emailDrafts: [],
    actions: [],
    counts: {
      opportunities: 1,
      preparations: 0,
      emailDrafts: 0,
      approved: 0,
      completed: 0,
      failed: 0,
      skipped: 0
    }
  };

  // These route tests use a narrow in-memory fake rather than generated Prisma rows.
  const fake = {
    async tryAcquireDiscoveryLock() {
      return true;
    },
    async releaseDiscoveryLock() {},
    async createRun() {
      return {
        id: "run-1",
        status: "running",
        startedAt: new Date(),
        finishedAt: null,
        discoveredCount: 0,
        newCount: 0,
        sourceResults: [],
        errorMessage: null
      };
    },
    async finishRun(_id: string, data: DiscoveryRunUpdate) {
      return {
        id: "run-1",
        ...data,
        startedAt: new Date(),
        finishedAt: new Date(),
        errorMessage: data.errorMessage ?? null
      };
    },
    async upsertOpportunity() {
      return { opportunity, created: false };
    },
    async getDashboard() {
      return {
        ...baseDashboard,
        preparations: [...preparations.values()],
        emailDrafts: [...drafts.values()],
        actions: [...actions.values()]
      };
    },
    async reviewOpportunity(id: string, decision: "approved" | "skipped", actor: string) {
      if (id !== opportunity.id || opportunity.reviewStatus !== "needs_review") {
        return null;
      }

      opportunity.reviewStatus = decision;
      const action = {
        id: "job-review-1",
        actionType: "job_opportunity_review",
        status: decision,
        approvedBy: actor
      };
      actions.set(action.id, action);
      return { opportunity, action };
    },
    async createPreparation(opportunityId: string) {
      if (![...preparations.values()].some(item => item.opportunityId === opportunityId)) {
        preparations.set("prep-1", {
          id: "prep-1",
          opportunityId,
          status: "needs_review",
          unansweredQuestions: ["Verify work authorization"]
        });
      }
      return preparations.get("prep-1")!;
    },
    async skipPreparation(id: string) {
      const preparation = preparations.get(id);
      if (!preparation) {
        return null;
      }
      preparation.status = "skipped";
      return preparation;
    },
    async updatePreparation(id: string, generatedMaterials: any[]) {
      const preparation = preparations.get(id);
      if (!preparation || preparation.status !== "needs_review") {
        return null;
      }
      (preparation as any).generatedMaterials = generatedMaterials;
      return preparation as any;
    },
    async createEmailDraft(
      opportunityId: string,
      recipientAddress: string,
      recipientProvenance: string,
      subject: string,
      body: string,
      factsUsed: string[]
    ) {
      if (drafts.size === 0) {
        drafts.set("draft-1", {
          id: "draft-1",
          opportunityId,
          recipientAddress,
          recipientProvenance,
          subject,
          body,
          factsUsed,
          recipientVerified: false,
          status: "needs_review"
        });
      }
      return drafts.get("draft-1")!;
    },
    async updateEmailDraft(id: string, subject: string, body: string) {
      const draft = drafts.get(id);
      if (!draft || draft.status !== "needs_review") {
        return null;
      }
      draft.subject = subject;
      draft.body = body;
      return draft;
    },
    async verifyEmailRecipient(id: string) {
      const draft = drafts.get(id);
      if (!draft?.recipientAddress || !draft.recipientProvenance) {
        return null;
      }
      draft.recipientVerified = true;
      draft.verifiedAt = new Date().toISOString();
      return draft;
    },
    async approveEmailDraft(id: string, actor: string) {
      const draft = drafts.get(id);
      if (!draft || draft.status !== "needs_review" || !draft.recipientVerified) {
        return null;
      }

      draft.status = "approved";
      draft.approvedBy = actor;
      const action = {
        id: `email-action-${id}`,
        actionType: "send_email",
        status: "approved",
        approvedBy: actor
      };
      actions.set(action.id, action);
      return { draft, action };
    },
    async approvePreparation(id: string, actor: string) {
      const preparation = preparations.get(id);
      if (!preparation || preparation.status !== "needs_review") {
        return null;
      }

      preparation.status = "approved";
      const action = {
        id: `preparation-action-${id}`,
        actionType: "application_preparation_review",
        status: "approved",
        approvedBy: actor
      };
      actions.set(action.id, action);
      return { preparation, action };
    }
  };

  return fake as unknown as AssistantRepository;
}

function createApplicationRepository(): ApplicationRepository {
  return {
    async list() {
      return [];
    },
    async create() {
      throw new Error("Not used by these tests.");
    },
    async listSavedJobs() {
      return [];
    },
    async saveJob() {
      throw new Error("Not used by these tests.");
    },
    async moveSavedJobToApplication() {
      return null;
    },
    async getProfile() {
      return profile;
    },
    async upsertProfile() {
      return profile;
    },
    async ping() {}
  };
}

function createTestApp(assistantRepository: AssistantRepository) {
  const source = {
    async search(query: JobSearchInput) {
      return {
        jobs: [],
        total: 0,
        page: query.page,
        pageSize: query.pageSize,
        hasNextPage: false
      };
    }
  };

  return createApp(
    createApplicationRepository(),
    source,
    async () => [],
    assistantRepository
  );
}

test("email drafts can be edited, require recipient verification, and do not send on approval", async () => {
  const repository = createTestAssistantRepository();
  const app = createTestApp(repository);

  const invalid = await request(app)
    .post("/api/recruiter-email-drafts")
    .send({
      opportunityId: "opp-1",
      recipientAddress: "not-an-email",
      recipientProvenance: "Company careers page"
    });
  assert.equal(invalid.status, 400);

  const created = await request(app)
    .post("/api/recruiter-email-drafts")
    .send({
      opportunityId: "opp-1",
      recipientAddress: "recruiter@example.test",
      recipientProvenance: "Address shown on company careers page"
    });
  assert.equal(created.status, 201);
  assert.equal(created.body.recipientVerified, false);
  assert.match(created.body.body, /Jordan Lee/);

  const edited = await request(app)
    .put(`/api/recruiter-email-drafts/${created.body.id}`)
    .send({ subject: "Updated subject", body: "Reviewed message" });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.body, "Reviewed message");

  const blockedApproval = await request(app)
    .post(`/api/recruiter-email-drafts/${created.body.id}/approve`);
  assert.equal(blockedApproval.status, 409);

  await request(app)
    .post(`/api/recruiter-email-drafts/${created.body.id}/verify-recipient`);
  const approved = await request(app)
    .post(`/api/recruiter-email-drafts/${created.body.id}/approve`);
  assert.equal(approved.status, 200);
  assert.equal(approved.body.sendingAvailable, false);
  assert.equal(approved.body.action.approvedBy, "local-user");
  assert.match(approved.body.message, /no email was sent/);

  const duplicateApproval = await request(app)
    .post(`/api/recruiter-email-drafts/${created.body.id}/approve`);
  assert.equal(duplicateApproval.status, 409);
  assert.equal((await request(app).post("/api/recruiter-email-drafts/draft-1/send")).status, 404);
});

test("preparation approval is recorded once and never submits an application", async () => {
  const repository = createTestAssistantRepository();
  const app = createTestApp(repository);
  const created = await request(app)
    .post("/api/application-preparations")
    .send({ opportunityId: "opp-1" });
  assert.equal(created.status, 201);
  assert.equal(created.body.submissionAvailable, undefined);

  const approved = await request(app)
    .post(`/api/application-preparations/${created.body.id}/approve`);
  assert.equal(approved.status, 200);
  assert.equal(approved.body.submissionAvailable, false);
  assert.match(approved.body.message, /no external action/);

  const repeatedApproval = await request(app)
    .post(`/api/application-preparations/${created.body.id}/approve`);
  assert.equal(repeatedApproval.status, 409);
  assert.equal((await request(app).post(`/api/application-preparations/${created.body.id}/submit`)).status, 404);
});

test("opportunity review decisions are recorded once and validated", async () => {
  const repository = createTestAssistantRepository();
  const app = createTestApp(repository);

  const approved = await request(app)
    .post("/api/job-opportunities/opp-1/review")
    .send({ decision: "approved" });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.action.approvedBy, "local-user");

  const repeatedReview = await request(app)
    .post("/api/job-opportunities/opp-1/review")
    .send({ decision: "approved" });
  assert.equal(repeatedReview.status, 409);

  const invalidDecision = await request(app)
    .post("/api/job-opportunities/opp-1/review")
    .send({ decision: "completed" });
  assert.equal(invalidDecision.status, 400);
});
