import assert from "node:assert/strict";
import { test } from "node:test";
import {
  detectPortalType,
  inspectAndMapApplicationPortal,
  verifySubmissionOutcome,
  fillApplicationFormWithPlaywright
} from "./browserAutomation.js";
import { candidateProfileSchema, type CandidateProfileInput } from "@applypilot/shared";

const profile: CandidateProfileInput = candidateProfileSchema.parse({
  fullName: "Alex Rivera",
  professionalSummary: "Backend and AI engineer with experience in distributed systems.",
  skills: ["TypeScript", "Node.js", "Python", "PostgreSQL", "Docker", "FastAPI"],
  targetJobTitles: ["Backend Engineer", "Software Engineer"],
  preferredCountries: ["United States"],
  preferredLocations: ["Remote", "New York"],
  workArrangements: ["remote"],
  workAuthorization: "Authorized to work in the US without sponsorship",
  experience: [
    {
      company: "Acme Cloud",
      title: "Backend Engineer",
      location: "Remote",
      startDate: "2023-01-01",
      endDate: "",
      current: true,
      details: "Built event-driven microservices in Node.js and PostgreSQL."
    }
  ],
  education: [
    {
      institution: "Tech University",
      qualification: "B.S.",
      fieldOfStudy: "Computer Science",
      location: "New York",
      startDate: "2019-09-01",
      endDate: "2023-05-01",
      details: "Focus on distributed systems."
    }
  ],
  projects: [
    {
      name: "JobPulse",
      url: "",
      details: "Autonomous job matching engine",
      technologies: ["Node.js", "Python"]
    }
  ],
  languages: ["English"]
});

test("detectPortalType identifies Greenhouse, Lever, and Workday portals", () => {
  assert.equal(detectPortalType("https://boards.greenhouse.io/stripe/jobs/12345"), "greenhouse");
  assert.equal(detectPortalType("https://jobs.lever.co/spotify/67890"), "lever");
  assert.equal(detectPortalType("https://mycompany.myworkdayjobs.com/en-US/Careers/job/1"), "workday");
  assert.equal(detectPortalType("https://company.com/careers/apply"), "generic");
});

test("inspectAndMapApplicationPortal maps verified candidate facts and leaves sensitive questions for user input", () => {
  const result = inspectAndMapApplicationPortal("https://boards.greenhouse.io/demo/jobs/1", profile);
  assert.equal(result.portalType, "greenhouse");
  assert.equal(result.fields.find(f => f.fieldId === "first_name")?.mappedValue, "Alex");
  assert.equal(result.fields.find(f => f.fieldId === "last_name")?.mappedValue, "Rivera");

  // Sensitive questions must require explicit user input
  const workAuth = result.sensitiveQuestions.find(q => q.sensitiveType === "work_authorization");
  assert.ok(workAuth);
  assert.equal(workAuth.status, "requires_user_input");

  const visa = result.sensitiveQuestions.find(q => q.sensitiveType === "visa_sponsorship");
  assert.ok(visa);
  assert.equal(visa.userAnswer, null);
});

test("verifySubmissionOutcome strictly verifies confirmation receipts and rejects unconfirmed outcomes", () => {
  // 1. Rejected if user did not approve
  const unapproved = verifySubmissionOutcome({ confirmationUrl: "https://boards.greenhouse.io/confirm" }, false);
  assert.equal(unapproved.status, "approval_required");
  assert.equal(unapproved.submitted, false);

  // 2. Confirmed when receipt text is verified
  const confirmed = verifySubmissionOutcome({
    confirmationUrl: "https://boards.greenhouse.io/confirm",
    htmlText: "Thank you for applying! Your application has been received.",
    referenceNumber: "APP-98765"
  }, true);
  assert.equal(confirmed.status, "submitted_confirmed");
  assert.equal(confirmed.submitted, true);
  assert.equal(confirmed.confirmationId, "APP-98765");

  // 3. Uncertain when receipt cannot be confirmed
  const uncertain = verifySubmissionOutcome({
    confirmationUrl: "https://boards.greenhouse.io/jobs/1",
    htmlText: "Error processing your request"
  }, true);
  assert.equal(uncertain.status, "unknown");
  assert.equal(uncertain.submitted, false);
});

test("fillApplicationFormWithPlaywright populates form fields and respects explicit approval gates", async () => {
  const syntheticHtml = `
    <!DOCTYPE html>
    <html>
      <head><title>Job Application</title></head>
      <body>
        <h1>Apply for Backend Engineer</h1>
        <form id="application_form">
          <input type="text" id="first_name" name="first_name" placeholder="First Name" />
          <input type="text" id="last_name" name="last_name" placeholder="Last Name" />
          <input type="email" id="email" name="email" placeholder="Email" />
          <input type="tel" id="phone" name="phone" placeholder="Phone" />
          <textarea id="cover_letter_text" name="cover_letter" placeholder="Cover Letter"></textarea>
          <button type="submit" id="submit_app">Submit Application</button>
        </form>
      </body>
    </html>
  `;
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(syntheticHtml)}`;

  // Test 1: Populate form without submitting
  const result = await fillApplicationFormWithPlaywright({
    url: dataUrl,
    profile,
    answers: {
      email: "alex.rivera@example.com",
      phone: "+1-555-0199",
      coverLetter: "I am excited to apply for the Backend Engineer position."
    },
    submitAfterFilling: false
  });

  assert.equal(result.status, "ready_for_review");
  assert.ok(result.fieldsFilled.some(f => f.fieldId === "first_name" && f.value === "Alex"));
  assert.ok(result.fieldsFilled.some(f => f.fieldId === "last_name" && f.value === "Rivera"));
  assert.ok(result.fieldsFilled.some(f => f.fieldId === "email" && f.value === "alex.rivera@example.com"));

  // Test 2: Attempting submission without explicit approval is halted
  const unapprovedSubmit = await fillApplicationFormWithPlaywright({
    url: dataUrl,
    profile,
    answers: { email: "alex.rivera@example.com" },
    submitAfterFilling: true,
    userExplicitlyApproved: false
  });

  assert.equal(unapprovedSubmit.status, "approval_required");
  assert.equal(unapprovedSubmit.submissionOutcome?.submitted, false);
});
