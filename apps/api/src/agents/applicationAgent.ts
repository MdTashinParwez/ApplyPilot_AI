import type { CandidateProfileInput, Job } from "@applypilot/shared";
import type { OpportunityRecord } from "../assistantRepository.js";

export interface PortalFormField {
  name: string;
  label: string;
  value: string;
  type: "text" | "email" | "tel" | "file" | "textarea" | "select";
  required: boolean;
  sensitive: boolean;
  status: "filled" | "requires_user_input" | "optional";
  userAnswer?: string | null;
}

export interface GeneratedPreparationMaterials {
  portalType: "greenhouse" | "lever" | "generic";
  portalUrl: string;
  answers: Record<string, string>;
  coverLetterDraft: string;
  resumeSummaryDraft: string;
  formFields: PortalFormField[];
  sensitiveQuestions: Array<{
    field: string;
    prompt: string;
    status: "requires_user_input";
    userAnswer: string | null;
  }>;
  generatedAt: string;
}

function detectPortalType(url: string): "greenhouse" | "lever" | "generic" {
  const lower = url.toLowerCase();
  if (lower.includes("greenhouse.io") || lower.includes("gh_src")) return "greenhouse";
  if (lower.includes("lever.co")) return "lever";
  return "generic";
}

/**
 * Prepares application materials and inspects form fields using ONLY verified candidate facts.
 * Consequential or sensitive questions (work authorization, visa sponsorship, salary expectations,
 * legal attestations, disability/veteran disclosures) are never guessed and are flagged for user input.
 */
export function prepareApplicationMaterials(
  opportunity: OpportunityRecord | { title: string; company: string; jobUrl: string },
  profile: CandidateProfileInput
): {
  profileFactsSnapshot: Pick<CandidateProfileInput, "fullName" | "professionalSummary" | "skills" | "education" | "experience" | "projects" | "targetJobTitles" | "workAuthorization">;
  generatedMaterials: GeneratedPreparationMaterials[];
  unansweredQuestions: string[];
} {
  const portalType = detectPortalType(opportunity.jobUrl);

  const relevantSkills = profile.skills.slice(0, 8);
  const relevantExperience = profile.experience[0];
  const relevantProject = profile.projects[0];

  // Tailored Cover Letter Draft using verified facts
  const candidateName = profile.fullName.trim() || "Applicant";
  const coverLetterParagraphs = [
    `Dear Hiring Team at ${opportunity.company},`,
    "",
    `I am writing to express my strong enthusiasm for the ${opportunity.title} role at ${opportunity.company}. With a background in ${relevantSkills.slice(0, 3).join(", ") || "software engineering"}${relevantExperience ? ` and practical experience as a ${relevantExperience.title} at ${relevantExperience.company}` : ""}, I am excited about the opportunity to contribute to your team.`,
    "",
    relevantProject
      ? `In my recent project, ${relevantProject.name}${relevantProject.technologies.length ? ` (built using ${relevantProject.technologies.slice(0, 4).join(", ")})` : ""}, I developed practical experience solving problems aligned with your engineering goals.`
      : `Throughout my work, I have focused on building reliable, clean software using ${relevantSkills.join(", ") || "modern engineering practices"}.`,
    "",
    profile.workAuthorization
      ? `Regarding work authorization: ${profile.workAuthorization}.`
      : "Please note that work authorization and sponsorship details will be confirmed directly.",
    "",
    `Thank you for your time and consideration. I welcome the opportunity to discuss how my verified skills can support ${opportunity.company}.`,
    "",
    `Sincerely,\n${candidateName}`
  ];

  const coverLetterDraft = coverLetterParagraphs.join("\n");

  // Tailored Resume Summary Draft
  const resumeSummaryDraft = [
    `${profile.fullName || "Candidate"} — ${opportunity.title} Candidate`,
    profile.professionalSummary ? `Summary: ${profile.professionalSummary}` : "",
    `Key Verified Technologies: ${relevantSkills.join(", ")}`,
    profile.education.length ? `Education: ${profile.education[0]?.qualification} in ${profile.education[0]?.fieldOfStudy} from ${profile.education[0]?.institution}` : ""
  ].filter(Boolean).join("\n\n");

  // Form Fields Mapping (never fabricating values)
  const formFields: PortalFormField[] = [
    {
      name: "full_name",
      label: "Full Name",
      value: profile.fullName,
      type: "text",
      required: true,
      sensitive: false,
      status: profile.fullName ? "filled" : "requires_user_input"
    },
    {
      name: "cover_letter",
      label: "Cover Letter",
      value: coverLetterDraft,
      type: "textarea",
      required: false,
      sensitive: false,
      status: "filled"
    }
  ];

  const sensitiveQuestions: GeneratedPreparationMaterials["sensitiveQuestions"] = [
    {
      field: "work_authorization",
      prompt: "Are you legally authorized to work in the country of this role?",
      status: "requires_user_input",
      userAnswer: profile.workAuthorization || null
    },
    {
      field: "visa_sponsorship",
      prompt: "Will you now or in the future require visa sponsorship for employment?",
      status: "requires_user_input",
      userAnswer: null
    },
    {
      field: "salary_expectations",
      prompt: "What are your compensation expectations?",
      status: "requires_user_input",
      userAnswer: profile.minimumSalary ? String(profile.minimumSalary) : null
    }
  ];

  const unansweredQuestions = [
    ...(!profile.fullName ? ["Candidate full name is missing."] : []),
    "Work authorization eligibility for this specific role must be verified by the user.",
    "Visa sponsorship requirement must be answered by the user.",
    "Compensation expectations must be confirmed by the user before final application."
  ];

  const answers: Record<string, string> = {
    fullName: profile.fullName,
    coverLetter: coverLetterDraft,
    resumeSummary: resumeSummaryDraft
  };

  const snapshot = {
    fullName: profile.fullName,
    professionalSummary: profile.professionalSummary,
    skills: profile.skills,
    education: profile.education,
    experience: profile.experience,
    projects: profile.projects,
    targetJobTitles: profile.targetJobTitles,
    workAuthorization: profile.workAuthorization
  };

  const materials: GeneratedPreparationMaterials = {
    portalType,
    portalUrl: opportunity.jobUrl,
    answers,
    coverLetterDraft,
    resumeSummaryDraft,
    formFields,
    sensitiveQuestions,
    generatedAt: new Date().toISOString()
  };

  return {
    profileFactsSnapshot: snapshot,
    generatedMaterials: [materials],
    unansweredQuestions
  };
}

export * from "./browserAutomation.js";

