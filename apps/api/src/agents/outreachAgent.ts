import type { CandidateProfileInput } from "@applypilot/shared";
import type { OpportunityRecord } from "../assistantRepository.js";

export interface RecruiterOutreachDraft {
  recipientAddress: string;
  recipientProvenance: string;
  subject: string;
  body: string;
  factsUsed: string[];
}

export function generateRecruiterDraft(
  opportunity: OpportunityRecord | { title: string; company: string },
  profile: CandidateProfileInput,
  recipientAddress: string,
  recipientProvenance: string
): RecruiterOutreachDraft {
  const name = profile.fullName.trim();
  const topSkills = profile.skills.slice(0, 3);
  const relevantProject = profile.projects[0];
  const relevantExperience = profile.experience[0];

  const factsUsed: string[] = [];
  if (name) factsUsed.push(`Candidate name: ${name}`);
  if (topSkills.length) factsUsed.push(`Skills: ${topSkills.join(", ")}`);
  if (relevantProject) factsUsed.push(`Project: ${relevantProject.name}`);
  if (relevantExperience) factsUsed.push(`Experience: ${relevantExperience.title} at ${relevantExperience.company}`);
  factsUsed.push(`Opportunity: ${opportunity.title} at ${opportunity.company}`);
  factsUsed.push(`Recipient provenance: ${recipientProvenance}`);

  const subject = `Regarding ${opportunity.title} at ${opportunity.company}${name ? ` — ${name}` : ""}`;

  const greeting = "Hello,";
  const intro = name
    ? `My name is ${name}, and I recently reviewed the ${opportunity.title} position at ${opportunity.company}.`
    : `I recently came across the ${opportunity.title} position at ${opportunity.company}.`;

  const background = topSkills.length
    ? `My technical background centers on ${topSkills.join(", ")}${relevantExperience ? `, with experience as a ${relevantExperience.title} at ${relevantExperience.company}` : ""}.`
    : "My background aligns with your engineering and product requirements.";

  const projectHighlight = relevantProject
    ? `Recently, I worked on ${relevantProject.name}${relevantProject.technologies.length ? ` using ${relevantProject.technologies.slice(0, 3).join(", ")}` : ""}, which reinforced my interest in the problems ${opportunity.company} is solving.`
    : "";

  const closing = "Would you or a member of the recruiting team be open to a brief conversation about the role and team priorities?";
  const signoff = name ? `Best regards,\n${name}` : "Best regards,";

  const body = [
    greeting,
    "",
    intro,
    "",
    background,
    ...(projectHighlight ? ["", projectHighlight] : []),
    "",
    closing,
    "",
    signoff
  ].join("\n");

  return {
    recipientAddress,
    recipientProvenance,
    subject,
    body,
    factsUsed
  };
}

