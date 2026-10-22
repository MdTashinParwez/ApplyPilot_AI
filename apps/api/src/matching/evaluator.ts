import type { Job } from "@applypilot/shared";
import type { AnalysisProfile, JobAnalysisFactor, JobAnalysisResult } from "../aiServiceClient.js";

const SKILL_CATALOG = [
  "TypeScript", "JavaScript", "React", "Node.js", "Python", "FastAPI", "Java", "C++", "C#", "SQL",
  "PostgreSQL", "MongoDB", "AWS", "Azure", "GCP", "Docker", "Kubernetes", "HTML", "CSS", "Figma", "Git",
  "GitHub", "Linux", "Terraform", "CI/CD", "Redis", "Prisma", "REST API", "GraphQL", "Next.js", "Vue",
  "Angular", "Svelte", "Tailwind", "Django", "Flask", "Spring", "Golang", "Go", "Rust", "PHP", "Laravel",
  "Ruby", "Rails", "Machine Learning", "Data Analysis", "Deep Learning", "PyTorch", "TensorFlow",
  "Pandas", "NumPy", "Scikit-Learn", "LangGraph", "LangChain", "LLM", "NLP", "Kafka", "RabbitMQ",
  "Elasticsearch", "Swift", "Kotlin", "React Native", "Flutter", "Android", "iOS", "Microservices"
];

const MOBILE_SKILLS = new Set(["swift", "kotlin", "react native", "flutter", "android", "ios"]);

const BASE_WEIGHTS: Record<JobAnalysisFactor["name"], number> = {
  skills: 40,
  role: 25,
  experience: 20,
  location: 15
};

const STOP_WORDS = new Set([
  "and", "the", "with", "for", "from", "that", "this", "our", "you", "your", "are", "will", "who", "has",
  "have", "using", "use", "work", "team", "role", "job", "years", "year", "experience", "ability", "strong",
  "required", "preferred", "must", "nice", "plus", "build", "develop", "create", "support", "built", "managed",
  "code", "system", "systems", "good", "great", "lead", "help", "working", "tools", "join", "looking", "apply",
  "candidate", "candidates", "skills", "knowledge", "understanding", "degree", "field", "related", "equivalent",
  "optimized", "leader", "agile", "engineer"
]);

const UNRELATED_DOMAINS = [
  "music licensing", "sales representative", "account executive", "insurance agent", "real estate",
  "branch manager", "customer service representative", "retail associate", "cashier", "nurse",
  "paralegal", "mortgage", "loan officer", "call center", "telemarketer", "marketing manager",
  "content creator", "financial advisor", "truck driver", "warehouse associate", "dental",
  "physician", "store manager", "business development representative", "bdr", "sdr", "advertising sales"
];

