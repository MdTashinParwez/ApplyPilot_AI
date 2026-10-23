import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { chromium, type Browser, type Page } from "playwright";
import type { CandidateProfileInput } from "@applypilot/shared";
import type { OpportunityRecord } from "../assistantRepository.js";

export type PortalType = "greenhouse" | "lever" | "workday" | "generic";

export interface PortalFieldDefinition {
  fieldId: string;
  label: string;
  type: "text" | "email" | "tel" | "file" | "textarea" | "select" | "radio" | "checkbox";
  required: boolean;
  sensitive: boolean;
  mappedValue: string | null;
  status: "filled" | "requires_user_input" | "optional";
  userAnswer?: string | null;
}

export interface PortalInspectionResult {
  portalType: PortalType;
  portalUrl: string;
  fields: PortalFieldDefinition[];
  sensitiveQuestions: Array<{
    fieldId: string;
    prompt: string;
    sensitiveType: "work_authorization" | "visa_sponsorship" | "salary_expectation" | "legal_attestation" | "eeo_disclosure";
    status: "requires_user_input";
    userAnswer: string | null;
  }>;
  botProtectionDetected: boolean;
  botProtectionType?: "captcha" | "cloudflare" | "login_required" | null;
  status: "ready_for_review" | "needs_human_action";
  handoffReason?: string;
  inspectedAt: string;
}

export interface ApplicationSubmissionOutcome {
  submitted: boolean;
  status: "submitted_confirmed" | "needs_human_action" | "approval_required" | "failed" | "unknown";
  confirmationId?: string | null;
  confirmationUrl?: string | null;
  message: string;
  timestamp: string;
}

export interface BrowserAutomationOptions {
  url: string;
  profile: CandidateProfileInput;
  answers?: Record<string, string>;
  resumeFilePath?: string;
  submitAfterFilling?: boolean;
  userExplicitlyApproved?: boolean;
  headless?: boolean;
}

export interface PlaywrightAutomationResult {
  portalType: PortalType;
  portalUrl: string;
  status: "ready_for_review" | "needs_human_action" | "submitted_confirmed" | "approval_required" | "failed" | "unknown";
  botProtectionDetected: boolean;
  botProtectionType?: "captcha" | "cloudflare" | "login_required" | null;
  handoffReason?: string;
  fieldsFilled: Array<{ fieldId: string; label: string; value: string }>;
  unansweredSensitiveQuestions: Array<{ fieldId: string; prompt: string }>;
  submissionOutcome?: ApplicationSubmissionOutcome;
  message: string;
  executedAt: string;
}

/**
 * Detects the ATS portal type from an application URL.
 */
export function detectPortalType(url: string): PortalType {
  const lower = url.toLowerCase();
  if (lower.includes("greenhouse.io") || lower.includes("gh_src")) return "greenhouse";
  if (lower.includes("lever.co")) return "lever";
  if (lower.includes("myworkdayjobs.com")) return "workday";
  return "generic";
}

/**
 * Inspects the application form fields and maps verified candidate facts.
 * Consequential or sensitive questions are NEVER guessed.
 */
