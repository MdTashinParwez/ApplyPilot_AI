import type { CandidateProfileInput } from "./index.js";

export interface DerivedStrategyResult {
  targetTitles: string[];
  queries: string[];
  keywords: string[];
  technicalDomains: string[];
  jobTypes: string[];
  lastDerivedAt: string | null;
}

const DOMAIN_TITLE_MAP: Record<string, string[]> = {
  frontend: [
    "Frontend Engineer",
    "Frontend Developer",
    "Web Developer",
    "UI Engineer",
    "Software Engineer - Frontend"
  ],
  backend: [
    "Backend Engineer",
    "Backend Developer",
    "Software Engineer - Backend",
    "API Engineer",
    "Server-Side Developer"
  ],
  fullstack: [
    "Full Stack Engineer",
    "Full Stack Developer",
    "Software Engineer",
    "Software Development Engineer"
  ],
  "devops / cloud": [
    "DevOps Engineer",
    "Cloud Engineer",
    "Site Reliability Engineer",
    "Platform Engineer",
    "Infrastructure Engineer"
  ],
  devops: [
    "DevOps Engineer",
    "Cloud Engineer",
    "Site Reliability Engineer",
    "Platform Engineer"
  ],
  cloud: [
    "Cloud Engineer",
    "Cloud Architect",
    "DevOps Engineer"
  ],
  mobile: [
    "Mobile Developer",
    "iOS Developer",
    "Android Developer",
    "Mobile Engineer"
  ],
  "ai / machine learning": [
    "Machine Learning Engineer",
    "AI Engineer",
    "Data Scientist",
    "Applied AI Engineer"
  ],
  "machine learning": [
    "Machine Learning Engineer",
    "ML Engineer",
    "Data Scientist"
  ],
  data: [
    "Data Engineer",
    "Analytics Engineer",
    "Big Data Developer"
  ],
  "data engineering": [
    "Data Engineer",
    "Analytics Engineer",
    "ETL Developer"
  ],
  systems: [
    "Systems Engineer",
    "Embedded Software Engineer",
    "C++ Developer",
    "Firmware Engineer"
  ],
  cybersecurity: [
    "Security Engineer",
    "Application Security Engineer",
    "Cybersecurity Analyst"
  ]
};

const SKILL_DOMAIN_HINTS: Array<{ pattern: RegExp; domain: string; title: string }> = [
  { pattern: /\b(react|vue|angular|svelte|next\.js|frontend|html|css|tailwind)\b/i, domain: "Frontend", title: "Frontend Developer" },
  { pattern: /\b(node\.js|express|django|flask|fastapi|spring|java|golang|ruby|postgres|mongodb|sql|backend)\b/i, domain: "Backend", title: "Backend Developer" },
  { pattern: /\b(docker|kubernetes|aws|azure|gcp|terraform|devops|ci\/cd|linux)\b/i, domain: "DevOps / Cloud", title: "DevOps Engineer" },
  { pattern: /\b(pytorch|tensorflow|machine learning|deep learning|data science|nlp|llm|langgraph)\b/i, domain: "AI / Machine Learning", title: "Machine Learning Engineer" },
  { pattern: /\b(react native|flutter|swift|kotlin|ios|android)\b/i, domain: "Mobile", title: "Mobile Developer" },
  { pattern: /\b(spark|hadoop|data pipeline|airflow|kafka|snowflake|dbt)\b/i, domain: "Data Engineering", title: "Data Engineer" }
];

const JOB_TYPE_PREFIXES: Record<string, string[]> = {
  internship: ["Intern", "Software Intern", "Engineering Intern"],
  graduate: ["Graduate", "New Grad", "Associate"],
  entry_level: ["Junior", "Associate", "Entry Level"],
  mid_level: [],
  full_time: []
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Derives an autonomous search strategy from candidate profile facts:
 * - Automatically derives suitable job titles and synonyms from profile target titles, domains, and verified skills
 * - Automatically derives actionable search queries combining role level and technical specialization
 * - Extracts top technical keywords
 * - Never fabricates qualifications or unsupported claims
 */
export function deriveSearchStrategy(
  profile: Pick<
    CandidateProfileInput,
    "skills" | "targetJobTitles" | "technicalDomains" | "jobTypes" | "education" | "experience"
  >
): DerivedStrategyResult {
  const titles = new Set<string>();
  const queries = new Set<string>();
  const detectedDomains = new Set<string>();
  const activeJobTypes = profile.jobTypes.map(normalizeKey);

  // 1. Incorporate explicitly set target job titles
  for (const title of profile.targetJobTitles) {
    const trimmed = title.trim();
    if (trimmed) {
      titles.add(trimmed);
      queries.add(trimmed);
    }
  }

  // 2. Incorporate explicitly set technical domains
  for (const domain of profile.technicalDomains) {
    const norm = normalizeKey(domain);
    if (norm) {
      detectedDomains.add(domain.trim());
      const mappedTitles = DOMAIN_TITLE_MAP[norm] ?? [];
      for (const t of mappedTitles) {
        titles.add(t);
      }
    }
  }

  // 3. Infer additional domains and titles from skills
  const skillsText = profile.skills.join(" ");
  for (const hint of SKILL_DOMAIN_HINTS) {
    if (hint.pattern.test(skillsText)) {
      detectedDomains.add(hint.domain);
      titles.add(hint.title);
    }
  }

  // 4. If titles are still empty but domains or skills were detected, infer standard roles
  if (titles.size === 0 && (detectedDomains.size > 0 || profile.skills.length > 0)) {
    if (detectedDomains.has("Frontend") && detectedDomains.has("Backend")) {
      titles.add("Full Stack Developer");
      titles.add("Software Engineer");
    } else if (detectedDomains.has("Frontend")) {
      titles.add("Frontend Developer");
      titles.add("Software Engineer");
    } else if (detectedDomains.has("Backend")) {
      titles.add("Backend Developer");
      titles.add("Software Engineer");
    } else {
      titles.add("Software Engineer");
    }
  }

  // 5. Generate role-level qualified search queries based on job types
  // e.g. "Software Engineer Intern", "Junior Frontend Developer", "Graduate Software Engineer"
  const baseTitles = [...titles].slice(0, 5);
  for (const baseTitle of baseTitles) {
    queries.add(baseTitle);

    for (const jobType of activeJobTypes) {
      const prefixes = JOB_TYPE_PREFIXES[jobType] ?? [];
      for (const prefix of prefixes) {
        if (!baseTitle.toLowerCase().includes(prefix.toLowerCase())) {
          if (prefix === "Intern") {
            queries.add(`${baseTitle} Intern`);
          } else {
            queries.add(`${prefix} ${baseTitle}`);
          }
        }
      }
    }
  }

  // 6. Keywords from verified technical skills
  const keywords = profile.skills
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 15);

  const hasContent = titles.size > 0 || profile.skills.length > 0 || profile.technicalDomains.length > 0;

  return {
    targetTitles: [...titles].slice(0, 20),
    queries: [...queries].slice(0, 25),
    keywords,
    technicalDomains: [...detectedDomains].slice(0, 15),
    jobTypes: profile.jobTypes,
    lastDerivedAt: hasContent ? new Date().toISOString() : null
  };
}