const SENIOR_KEYWORDS = ["director", "vp", "vice president", "head of", "principal", "chief", "executive", "lead architect", "partner", "engineering manager"];
const LEAD_KEYWORDS = ["senior", "lead", "staff", "architect", "tech lead", "sr.", "team lead"];
const ENTRY_KEYWORDS = ["intern", "internship", "graduate", "junior", "entry", "associate", "trainee", "new grad", "student", "apprentice"];

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWord(text: string, phrase: string): boolean {
  const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegex(phrase)}(?![A-Za-z0-9])`, "i");
  return pattern.test(text);
}

function extractTerms(text: string): Set<string> {
  const terms = new Set<string>();
  const matches = text.toLowerCase().match(/[a-z0-9+#.]+/g) ?? [];
  for (const m of matches) {
    if (m.length > 2 && !STOP_WORDS.has(m)) {
      terms.add(m);
    }
  }
  return terms;
}

function normalizeLocation(value: string): string {
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(" ");
}

export interface EligibilityResult {
  eligible: boolean;
  rejectionReason?: string;
  rejectionCategory?: "seniority_mismatch" | "unrelated_domain" | "mobile_domain_mismatch" | "unsupported_language" | "strict_remote_mismatch" | "location_mismatch" | "stale_posting";
}

/**
 * Validates language compatibility between candidate's declared languages and posting requirements.
 * Default candidate language is English if not explicitly set.
 */
export function checkLanguageEligibility(job: Job, declaredLanguages: string[] = []): EligibilityResult {
  const candidateLangs = new Set((declaredLanguages.length ? declaredLanguages : ["English"]).map(l => l.trim().toLowerCase()));
  const fullText = `${job.title} ${job.description}`.toLowerCase();

  // German requirements check
  const hasGermanIndicators = /\(m\/w\/d\)|\(w\/m\/d\)|\(m\/f\/d\)/i.test(job.title)
    || /\b(werkstudent|praktikant|praktikum|softwareentwickler|entwickler|fachinformatiker)\b/i.test(job.title)
    || /\b(flie(ß|ss)end(e)?\s+deutsch|gute\s+deutschkenntnisse|sehr\s+gute\s+deutschkenntnisse|deutschkenntnisse|deutsch\s+in\s+wort\s+und\s+schrift|verhandlungssicher(e)?\s+deutsch|deutsch\s+(b2|c1|c2)|fluent\s+german|german\s+(required|is\s+required|b2|c1|c2|fluent|fluency|proficiency)|c1\s+german|b2\s+german)\b/i.test(fullText)
    || /\b(wir\s+suchen|deine\s+aufgaben|dein\s+profil|was\s+wir\s+bieten|über\s+uns|du\s+bringst\s+mit|unsere\s+anforderungen)\b/i.test(fullText);

  if (hasGermanIndicators && !candidateLangs.has("german") && !candidateLangs.has("deutsch")) {
    return {
      eligible: false,
      rejectionCategory: "unsupported_language",
      rejectionReason: "Posting requires German language proficiency, which is not declared in the candidate profile."
    };
  }

  // French requirements check
  const hasFrenchIndicators = /\b(français\s+(courant|exigé|requis)|maîtrise\s+du\s+français|french\s+(required|fluent|fluency))\b/i.test(fullText)
    || /\b(nous\s+recherchons|vos\s+missions|votre\s+profil)\b/i.test(fullText);

  if (hasFrenchIndicators && !candidateLangs.has("french") && !candidateLangs.has("français")) {
    return {
      eligible: false,
      rejectionCategory: "unsupported_language",
      rejectionReason: "Posting requires French language proficiency, which is not declared in the candidate profile."
    };
  }

  return { eligible: true };
}

/**
 * Deterministic Seniority Gate: Hard exclusion when candidate profile targets entry/intern/graduate.
 * Never allows keyword scores to override senior/director roles.
 */
export function checkSeniorityEligibility(
  jobTitle: string,
  candidateJobTypes: string[] = [],
  candidateTargets: string[] = []
): EligibilityResult {
  const titleLower = jobTitle.toLowerCase();
  const targetText = `${candidateTargets.join(" ")} ${candidateJobTypes.join(" ")}`.toLowerCase();
  const candidateIsEntry = ENTRY_KEYWORDS.some(k => targetText.includes(k)) || !targetText.trim();

  if (candidateIsEntry) {
    if (SENIOR_KEYWORDS.some(kw => containsWord(titleLower, kw))) {
      return {
        eligible: false,
        rejectionCategory: "seniority_mismatch",
        rejectionReason: `Seniority mismatch: Role '${jobTitle}' is at Director/Executive level, incompatible with candidate's entry/graduate scope.`
      };
    }
    if (LEAD_KEYWORDS.some(kw => containsWord(titleLower, kw))) {
      return {
        eligible: false,
        rejectionCategory: "seniority_mismatch",
        rejectionReason: `Seniority mismatch: Role '${jobTitle}' requires senior/lead level experience, incompatible with candidate's entry/graduate scope.`
      };
    }
  }

  return { eligible: true };
}