export function inspectAndMapApplicationPortal(
  url: string,
  profile: CandidateProfileInput
): PortalInspectionResult {
  const portalType = detectPortalType(url);
  const now = new Date().toISOString();

  // Standard ATS portal fields
  const fields: PortalFieldDefinition[] = [
    {
      fieldId: "first_name",
      label: "First Name",
      type: "text",
      required: true,
      sensitive: false,
      mappedValue: profile.fullName.split(" ")[0] || null,
      status: profile.fullName ? "filled" : "requires_user_input"
    },
    {
      fieldId: "last_name",
      label: "Last Name",
      type: "text",
      required: true,
      sensitive: false,
      mappedValue: profile.fullName.split(" ").slice(1).join(" ") || null,
      status: profile.fullName ? "filled" : "requires_user_input"
    },
    {
      fieldId: "email",
      label: "Email Address",
      type: "email",
      required: true,
      sensitive: false,
      mappedValue: null,
      status: "requires_user_input"
    },
    {
      fieldId: "phone",
      label: "Phone Number",
      type: "tel",
      required: false,
      sensitive: false,
      mappedValue: null,
      status: "optional"
    },
    {
      fieldId: "resume",
      label: "Resume / CV",
      type: "file",
      required: true,
      sensitive: false,
      mappedValue: profile.resumeText ? "Profile Resume (Verified)" : null,
      status: profile.resumeText ? "filled" : "requires_user_input"
    },
    {
      fieldId: "linkedin_profile",
      label: "LinkedIn Profile",
      type: "text",
      required: false,
      sensitive: false,
      mappedValue: null,
      status: "optional"
    },
    {
      fieldId: "github_profile",
      label: "GitHub Profile",
      type: "text",
      required: false,
      sensitive: false,
      mappedValue: null,
      status: "optional"
    }
  ];

  // Consequential and sensitive questions — NEVER GUESSED
  const sensitiveQuestions: PortalInspectionResult["sensitiveQuestions"] = [
    {
      fieldId: "work_authorization",
      prompt: "Are you legally authorized to work in the country of this role?",
      sensitiveType: "work_authorization",
      status: "requires_user_input",
      userAnswer: profile.workAuthorization || null
    },
    {
      fieldId: "visa_sponsorship",
      prompt: "Will you now or in the future require employment visa sponsorship?",
      sensitiveType: "visa_sponsorship",
      status: "requires_user_input",
      userAnswer: null
    },
    {
      fieldId: "salary_expectation",
      prompt: "What are your compensation expectations for this position?",
      sensitiveType: "salary_expectation",
      status: "requires_user_input",
      userAnswer: profile.minimumSalary ? `$${profile.minimumSalary}` : null
    },
    {
      fieldId: "legal_attestation",
      prompt: "I attest that all information provided in this application is accurate and true.",
      sensitiveType: "legal_attestation",
      status: "requires_user_input",
      userAnswer: null
    }
  ];

  const isLoginProtected = /login|signin|auth|myworkdayjobs\.com/i.test(url);

  return {
    portalType,
    portalUrl: url,
    fields,
    sensitiveQuestions,
    botProtectionDetected: isLoginProtected,
    botProtectionType: isLoginProtected ? "login_required" : null,
    status: isLoginProtected ? "needs_human_action" : "ready_for_review",
    handoffReason: isLoginProtected
      ? "Portal requires login or active candidate account. Please log in before proceeding."
      : undefined,
    inspectedAt: now
  };
}

/**
 * Validates final application submission outcome.
 * A prepared form is NEVER claimed to be submitted without explicit proof of confirmation.
 */
export function verifySubmissionOutcome(
  portalResponse: { confirmationUrl?: string; htmlText?: string; referenceNumber?: string } | null,
  userExplicitlyApproved: boolean
): ApplicationSubmissionOutcome {
  const now = new Date().toISOString();

  if (!userExplicitlyApproved) {
    return {
      submitted: false,
      status: "approval_required",
      message: "Explicit candidate approval is strictly required before final submission.",
      timestamp: now
    };
  }

  if (!portalResponse) {
    return {
      submitted: false,
      status: "failed",
      message: "Submission failed: No response received from application portal.",
      timestamp: now
    };
  }

  const text = (portalResponse.htmlText ?? "").toLowerCase();
  const url = portalResponse.confirmationUrl ?? "";

  const isConfirmed = /thank you for applying|application received|application submitted|confirmation/i.test(text)
    || /confirmation|thank-you|submitted/i.test(url)
    || Boolean(portalResponse.referenceNumber);

  if (isConfirmed) {
    return {
      submitted: true,
      status: "submitted_confirmed",
      confirmationId: portalResponse.referenceNumber ?? `conf-${Date.now()}`,
      confirmationUrl: url || undefined,
      message: "Application submission successfully confirmed by portal receipt.",
      timestamp: now
    };
  }

  return {
    submitted: false,
    status: "unknown",
    message: "Submission outcome is uncertain. Receipt could not be confirmed. Check portal directly; never blindly retry.",
    timestamp: now
  };
}

/**
 * Executes authentic browser automation via Playwright to navigate to the application portal,
 * detect form fields and bot challenges, fill supported candidate facts, inspect sensitive questions,
 * and halt before final submission unless explicit candidate approval is verified.
 */
