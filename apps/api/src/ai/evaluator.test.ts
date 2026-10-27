import assert from "node:assert/strict";
import { test } from "node:test";
import type { Job } from "@applypilot/shared";
import {
  evaluateSingleJobLocally,
  checkLanguageEligibility,
  checkSeniorityEligibility,
  checkDomainEligibility
} from "./evaluator.js";
import { discoverRecruiterContact } from "../services/recruiterDiscovery.js";
import { inspectAndMapApplicationPortal, verifySubmissionOutcome } from "../services/browserAutomation.js";

const baseJob: Job = {
  sourceId: "job-101",
  source: "arbeitnow",
  sourceAttribution: "Arbeitnow",
  title: "Junior Backend Developer",
  company: "CloudScale Inc",
  location: "Berlin, Germany",
  country: "Germany",
  workArrangement: "remote",
  url: "https://cloudscale.test/careers/junior-backend",
  description: "We are seeking a Junior Backend Developer proficient in Python, FastAPI, and PostgreSQL. Develop clean REST APIs.",
  remote: true,
  publishedAt: new Date().toISOString(),
  tags: ["Python", "FastAPI", "PostgreSQL"],
  jobTypes: ["Entry-level"]
};

test("Regression 1: Senior-only and Director roles are rejected for entry/intern candidates", () => {
  const candidateProfile = {
    skills: ["Python", "FastAPI", "PostgreSQL"],
    professionalSummary: "Entry-level backend engineer",
    targetJobTitles: ["Junior Backend Developer", "Software Engineer Intern"],
    jobTypes: ["internship", "entry_level"],
    technicalDomains: ["Backend", "Fullstack"],
    languages: ["English"],
    preferredCountries: ["Germany"],
    preferredLocations: ["Berlin"],
    workArrangements: ["remote" as const],
    experience: []
  };

  const directorJob: Job = {
    ...baseJob,
    title: "Director of Engineering",
    description: "Lead 50+ engineers, manage budgets, and oversee backend Python strategy."
  };

  const seniorJob: Job = {
    ...baseJob,
    title: "Senior Lead Architect",
    description: "10+ years experience required in Python, PostgreSQL, and distributed architecture."
  };

  const directorResult = evaluateSingleJobLocally(directorJob, candidateProfile);
  assert.equal(directorResult.eligible, false);
  assert.equal(directorResult.recommendation, "ineligible");
  assert.equal(directorResult.score, 0);
  assert.equal(directorResult.rejectionCategory, "seniority_mismatch");

  const seniorResult = evaluateSingleJobLocally(seniorJob, candidateProfile);
  assert.equal(seniorResult.eligible, false);
  assert.equal(seniorResult.recommendation, "ineligible");
  assert.equal(seniorResult.score, 0);
  assert.equal(seniorResult.rejectionCategory, "seniority_mismatch");
});

test("Regression 2: Irrelevant mobile roles are rejected for candidates targeting backend/AI without mobile skills", () => {
  const candidateProfile = {
    skills: ["Python", "Node.js", "PostgreSQL", "Docker"],
    professionalSummary: "Backend API and distributed systems engineer",
    targetJobTitles: ["Backend Engineer", "Software Engineer"],
    technicalDomains: ["Backend", "AI / Machine Learning", "DevOps"],
    jobTypes: ["entry_level"],
    languages: ["English"],
    preferredCountries: [],
    preferredLocations: [],
    workArrangements: ["remote" as const],
    experience: []
  };

  const iosJob: Job = {
    ...baseJob,
    title: "iOS Engineer (Swift & UIKit)",
    description: "Build native mobile iOS applications using Swift, SwiftUI, and Xcode."
  };

  const androidJob: Job = {
    ...baseJob,
    title: "Android Developer",
    description: "Develop Android mobile apps using Kotlin and Android SDK."
  };

  const iosResult = evaluateSingleJobLocally(iosJob, candidateProfile);
  assert.equal(iosResult.eligible, false);
  assert.equal(iosResult.recommendation, "ineligible");
  assert.equal(iosResult.score, 0);
  assert.equal(iosResult.rejectionCategory, "mobile_domain_mismatch");

  const androidResult = evaluateSingleJobLocally(androidJob, candidateProfile);
  assert.equal(androidResult.eligible, false);
  assert.equal(androidResult.recommendation, "ineligible");
  assert.equal(androidResult.score, 0);
  assert.equal(androidResult.rejectionCategory, "mobile_domain_mismatch");
});

