import { candidateProfileSchema, type CandidateProfileInput } from "@applypilot/shared";

const skillsCatalog = ["JavaScript", "TypeScript", "React", "Node.js", "Python", "Java", "C++", "C#", "SQL", "PostgreSQL", "MongoDB", "AWS", "Azure", "Docker", "Kubernetes", "HTML", "CSS", "Figma", "Git", "Excel", "Project Management", "Agile", "Leadership", "Communication", "Machine Learning", "Data Analysis"];
const section = (text: string, names: string[]) => {
  const lines = text.split("\n"); const start = lines.findIndex(line => names.some(name => new RegExp(`^\\s*${name}\\s*:?\\s*$`, "i").test(line)));
  if (start < 0) return [];
  const result: string[] = [];
  for (const line of lines.slice(start + 1)) { if (/^\s*[A-Z][A-Z &/]{2,}\s*:?\s*$/.test(line)) break; if (line.trim()) result.push(line.trim()); }
  return result;
};

export function parseResume(text: string): { profile: CandidateProfileInput; contact: { email: string; phone: string }; found: string[]; uncertain: string[] } {
  const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
  const phone = text.match(/(?:\+?\d[\d ().-]{7,}\d)/)?.[0] ?? "";
  const name = lines.slice(0, 5).find(line => line.length < 80 && /^[\p{L}][\p{L} .'-]+$/u.test(line) && !/resume|curriculum|vitae/i.test(line)) ?? "";
  const skillsText = section(text, ["skills", "technical skills", "core competencies"]);
  const skills = skillsCatalog.filter(skill => new RegExp(`(^|[^\\p{L}])${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "iu").test(skillsText.join(" ")));
  const educationLines = section(text, ["education", "education & qualifications", "academic background"]);
  const experienceLines = section(text, ["experience", "work experience", "employment history", "professional experience"]);
  const projectLines = section(text, ["projects", "selected projects", "personal projects"]);
  const summaryLines = section(text, ["summary", "professional summary", "profile"]);
  const education = educationLines.map(line => ({ institution: line.slice(0, 200), qualification: "", fieldOfStudy: "", location: "", startDate: "", endDate: "", details: "" }));
  const experience = experienceLines.map(line => ({ company: "", title: line.slice(0, 160), location: "", startDate: "", endDate: "", current: false, details: "" }));
  const projects = projectLines.map(line => ({ name: line.slice(0, 160), url: "", technologies: [], details: "" }));
  const profile = candidateProfileSchema.parse({ fullName: name, skills, education, experience, projects, resumeText: text, professionalSummary: summaryLines.join(" ").slice(0, 4000) });
  const found = [name && "name", (email || phone) && "contact information", skills.length && "skills", educationLines.length && "education", experienceLines.length && "work experience", projectLines.length && "projects", "resume text"].filter(Boolean) as string[];
  const uncertain = [!name && "name", !(email || phone) && "contact information", !skills.length && "skills", !educationLines.length && "education", !experienceLines.length && "work experience", !projectLines.length && "projects"].filter(Boolean) as string[];
  return { profile, contact: { email, phone }, found, uncertain };
}
