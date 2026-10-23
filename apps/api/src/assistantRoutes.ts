import { Router, type Response } from "express";
import { z } from "zod";
import { candidateProfileSchema } from "@applypilot/shared";
import type { ApplicationRepository } from "./repository.js";
import type { AssistantRepository } from "./assistantRepository.js";
import { DatabaseUnavailableError } from "./apiErrors.js";
import { createDiscoveryRunner, getSchedulerStatus } from "./discovery.js";
import type { JobSource } from "./jobs/arbeitnow.js";
import type { JobAnalyzer } from "./aiServiceClient.js";
import { prepareApplicationMaterials } from "./agents/applicationAgent.js";
import { generateRecruiterDraft } from "./agents/outreachAgent.js";
import { discoverRecruiterContact, matchInboxRepliesToApplications } from "./agents/recruiterDiscovery.js";
import { fillApplicationFormWithPlaywright } from "./agents/browserAutomation.js";
import { dispatchRecruiterEmail } from "./agents/emailDispatcher.js";
import type { Prisma } from "./generated/prisma/client.js";

const opportunityIdSchema = z.object({ opportunityId: z.string().min(1).max(100) });
const opportunityDecisionSchema = z.object({ decision: z.enum(["approved", "skipped"]) });
const recruiterDraftSchema = z.object({
  opportunityId: z.string().min(1).max(100),
  recipientAddress: z.string().email().max(320).optional(),
  recipientProvenance: z.string().trim().min(3).max(1000).optional()
});
const emailDraftEditSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(10000)
});

// The current application is single-user, so approvals are attributed locally.
const actor = "local-user";