test("Regression 3: Unrelated domains like music licensing and commercial sales are rejected", () => {
  const candidateProfile = {
    skills: ["Python", "TypeScript", "React"],
    professionalSummary: "Software engineer",
    targetJobTitles: ["Software Engineer"],
    technicalDomains: ["Backend", "Frontend"],
    jobTypes: ["entry_level"],
    languages: ["English"],
    preferredCountries: [],
    preferredLocations: [],
    workArrangements: ["remote" as const],
    experience: []
  };

  const musicJob: Job = {
    ...baseJob,
    title: "Director of Music Licensing",
    description: "Manage copyright royalties, synchronization licenses, and publishing contracts."
  };

  const salesJob: Job = {
    ...baseJob,
    title: "Sales Representative / Account Executive",
    description: "Cold calling, lead generation, and selling B2B software licenses."
  };

  const musicResult = evaluateSingleJobLocally(musicJob, candidateProfile);
  assert.equal(musicResult.eligible, false);
  assert.equal(musicResult.recommendation, "ineligible");
  assert.equal(musicResult.score, 0);
  assert.equal(musicResult.rejectionCategory, "unrelated_domain");

  const salesResult = evaluateSingleJobLocally(salesJob, candidateProfile);
  assert.equal(salesResult.eligible, false);
  assert.equal(salesResult.recommendation, "ineligible");
  assert.equal(salesResult.score, 0);
  assert.equal(salesResult.rejectionCategory, "unrelated_domain");
});

test("Regression 4: Postings requiring German or in German are rejected when German is undeclared", () => {
  const candidateProfile = {
    skills: ["Python", "PostgreSQL"],
    professionalSummary: "Backend developer",
    targetJobTitles: ["Backend Developer"],
    technicalDomains: ["Backend"],
    jobTypes: ["entry_level"],
    languages: ["English"], // Does not speak German
    preferredCountries: [],
    preferredLocations: [],
    workArrangements: ["remote" as const],
    experience: []
  };

  const germanTaggedJob: Job = {
    ...baseJob,
    title: "Softwareentwickler Python (m/w/d)",
    description: "Wir suchen einen Entwickler für unsere Cloud-Plattform in Berlin. Verhandlungssichere Deutschkenntnisse in Wort und Schrift erforderlich."
  };

  const germanRequirementJob: Job = {
    ...baseJob,
    title: "Python Developer",
    description: "Develop backend microservices. Fluent German (C1 level) is strictly required for daily team collaboration."
  };

  const germanTaggedResult = evaluateSingleJobLocally(germanTaggedJob, candidateProfile);
  assert.equal(germanTaggedResult.eligible, false);
  assert.equal(germanTaggedResult.recommendation, "ineligible");
  assert.equal(germanTaggedResult.score, 0);
  assert.equal(germanTaggedResult.rejectionCategory, "unsupported_language");

  const germanReqResult = evaluateSingleJobLocally(germanRequirementJob, candidateProfile);
  assert.equal(germanReqResult.eligible, false);
  assert.equal(germanReqResult.recommendation, "ineligible");
  assert.equal(germanReqResult.score, 0);
  assert.equal(germanReqResult.rejectionCategory, "unsupported_language");
});

test("Regression 5: Generic stop words never count as meaningful technical skill evidence", () => {
  const candidateProfile = {
    skills: ["Python", "FastAPI"],
    professionalSummary: "Backend developer",
    targetJobTitles: ["Backend Developer"],
    technicalDomains: ["Backend"],
    jobTypes: ["entry_level"],
    languages: ["English"],
    preferredCountries: [],
    preferredLocations: [],
    workArrangements: ["remote" as const],
    experience: [{
      title: "Junior Developer",
      company: "Startup",
      details: "Built microservices, optimized queries, managed deployments, and worked with agile teams as a leader."
    }]
  };

  const jobWithGenericWords: Job = {
    ...baseJob,
    title: "Backend Developer",
    description: "We are seeking a developer who built high-scale systems, optimized microservices, managed cloud systems, and can act as an agile leader with good code practices."
  };

  const result = evaluateSingleJobLocally(jobWithGenericWords, candidateProfile);
  assert.equal(result.eligible, true);
  for (const evidence of result.matchedEvidence) {
    for (const stopWord of ["built", "optimized", "managed", "leader", "agile", "engineer", "team"]) {
      assert.doesNotMatch(evidence.toLowerCase(), new RegExp(`^skill match: ${stopWord}\\.$`, "i"));
    }
  }
});