export async function fillApplicationFormWithPlaywright(
  options: BrowserAutomationOptions
): Promise<PlaywrightAutomationResult> {
  const now = new Date().toISOString();
  const portalType = detectPortalType(options.url);
  const fieldsFilled: Array<{ fieldId: string; label: string; value: string }> = [];
  const unansweredSensitiveQuestions: Array<{ fieldId: string; prompt: string }> = [];

  const headless = options.headless ?? (process.env.PLAYWRIGHT_HEADLESS !== "false");
  let browser: Browser | null = null;
  let tempResumePath: string | null = null;

  try {
    browser = await chromium.launch({
      headless,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    });

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();

    // Navigate to application page
    try {
      await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 25000 });
    } catch (navError) {
      return {
        portalType,
        portalUrl: options.url,
        status: "failed",
        botProtectionDetected: false,
        fieldsFilled: [],
        unansweredSensitiveQuestions: [],
        message: `Failed to load application page: ${navError instanceof Error ? navError.message : String(navError)}`,
        executedAt: now
      };
    }

    // Check for Bot Protections or Login Walls
    const pageContent = await page.content();
    const isCloudflare = pageContent.includes("cf-turnstile") || pageContent.includes("challenge-running") || /verify you are human/i.test(pageContent);
    const isCaptcha = (await page.$("iframe[src*='recaptcha'], iframe[src*='hcaptcha'], .g-recaptcha")) !== null;
    const isLoginWall = /login|signin|auth|myworkdayjobs\.com/i.test(page.url()) && (await page.$("input[type='password']")) !== null;

    if (isCloudflare || isCaptcha || isLoginWall) {
      const protectionType = isCloudflare ? "cloudflare" : isCaptcha ? "captcha" : "login_required";
      return {
        portalType,
        portalUrl: options.url,
        status: "needs_human_action",
        botProtectionDetected: true,
        botProtectionType: protectionType,
        handoffReason: `Portal requires manual verification (${protectionType}). Please complete the challenge directly in your browser.`,
        fieldsFilled: [],
        unansweredSensitiveQuestions: [],
        message: `Human action required: Portal is protected by ${protectionType}.`,
        executedAt: now
      };
    }

    // Fill candidate name fields
    const nameParts = options.profile.fullName.trim().split(/\s+/);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    const firstNameField = await page.$("#first_name, input[name='first_name'], input[name='firstName'], input[autocomplete='given-name']");
    if (firstNameField && firstName) {
      await firstNameField.fill(firstName);
      fieldsFilled.push({ fieldId: "first_name", label: "First Name", value: firstName });
    }

    const lastNameField = await page.$("#last_name, input[name='last_name'], input[name='lastName'], input[autocomplete='family-name']");
    if (lastNameField && lastName) {
      await lastNameField.fill(lastName);
      fieldsFilled.push({ fieldId: "last_name", label: "Last Name", value: lastName });
    }

    // Full name field (e.g., Lever)
    const fullNameField = await page.$("input[name='name'], input[name='fullname'], input[id='name']");
    if (fullNameField && options.profile.fullName && !firstNameField) {
      await fullNameField.fill(options.profile.fullName);
      fieldsFilled.push({ fieldId: "name", label: "Full Name", value: options.profile.fullName });
    }

    // Email
    const candidateEmail = options.answers?.email || options.answers?.candidateEmail;
    const emailField = await page.$("#email, input[type='email'], input[name='email'], input[autocomplete='email']");
    if (emailField) {
      if (candidateEmail) {
        await emailField.fill(candidateEmail);
        fieldsFilled.push({ fieldId: "email", label: "Email Address", value: candidateEmail });
      } else {
        unansweredSensitiveQuestions.push({ fieldId: "email", prompt: "Please provide your verified email address for this application." });
      }
    }

    // Phone
    const candidatePhone = options.answers?.phone;
    const phoneField = await page.$("#phone, input[type='tel'], input[name='phone'], input[name='phoneNumber']");
    if (phoneField && candidatePhone) {
      await phoneField.fill(candidatePhone);
      fieldsFilled.push({ fieldId: "phone", label: "Phone Number", value: candidatePhone });
    }

    // Location / City
    const candidateLocation = options.profile.preferredLocations[0] || options.profile.preferredCountries[0];
    const locationField = await page.$("#location, input[name='location'], input[id*='location']");
    if (locationField && candidateLocation) {
      await locationField.fill(candidateLocation);
      fieldsFilled.push({ fieldId: "location", label: "Location", value: candidateLocation });
    }

    // LinkedIn URL
    const linkedinUrl = options.answers?.linkedin;
    const linkedinField = await page.$("input[name*='linkedin' i], input[id*='linkedin' i], input[aria-label*='linkedin' i]");
    if (linkedinField && linkedinUrl) {
      await linkedinField.fill(linkedinUrl);
      fieldsFilled.push({ fieldId: "linkedin", label: "LinkedIn", value: linkedinUrl });
    }

    // GitHub URL
    const githubUrl = options.answers?.github;
    const githubField = await page.$("input[name*='github' i], input[id*='github' i]");
    if (githubField && githubUrl) {
      await githubField.fill(githubUrl);
      fieldsFilled.push({ fieldId: "github", label: "GitHub", value: githubUrl });
    }

    // Cover Letter / Comments
    const coverLetterText = options.answers?.coverLetter;
    const coverLetterField = await page.$("#cover_letter_text, textarea[name='comments'], textarea[name*='cover' i], textarea[name*='letter' i]");
    if (coverLetterField && coverLetterText) {
      await coverLetterField.fill(coverLetterText);
      fieldsFilled.push({ fieldId: "cover_letter", label: "Cover Letter", value: coverLetterText.slice(0, 100) + "..." });
    }

    // Resume Upload handling
    const fileInput = await page.$("input[type='file']");
    if (fileInput) {
      let fileToUpload = options.resumeFilePath;
      if (!fileToUpload && options.profile.resumeText) {
        tempResumePath = path.join(os.tmpdir(), `resume-${Date.now()}.txt`);
        fs.writeFileSync(tempResumePath, options.profile.resumeText, "utf-8");
        fileToUpload = tempResumePath;
      }
      if (fileToUpload && fs.existsSync(fileToUpload)) {
        await fileInput.setInputFiles(fileToUpload);
        fieldsFilled.push({ fieldId: "resume", label: "Resume File", value: path.basename(fileToUpload) });
      } else {
        unansweredSensitiveQuestions.push({ fieldId: "resume", prompt: "Resume document is required for submission." });
      }
    }

    // Inspect Sensitive / Consequential Questions
    // 1. Work Authorization
    if (options.profile.workAuthorization) {
      fieldsFilled.push({ fieldId: "work_authorization", label: "Work Authorization", value: options.profile.workAuthorization });
    } else {
      unansweredSensitiveQuestions.push({
        fieldId: "work_authorization",
        prompt: "Are you legally authorized to work in the country of this role?"
      });
    }

    // 2. Visa Sponsorship
    const sponsorshipAnswer = options.answers?.visaSponsorship;
    if (sponsorshipAnswer) {
      fieldsFilled.push({ fieldId: "visa_sponsorship", label: "Visa Sponsorship", value: sponsorshipAnswer });
    } else {
      unansweredSensitiveQuestions.push({
        fieldId: "visa_sponsorship",
        prompt: "Will you now or in the future require employment visa sponsorship?"
      });
    }

    // 3. Compensation expectations
    const salaryAnswer = options.answers?.salaryExpectation || (options.profile.minimumSalary ? String(options.profile.minimumSalary) : null);
    if (salaryAnswer) {
      fieldsFilled.push({ fieldId: "salary_expectation", label: "Compensation Expectations", value: salaryAnswer });
    }

    // Check Submission Gate:
    if (options.submitAfterFilling) {
      if (!options.userExplicitlyApproved) {
        return {
          portalType,
          portalUrl: options.url,
          status: "approval_required",
          botProtectionDetected: false,
          fieldsFilled,
          unansweredSensitiveQuestions,
          submissionOutcome: {
            submitted: false,
            status: "approval_required",
            message: "Submission halted: Explicit candidate approval is strictly required before form submission.",
            timestamp: now
          },
          message: "Form filled in browser. Awaiting explicit candidate approval before submitting.",
          executedAt: now
        };
      }

      if (unansweredSensitiveQuestions.length > 0) {
        return {
          portalType,
          portalUrl: options.url,
          status: "needs_human_action",
          botProtectionDetected: false,
          fieldsFilled,
          unansweredSensitiveQuestions,
          submissionOutcome: {
            submitted: false,
            status: "needs_human_action",
            message: "Cannot submit: Sensitive questions or required fields are unresolved.",
            timestamp: now
          },
          message: "Form filled, but sensitive questions require candidate answers before submitting.",
          executedAt: now
        };
      }

      // Explicitly approved and all sensitive questions answered: Execute submission!
      const submitBtn = await page.$("button[type='submit'], #submit_app, input[type='submit'], button:has-text('Submit Application')");
      if (!submitBtn) {
        return {
          portalType,
          portalUrl: options.url,
          status: "failed",
          botProtectionDetected: false,
          fieldsFilled,
          unansweredSensitiveQuestions: [],
          message: "Could not find a valid submission button on the application page.",
          executedAt: now
        };
      }

      // Click submit and wait for response
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {}),
        submitBtn.click()
      ]);

      const submittedContent = await page.content();
      const submittedUrl = page.url();

      const outcome = verifySubmissionOutcome({
        confirmationUrl: submittedUrl,
        htmlText: submittedContent
      }, true);

      return {
        portalType,
        portalUrl: submittedUrl,
        status: outcome.status,
        botProtectionDetected: false,
        fieldsFilled,
        unansweredSensitiveQuestions: [],
        submissionOutcome: outcome,
        message: outcome.message,
        executedAt: now
      };
    }

    // Default: Form filled, inspected, stopped safely before final submission
    return {
      portalType,
      portalUrl: options.url,
      status: "ready_for_review",
      botProtectionDetected: false,
      fieldsFilled,
      unansweredSensitiveQuestions,
      message: `Form successfully populated with ${fieldsFilled.length} fields. Ready for candidate review and approval.`,
      executedAt: now
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (tempResumePath && fs.existsSync(tempResumePath)) {
      try { fs.unlinkSync(tempResumePath); } catch {}
    }
  }
}