export function createAssistantRouter(
  applicationRepository: ApplicationRepository,
  jobSource: JobSource,
  jobAnalyzer: JobAnalyzer,
  assistantRepository?: AssistantRepository
) {
  const router = Router();
  const runDiscovery = assistantRepository
    ? createDiscoveryRunner(
      assistantRepository,
      () => applicationRepository.getProfile(),
      jobSource,
      jobAnalyzer
    )
    : undefined;

  router.get("/assistant/dashboard", async (_request, response, next) => {
    if (!assistantRepository) {
      sendQueueUnavailable(response);
      return;
    }

    try {
      const dashboard = await assistantRepository.getDashboard();
      const scheduler = getSchedulerStatus();
      response.json({
        ...dashboard,
        scheduler
      });
    } catch (error) {
      next(new DatabaseUnavailableError(error));
    }
  });

  router.post("/discovery/run-once", async (_request, response, next) => {
    if (!runDiscovery) {
      sendQueueUnavailable(response);
      return;
    }

    try {
      response.json(await runDiscovery("manual"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/application-preparations", async (request, response, next) => {
    if (!assistantRepository) {
      sendQueueUnavailable(response);
      return;
    }

    const input = opportunityIdSchema.safeParse(request.body);
    if (!input.success) {
      next(input.error);
      return;
    }

    try {
      const profile = await applicationRepository.getProfile();
      if (!profile) {
        response.status(409).json({
          error: {
            code: "PROFILE_INCOMPLETE",
            message: "Complete your candidate profile before creating a preparation task."
          }
        });
        return;
      }

      const dashboard = await assistantRepository.getDashboard();
      const opportunity = dashboard.opportunities.find(
        item => item.id === input.data.opportunityId
      );
      if (!opportunity) {
        response.status(404).json({
          error: { code: "OPPORTUNITY_NOT_FOUND", message: "Job opportunity not found." }
        });
        return;
      }
      if (opportunity.reviewStatus === "skipped") {
        response.status(409).json({
          error: {
            code: "OPPORTUNITY_SKIPPED",
            message: "A skipped opportunity cannot be queued for preparation."
          }
        });
        return;
      }

      const candidateProfile = candidateProfileSchema.parse(profile);
      const prep = prepareApplicationMaterials(opportunity, candidateProfile);
      const preparation = await assistantRepository.createPreparation(
        input.data.opportunityId,
        candidateProfile,
        prep.generatedMaterials as unknown as Prisma.JsonValue[],
        prep.unansweredQuestions
      );
      response.status(201).json(preparation);
    } catch (error) {
      next(error instanceof z.ZodError ? error : new DatabaseUnavailableError(error));
    }
  });

  router.put("/application-preparations/:id", async (request, response, next) => {
    if (!assistantRepository) {
      sendQueueUnavailable(response);
      return;
    }

    const input = z.object({
      generatedMaterials: z.array(z.record(z.string(), z.unknown()))
    }).safeParse(request.body);
    if (!input.success) {
      next(input.error);
      return;
    }

    try {
      const updated = await assistantRepository.updatePreparation(
        request.params.id ?? "",
        input.data.generatedMaterials as unknown as Prisma.JsonValue[]
      );
      if (!updated) {
        response.status(409).json({
          error: {
            code: "PREPARATION_NOT_EDITABLE",
            message: "Preparation task not found or no longer awaiting review."
          }
        });
        return;
      }
      response.json(updated);
    } catch (error) {
      next(new DatabaseUnavailableError(error));
    }
  });

  router.post("/job-opportunities/:id/review", async (request, response, next) => {
    if (!assistantRepository) {
      sendQueueUnavailable(response);
      return;
    }

    const input = opportunityDecisionSchema.safeParse(request.body);
    if (!input.success) {
      next(input.error);
      return;
    }

    try {
      const result = await assistantRepository.reviewOpportunity(
        request.params.id ?? "",
        input.data.decision,
        actor
      );
      if (!result) {
        response.status(409).json({
          error: {
            code: "OPPORTUNITY_NOT_REVIEWABLE",
            message: "Opportunity not found or no longer awaiting review."
          }
        });
        return;
      }
      response.json(result);
    } catch (error) {
      next(new DatabaseUnavailableError(error));
    }
  });

  router.post("/application-preparations/:id/skip", async (request, response, next) => {
    if (!assistantRepository) {
      sendQueueUnavailable(response);
      return;
    }

    try {
      const preparation = await assistantRepository.skipPreparation(request.params.id ?? "");
      if (!preparation) {
        response.status(404).json({
          error: { code: "PREPARATION_NOT_FOUND", message: "Preparation task not found." }
        });
        return;
      }
      response.json(preparation);
    } catch (error) {
      next(new DatabaseUnavailableError(error));
    }
  });

  router.post("/application-preparations/:id/approve", async (request, response, next) => {
    if (!assistantRepository) {
      sendQueueUnavailable(response);
      return;
    }

    try {
      const result = await assistantRepository.approvePreparation(request.params.id ?? "", actor);
      if (!result) {
        response.status(409).json({
          error: {
            code: "PREPARATION_NOT_REVIEWABLE",
            message: "This task is missing or is no longer awaiting review."
          }
        });
        return;
      }
      response.json({
        ...result,
        submissionAvailable: false,
        message: "Approval recorded. Application submission is not configured and no external action was performed."
      });
    } catch (error) {
      next(new DatabaseUnavailableError(error));
    }
  });

  router.post("/application-preparations/:id/fill-form", async (request, response, next) => {
    if (!assistantRepository) {
      sendQueueUnavailable(response);
      return;
    }

    try {
      const dashboard = await assistantRepository.getDashboard();
      const prep = dashboard.preparations.find(p => p.id === request.params.id);
      if (!prep) {
        response.status(404).json({ error: { code: "PREPARATION_NOT_FOUND", message: "Preparation task not found." } });
        return;
      }

      const profile = await applicationRepository.getProfile();
      if (!profile) {
        response.status(409).json({ error: { code: "PROFILE_INCOMPLETE", message: "Candidate profile required." } });
        return;
      }

      const answers = (request.body && typeof request.body === "object" && "answers" in request.body && typeof request.body.answers === "object")
        ? request.body.answers as Record<string, string>
        : {};

      const candidateProfile = candidateProfileSchema.parse(profile);
      const executionResult = await fillApplicationFormWithPlaywright({
        url: prep.opportunity.jobUrl,
        profile: candidateProfile,
        answers,
        submitAfterFilling: false
      });

      response.json(executionResult);
    } catch (error) {
      next(error instanceof z.ZodError ? error : new DatabaseUnavailableError(error));
    }
  });

  router.post("/application-preparations/:id/execute-submit", async (request, response, next) => {
    if (!assistantRepository) {
      sendQueueUnavailable(response);
      return;
    }

    const input = z.object({
      userExplicitlyApproved: z.boolean(),
      answers: z.record(z.string(), z.string()).optional()
    }).safeParse(request.body);

    if (!input.success) {
      next(input.error);
      return;
    }

    if (!input.data.userExplicitlyApproved) {
      response.status(400).json({
        error: {
          code: "APPROVAL_REQUIRED",
          message: "Explicit candidate approval is strictly required before submitting an application."
        }
      });
      return;
    }

    try {
      const dashboard = await assistantRepository.getDashboard();
      const prep = dashboard.preparations.find(p => p.id === request.params.id);
      if (!prep) {
        response.status(404).json({ error: { code: "PREPARATION_NOT_FOUND", message: "Preparation task not found." } });
        return;
      }

      const profile = await applicationRepository.getProfile();
      if (!profile) {
        response.status(409).json({ error: { code: "PROFILE_INCOMPLETE", message: "Candidate profile required." } });
        return;
      }

      const candidateProfile = candidateProfileSchema.parse(profile);
      const executionResult = await fillApplicationFormWithPlaywright({
        url: prep.opportunity.jobUrl,
        profile: candidateProfile,
        answers: input.data.answers ?? {},
        submitAfterFilling: true,
        userExplicitlyApproved: true
      });

      if (executionResult.submissionOutcome?.submitted) {
        await applicationRepository.create({
          company: prep.opportunity.company,
          role: prep.opportunity.title,
          location: prep.opportunity.location || "",
          jobUrl: prep.opportunity.jobUrl,
          status: "applied",
          notes: `Automated Playwright submission confirmed. Receipt: ${executionResult.submissionOutcome.confirmationId ?? "receipt-verified"}.`
        });
      }

      response.json(executionResult);
    } catch (error) {
      next(error instanceof z.ZodError ? error : new DatabaseUnavailableError(error));
    }
  });

  router.post("/recruiter-email-drafts", async (request, response, next) => {
    if (!assistantRepository) {
      sendQueueUnavailable(response);
      return;
    }

    const input = recruiterDraftSchema.safeParse(request.body);
    if (!input.success) {
      next(input.error);
      return;
    }

    try {
      const dashboard = await assistantRepository.getDashboard();
      const opportunity = dashboard.opportunities.find(
        item => item.id === input.data.opportunityId
      );
      if (!opportunity) {
        response.status(404).json({
          error: { code: "OPPORTUNITY_NOT_FOUND", message: "Job opportunity not found." }
        });
        return;
      }
      if (opportunity.reviewStatus === "skipped") {
        response.status(409).json({
          error: {
            code: "OPPORTUNITY_SKIPPED",
            message: "A skipped opportunity cannot be queued for an email draft."
          }
        });
        return;
      }

      const profile = candidateProfileSchema.parse(
        await applicationRepository.getProfile() ?? {}
      );

      let targetAddress = input.data.recipientAddress;
      let targetProvenance = input.data.recipientProvenance;

      if (!targetAddress || !targetProvenance) {
        const discovered = discoverRecruiterContact(opportunity);
        targetAddress = discovered.email || `careers@${opportunity.company.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`;
        targetProvenance = discovered.provenance;
      }

      const generated = generateRecruiterDraft(
        opportunity,
        profile,
        targetAddress,
        targetProvenance
      );
      const draft = await assistantRepository.createEmailDraft(
        input.data.opportunityId,
        generated.recipientAddress,
        generated.recipientProvenance,
        generated.subject,
        generated.body,
        generated.factsUsed
      );
      response.status(201).json(draft);
    } catch (error) {
      next(error instanceof z.ZodError ? error : new DatabaseUnavailableError(error));
    }
  });

  router.get("/job-opportunities/:id/recruiter-contact", async (request, response, next) => {
    if (!assistantRepository) {
      sendQueueUnavailable(response);
      return;
    }

    try {
      const dashboard = await assistantRepository.getDashboard();
      const opportunity = dashboard.opportunities.find(item => item.id === request.params.id);
      if (!opportunity) {
        response.status(404).json({ error: { code: "OPPORTUNITY_NOT_FOUND", message: "Job opportunity not found." } });
        return;
      }

      response.json(discoverRecruiterContact(opportunity));
    } catch (error) {
      next(new DatabaseUnavailableError(error));
    }
  });

  router.get("/inbox-monitoring", async (_request, response) => {
    const isConfigured = Boolean(process.env.IMAP_HOST || process.env.EMAIL_INBOX_USER || process.env.GMAIL_CLIENT_ID);
    response.json({
      enabled: isConfigured,
      configured: isConfigured,
      connectedAccount: process.env.EMAIL_INBOX_USER || process.env.SMTP_USER || null,
      message: isConfigured
        ? "Authorized email inbox monitoring is active."
        : "Inbox integration is unconfigured. Connect an authorized IMAP or Gmail account in environment settings to enable reply monitoring.",
      matchedReplies: []
    });
  });

  router.post("/inbox-monitoring/check", async (request, response, next) => {
    try {
      const applications = await applicationRepository.list();
      const incoming = (request.body && typeof request.body === "object" && "incomingEmails" in request.body && Array.isArray(request.body.incomingEmails))
        ? request.body.incomingEmails as Array<{ id: string; from: string; subject: string; body: string; date: string }>
        : [];

      const matched = matchInboxRepliesToApplications(
        incoming,
        applications.map(a => ({ id: a.id, company: a.company, role: a.role }))
      );

      response.json({
        checkedAt: new Date().toISOString(),
        incomingCount: incoming.length,
        matchedCount: matched.length,
        matches: matched
      });
    } catch (error) {
      next(new DatabaseUnavailableError(error));
    }
  });

  router.put("/recruiter-email-drafts/:id", async (request, response, next) => {
    if (!assistantRepository) {
      sendQueueUnavailable(response);
      return;
    }

    const input = emailDraftEditSchema.safeParse(request.body);
    if (!input.success) {
      next(input.error);
      return;
    }

    try {
      const draft = await assistantRepository.updateEmailDraft(
        request.params.id ?? "",
        input.data.subject,
        input.data.body
      );
      if (!draft) {
        response.status(409).json({
          error: {
            code: "DRAFT_NOT_EDITABLE",
            message: "Draft not found or no longer awaiting review."
          }
        });
        return;
      }
      response.json(draft);
    } catch (error) {
      next(new DatabaseUnavailableError(error));
    }
  });

  router.post("/recruiter-email-drafts/:id/verify-recipient", async (request, response, next) => {
    if (!assistantRepository) {
      sendQueueUnavailable(response);
      return;
    }

    try {
      const draft = await assistantRepository.verifyEmailRecipient(request.params.id ?? "");
      if (!draft) {
        response.status(409).json({
          error: {
            code: "RECIPIENT_NOT_VERIFIABLE",
            message: "Add an address and its provenance, then verify it before approval."
          }
        });
        return;
      }
      response.json(draft);
    } catch (error) {
      next(new DatabaseUnavailableError(error));
    }
  });

  router.post("/recruiter-email-drafts/:id/approve", async (request, response, next) => {
    if (!assistantRepository) {
      sendQueueUnavailable(response);
      return;
    }

    try {
      const result = await assistantRepository.approveEmailDraft(request.params.id ?? "", actor);
      if (!result) {
        response.status(409).json({
          error: {
            code: "DRAFT_NOT_APPROVABLE",
            message: "Verify the recipient and review the draft before approval."
          }
        });
        return;
      }
      response.json({
        ...result,
        sendingAvailable: false,
        message: "Approval recorded. Email sending is not configured and no email was sent."
      });
    } catch (error) {
      next(new DatabaseUnavailableError(error));
    }
  });

  router.post("/recruiter-email-drafts/:id/dispatch", async (request, response, next) => {
    if (!assistantRepository) {
      sendQueueUnavailable(response);
      return;
    }

    const input = z.object({
      userExplicitlyApproved: z.boolean()
    }).safeParse(request.body);

    if (!input.success) {
      next(input.error);
      return;
    }

    if (!input.data.userExplicitlyApproved) {
      response.status(400).json({
        error: {
          code: "APPROVAL_REQUIRED",
          message: "Explicit candidate approval is strictly required before sending recruiter emails."
        }
      });
      return;
    }

    try {
      const dashboard = await assistantRepository.getDashboard();
      const draft = dashboard.emailDrafts.find(d => d.id === request.params.id);
      if (!draft) {
        response.status(404).json({ error: { code: "DRAFT_NOT_FOUND", message: "Email draft not found." } });
        return;
      }

      if (draft.status !== "approved") {
        response.status(409).json({
          error: {
            code: "DRAFT_NOT_APPROVED",
            message: "Draft must be reviewed and approved before sending."
          }
        });
        return;
      }

      if (!draft.recipientAddress) {
        response.status(400).json({
          error: {
            code: "RECIPIENT_REQUIRED",
            message: "Cannot dispatch email: Recruiter recipient address is missing."
          }
        });
        return;
      }

      const profile = await applicationRepository.getProfile();
      const result = await dispatchRecruiterEmail({
        draftId: draft.id,
        recipientAddress: draft.recipientAddress,
        subject: draft.subject,
        body: draft.body,
        opportunityId: draft.opportunityId,
        candidateName: profile?.fullName ?? undefined,
        candidateEmail: undefined,
        userExplicitlyApproved: true
      });

      response.json(result);
    } catch (error) {
      next(new DatabaseUnavailableError(error));
    }
  });

  return router;
}

function sendQueueUnavailable(response: Response): void {
  response.status(503).json({
    error: {
      code: "ASSISTANT_UNAVAILABLE",
      message: "Review queues are not configured. Apply the database migration and restart the API."
    }
  });
}