/**
 * Domain & Mobile Relevance Gate:
 * Rejects unrelated industries and rejects specialized mobile roles when candidate does not target mobile.
 */
export function checkDomainEligibility(
  job: Job,
  technicalDomains: string[] = [],
  candidateSkills: string[] = []
): EligibilityResult {
  const titleLower = job.title.toLowerCase();

  // 1. Unrelated non-technical domains
  for (const domain of UNRELATED_DOMAINS) {
    if (containsWord(titleLower, domain)) {
      return {
        eligible: false,
        rejectionCategory: "unrelated_domain",
        rejectionReason: `Job role '${job.title}' belongs to an unrelated domain outside candidate's target technical scope.`
      };
    }
  }

  // 2. Mobile development domain gate
  const candidateHasMobileDomain = technicalDomains.some(d => /mobile|ios|android/i.test(d));
  const candidateHasMobileSkill = candidateSkills.some(s => MOBILE_SKILLS.has(s.trim().toLowerCase()));

  if (!candidateHasMobileDomain && !candidateHasMobileSkill) {
    const isMobileRole = /\b(ios\s+developer|ios\s+engineer|android\s+developer|android\s+engineer|mobile\s+app\s+developer|mobile\s+engineer|mobile\s+developer|react\s+native\s+developer|flutter\s+developer|swift\s+developer)\b/i.test(titleLower)
      || (/\b(ios|android|mobile\s+app)\b/i.test(titleLower) && /\b(developer|engineer|lead)\b/i.test(titleLower));

    if (isMobileRole) {
      return {
        eligible: false,
        rejectionCategory: "mobile_domain_mismatch",
        rejectionReason: `Role '${job.title}' requires specialized mobile development (iOS/Android), which is outside candidate's target technical domains and demonstrated skills.`
      };
    }
  }

  return { eligible: true };
}

/**
 * Freshness & availability check.
 */
export function checkFreshnessEligibility(job: Job): EligibilityResult {
  const desc = job.description.toLowerCase();
  if (/\b(no\s+longer\s+accepting\s+applications|this\s+job\s+has\s+expired|position\s+closed)\b/i.test(desc)) {
    return {
      eligible: false,
      rejectionCategory: "stale_posting",
      rejectionReason: "Job posting is marked closed and no longer accepting applications."
    };
  }
  return { eligible: true };
}

/**
 * Evaluates a single job against the candidate profile with strict eligibility gates.
 */