test("Regression 6: Recruiter discovery autonomously discovers contacts from listings or legitimate domains without fabrication", () => {
  const jobWithEmailInDesc = {
    ...baseJob,
    description: "Questions about this engineering role? Contact our talent team at recruiting@cloudscale.test."
  };

  const discovered = discoverRecruiterContact(jobWithEmailInDesc);
  assert.equal(discovered.email, "recruiting@cloudscale.test");
  assert.equal(discovered.verificationStatus, "verified_listing");
  assert.ok(discovered.evidence.includes("recruiting@cloudscale.test"));

  const jobWithoutEmail = {
    ...baseJob,
    jobUrl: "https://cloudscale.test/jobs/42",
    description: "Backend engineer wanted."
  };
  const derivedContact = discoverRecruiterContact(jobWithoutEmail);
  assert.equal(derivedContact.email, "careers@cloudscale.test");
  assert.equal(derivedContact.verificationStatus, "public_recruiting_contact");

  const anonymousAggregatorJob = {
    ...baseJob,
    jobUrl: "https://boards.greenhouse.io/embed/job_app?token=123",
    description: "Confidential company backend engineer."
  };
  const unknownContact = discoverRecruiterContact(anonymousAggregatorJob);
  assert.equal(unknownContact.email, null);
  assert.equal(unknownContact.verificationStatus, "not_found");
});

test("Regression 7: Application preparation flags sensitive questions without guessing and stops before submit", () => {
  const profile = {
    fullName: "Alex Rivera",
    professionalSummary: "Full-stack developer",
    skills: ["TypeScript", "React", "Node.js"],
    education: [],
    experience: [],
    projects: [],
    targetJobTitles: ["Software Engineer"],
    technicalDomains: ["Fullstack"],
    jobTypes: ["entry_level"],
    languages: ["English"],
    graduationDate: "2026-05",
    preferredCountries: ["United States"],
    preferredLocations: ["Remote"],
    workArrangements: ["remote" as const],
    minimumSalary: 95000,
    workAuthorization: "Eligible to work in the US with OPT",
    resumeText: "Alex Rivera Resume Details",
    searchStrategy: { targetTitles: [], queries: [], keywords: [], technicalDomains: [], jobTypes: [], lastDerivedAt: null }
  };

  const inspection = inspectAndMapApplicationPortal("https://boards.greenhouse.io/techcorp/jobs/101", profile);
  assert.equal(inspection.portalType, "greenhouse");

  const firstName = inspection.fields.find(f => f.fieldId === "first_name");
  assert.equal(firstName?.mappedValue, "Alex");
  assert.equal(firstName?.status, "filled");

  // Verify sensitive questions are NOT guessed and require explicit user input
  for (const q of inspection.sensitiveQuestions) {
    assert.equal(q.status, "requires_user_input");
  }

  // Verify submission outcome stops before submit when approval is missing
  const unapproved = verifySubmissionOutcome({ confirmationUrl: "https://techcorp.com/thanks" }, false);
  assert.equal(unapproved.submitted, false);
  assert.equal(unapproved.status, "approval_required");

  // Verify submission confirmation with proof of receipt
  const confirmed = verifySubmissionOutcome({
    confirmationUrl: "https://techcorp.com/application/thank-you",
    htmlText: "Thank you for applying to TechCorp!",
    referenceNumber: "APP-998822"
  }, true);
  assert.equal(confirmed.submitted, true);
  assert.equal(confirmed.status, "submitted_confirmed");
  assert.equal(confirmed.confirmationId, "APP-998822");
});