export function evaluateSingleJobLocally(job: Job, profile: AnalysisProfile): JobAnalysisResult {
  const desc = job.description;
  const fullText = `${job.title} ${desc} ${job.tags.join(" ")}`;

  // Run Hard Eligibility Gates First
  // 1. Language gate
  const langGate = checkLanguageEligibility(job, profile.languages ?? []);
  if (!langGate.eligible) {
    return createIneligibleResult(job, langGate.rejectionReason!, langGate.rejectionCategory!);
  }

  // 2. Domain & Mobile relevance gate
  const domainGate = checkDomainEligibility(job, profile.technicalDomains ?? [], profile.skills);
  if (!domainGate.eligible) {
    return createIneligibleResult(job, domainGate.rejectionReason!, domainGate.rejectionCategory!);
  }

  // 3. Seniority gate
  const seniorityGate = checkSeniorityEligibility(job.title, profile.jobTypes ?? [], profile.targetJobTitles);
  if (!seniorityGate.eligible) {
    return createIneligibleResult(job, seniorityGate.rejectionReason!, seniorityGate.rejectionCategory!);
  }

  // 4. Freshness gate
  const freshGate = checkFreshnessEligibility(job);
  if (!freshGate.eligible) {
    return createIneligibleResult(job, freshGate.rejectionReason!, freshGate.rejectionCategory!);
  }

  // 5. Work arrangement gate
  const actualArrangement = job.workArrangement ?? (job.remote === true ? "remote" : null);
  const workArrangements = profile.workArrangements ?? [];
  const strictRemoteMismatch = workArrangements.length === 1 && workArrangements[0] === "remote" && (job.remote === false || actualArrangement === "hybrid" || actualArrangement === "onsite");
  if (strictRemoteMismatch) {
    return createIneligibleResult(job, "Listing is marked non-remote while saved work arrangement is remote-only.", "strict_remote_mismatch");
  }

  // Location preference check
  const locationPrefs = [...(profile.preferredLocations ?? []), ...(profile.preferredCountries ?? [])];
  const jobLocationNorm = normalizeLocation(`${job.location} ${job.country ?? ""}`);
  const locationMatches = locationPrefs.filter(pref => {
    const norm = normalizeLocation(pref);
    return norm && ` ${jobLocationNorm} `.includes(` ${norm} `);
  });

  // Proceed with multi-factor scoring for eligible jobs
  // Factor 1: Skills
  const catalog = [...new Set([...SKILL_CATALOG, ...profile.skills])];
  const identifiedSkills = catalog.filter(skill => containsWord(fullText, skill));

  const profileSkillMap = new Map(profile.skills.map(s => [s.toLowerCase(), s]));
  const matchedSkills = identifiedSkills.filter(s => profileSkillMap.has(s.toLowerCase()));
  const missingSkills = identifiedSkills.filter(s => !profileSkillMap.has(s.toLowerCase()));

  const limitations: string[] = [];
  const unverified: string[] = [];

  const skillsAvailable = identifiedSkills.length > 0;
  if (!skillsAvailable) {
    limitations.push("No specific skills could be identified in the job title, tags, or description.");
    unverified.push("Job requirements do not list recognizable skills; skill fit is unknown.");
  } else if (!profile.skills.length) {
    limitations.push("The candidate profile does not list skills to compare.");
    unverified.push(...identifiedSkills.map(s => `Candidate skill not verified: ${s}.`));
  } else {
    unverified.push(...missingSkills.map(s => `Candidate skill not listed: ${s}.`));
  }

  const skillScore = skillsAvailable && profile.skills.length
    ? Math.round((100 * matchedSkills.length) / identifiedSkills.length)
    : (skillsAvailable ? 0 : null);

  const skillEvidence = matchedSkills.map(s => `Skill match: ${s}.`);
  const skillFactor: JobAnalysisFactor = {
    name: "skills",
    score: skillScore,
    weight: BASE_WEIGHTS.skills,
    available: skillsAvailable && profile.skills.length > 0,
    matchedEvidence: skillEvidence.slice(0, 20),
    limitations: !skillsAvailable || !profile.skills.length ? limitations.slice(0, 10) : []
  };

  // Factor 2: Role
  const titleTerms = extractTerms(job.title);
  const targetMatches: string[] = [];
  const roleScores: number[] = [];

  for (const target of profile.targetJobTitles) {
    const targetTerms = extractTerms(target);
    if (targetTerms.size > 0 && titleTerms.size > 0) {
      let overlapCount = 0;
      for (const t of targetTerms) {
        if (titleTerms.has(t)) overlapCount++;
      }
      const overlap = overlapCount / targetTerms.size;
      roleScores.push(Math.round(overlap * 100));
      if (overlap >= 0.4) {
        targetMatches.push(target);
      }
    }
  }

  const roleAvailable = profile.targetJobTitles.length > 0;
  const roleScore = roleScores.length > 0 ? Math.max(...roleScores) : (roleAvailable ? 0 : null);
  const roleEvidence = targetMatches.map(t => `Title overlaps target role: ${t}.`);
  const titleLower = job.title.toLowerCase();
  if (ENTRY_KEYWORDS.some(kw => containsWord(titleLower, kw))) {
    roleEvidence.push(`Role level aligns with target entry/graduate scope: ${job.title}.`);
  }

  const roleFactor: JobAnalysisFactor = {
    name: "role",
    score: roleScore,
    weight: BASE_WEIGHTS.role,
    available: roleAvailable,
    matchedEvidence: roleEvidence.slice(0, 20),
    limitations: roleAvailable ? [] : ["Target job titles are not set in the candidate profile."]
  };

  // Factor 3: Experience
  const experienceAvailable = profile.experience.length > 0 && Boolean(desc.trim());
  const experienceEvidence: string[] = [];
  const experienceLimits: string[] = [];
  let experienceScore: number | null = null;

  if (!profile.experience.length) {
    experienceLimits.push("No work experience evidence is available in the candidate profile.");
    unverified.push("Relevant experience could not be verified from the profile.");
  } else if (!desc.trim()) {
    experienceLimits.push("The job description is missing, so experience evidence cannot be compared.");
  } else {
    const expTechMatches: string[] = [];
    for (const exp of profile.experience) {
      const expText = `${exp.title} ${exp.company} ${exp.details}`;
      const matched = identifiedSkills.filter(s => containsWord(expText, s));
      for (const s of matched) {
        if (!expTechMatches.includes(s)) {
          expTechMatches.push(s);
          experienceEvidence.push(`Verified experience with ${s} at ${exp.company || "previous role"} aligns with job stack.`);
        }
      }
    }

    if (expTechMatches.length > 0) {
      experienceScore = Math.min(100, Math.round((100 * expTechMatches.length) / Math.max(1, Math.min(4, identifiedSkills.length))));
    } else {
      const hasTitleOverlap = profile.experience.some(exp => {
        const terms = extractTerms(exp.title);
        for (const t of terms) {
          if (titleTerms.has(t)) return true;
        }
        return false;
      });
      experienceScore = hasTitleOverlap ? 40 : 10;
      if (hasTitleOverlap) {
        experienceEvidence.push("Prior job title aligns with role domain.");
      }
    }
  }

  const experienceFactor: JobAnalysisFactor = {
    name: "experience",
    score: experienceScore,
    weight: BASE_WEIGHTS.experience,
    available: experienceAvailable,
    matchedEvidence: experienceEvidence.slice(0, 20),
    limitations: experienceLimits.slice(0, 10)
  };

  // Factor 4: Location
  let locationScore: number | null;
  const locationEvidence: string[] = [];

  if (!locationPrefs.length && workArrangements.includes("remote") && actualArrangement === "remote") {
    locationScore = 100;
    locationEvidence.push("The listing is marked remote and remote is a profile preference.");
  } else if (locationMatches.length > 0) {
    locationScore = 100;
    locationEvidence.push(...locationMatches.map(m => `Listing location matches profile preference: ${m}.`));
  } else if (locationPrefs.length > 0 && (job.location.trim() || job.country)) {
    locationScore = 30;
    unverified.push("Listed job location does not match a saved location preference; verify geographic eligibility.");
  } else {
    locationScore = null;
    unverified.push("Location/work preferences or listing location are missing; fit is unknown.");
  }

  unverified.push("Employer eligibility, work authorization, and sponsorship compatibility are unknown; verify with the employer.");
  const locationFactor: JobAnalysisFactor = {
    name: "location",
    score: locationScore,
    weight: BASE_WEIGHTS.location,
    available: (locationPrefs.length > 0 && Boolean(job.location.trim() || job.country)) || (workArrangements.length > 0 && (job.remote !== null || job.workArrangement !== null)),
    matchedEvidence: locationEvidence.slice(0, 20),
    limitations: ["Employer eligibility, work authorization, and sponsorship are not verified by the available listing data."]
  };

  const factors = [skillFactor, roleFactor, experienceFactor, locationFactor];
  const availableFactors = factors.filter(f => f.available && f.score !== null);
  const totalWeight = availableFactors.reduce((sum, f) => sum + BASE_WEIGHTS[f.name], 0);

  let finalScore: number | null = null;
  if (totalWeight > 0) {
    for (const factor of factors) {
      factor.weight = factor.available && factor.score !== null
        ? Math.round((BASE_WEIGHTS[factor.name] * 100) / totalWeight)
        : 0;
    }
    const currentSum = factors.reduce((sum, f) => sum + f.weight, 0);
    if (availableFactors.length > 0 && currentSum !== 100) {
      availableFactors[0].weight += 100 - currentSum;
    }
    const weighted = availableFactors.reduce((sum, f) => sum + (f.score ?? 0) * BASE_WEIGHTS[f.name], 0);
    finalScore = Math.round(weighted / totalWeight);
  }

  const incompleteDescription = desc.trim().length < 200;
  const confidenceReasons: string[] = [];
  if (incompleteDescription) {
    confidenceReasons.push("The job description is missing or very short; evaluation is less complete.");
  }
  if (!identifiedSkills.length) {
    confidenceReasons.push("No explicit recognizable skill requirements were found.");
  }
  if (!profile.experience.length) {
    confidenceReasons.push("The profile has no work experience entries.");
  }

  const confidence: JobAnalysisResult["confidence"] = incompleteDescription || availableFactors.length === 0
    ? "low"
    : (availableFactors.length >= 3 && identifiedSkills.length > 0 ? "high" : "medium");

  let recommendation: JobAnalysisResult["recommendation"];
  let explanation: string[];

  if (finalScore === null) {
    recommendation = "unknown";
    explanation = ["There is not enough profile or job information to estimate fit."];
  } else if (finalScore >= 75) {
    recommendation = "strong_match";
    explanation = ["Candidate profile exhibits strong evidence of technical alignment and role fit."];
  } else if (finalScore >= 50) {
    recommendation = "potential_match";
    explanation = ["Key profile signals align; review missing or unverified skill requirements."];
  } else {
    recommendation = "low_match";
    explanation = ["Limited profile evidence aligns with this listing."];
  }

  if (incompleteDescription) {
    explanation.push("The description is incomplete, so this ranking has limited confidence.");
  }

  return {
    sourceId: job.sourceId,
    source: job.source,
    title: job.title,
    company: job.company,
    location: job.location,
    country: job.country,
    workArrangement: actualArrangement,
    url: job.url,
    remote: job.remote,
    score: finalScore,
    recommendation,
    confidence,
    confidenceReasons,
    factorBreakdown: factors,
    matchedEvidence: factors.flatMap(f => f.matchedEvidence).slice(0, 30),
    missingOrUnverified: [...new Set(unverified)].slice(0, 30),
    explanation,
    eligible: true,
    rejectionReason: null,
    rejectionCategory: null
  };
}

function createIneligibleResult(job: Job, reason: string, category: EligibilityResult["rejectionCategory"]): JobAnalysisResult {
  return {
    sourceId: job.sourceId,
    source: job.source,
    title: job.title,
    company: job.company,
    location: job.location,
    country: job.country,
    workArrangement: job.workArrangement ?? (job.remote === true ? "remote" : null),
    url: job.url,
    remote: job.remote,
    score: 0,
    recommendation: "ineligible",
    confidence: "high",
    confidenceReasons: ["Excluded by deterministic eligibility gate."],
    factorBreakdown: [],
    matchedEvidence: [],
    missingOrUnverified: [reason],
    explanation: [reason],
    eligible: false,
    rejectionReason: reason,
    rejectionCategory: category ?? null
  };
}

export function evaluateJobsLocally(profile: AnalysisProfile, jobs: Job[]): JobAnalysisResult[] {
  return jobs
    .map(job => evaluateSingleJobLocally(job, profile))
    .sort((a, b) => {
      if (a.eligible && !b.eligible) return -1;
      if (!a.eligible && b.eligible) return 1;
      if (a.score === null && b.score !== null) return 1;
      if (a.score !== null && b.score === null) return -1;
      return (b.score ?? 0) - (a.score ?? 0);
    });
}
