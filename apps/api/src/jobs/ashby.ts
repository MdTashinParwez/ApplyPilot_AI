import type { Job } from "@applypilot/shared";
import type { JobAdapter } from "./arbeitnow.js";
import { normalizeExternalJob } from "./publicSources.js";

type Fetcher = typeof fetch;

export const DEFAULT_ASHBY_COMPANIES = [
  "ramp",
  "anysphere",
  "perplexity",
  "retool",
  "sierra",
  "together-ai",
  "postman",
  "replit",
  "glean",
  "modal",
  "elevenlabs"
];

export function createAshbySource(
  fetcher: Fetcher = fetch,
  additionalCompanies: string[] = []
): JobAdapter {
  const envCompanies = (process.env.ASHBY_COMPANIES ?? "")
    .split(",")
    .map(c => c.trim().toLowerCase())
    .filter(Boolean);

  const targetCompanies = Array.from(new Set([
    ...(envCompanies.length > 0 ? envCompanies : DEFAULT_ASHBY_COMPANIES),
    ...additionalCompanies
  ]));

  return {
    id: "ashby" as any,
    name: "Ashby",
    attribution: "Ashby Public ATS",
    limitations: [
      `Autonomous ATS discovery across supported tech and AI employers (${targetCompanies.slice(0, 4).join(", ")}, ...) with verified application links.`
    ],
    async fetchJobs(): Promise<Job[]> {
      const results = await Promise.allSettled(
        targetCompanies.slice(0, 15).map(async company => {
          try {
            const response = await fetcher(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company)}`, {
              headers: {
                Accept: "application/json",
                "User-Agent": "ApplyPilotAI/1.0 (job-discovery-agent)"
              },
              signal: AbortSignal.timeout(8000)
            });

            if (!response.ok) return [];
            const data = await response.json() as { jobs?: Array<Record<string, unknown>> };
            if (!Array.isArray(data.jobs)) return [];

            return data.jobs.map(item => {
              const title = typeof item.title === "string" ? item.title : "";
              const location = typeof item.location === "string" ? item.location : "";
              const url = typeof item.jobUrl === "string" ? item.jobUrl : "";
              const desc = typeof item.descriptionHtml === "string" ? item.descriptionHtml : "";
              const publishedAt = typeof item.publishedAt === "string" ? item.publishedAt : undefined;
              const department = typeof item.department === "string" ? item.department : "";
              const employmentType = typeof item.employmentType === "string" ? item.employmentType : "";

              return normalizeExternalJob(
                "ashby" as any,
                item.id,
                title,
                company.charAt(0).toUpperCase() + company.slice(1),
                location,
                url,
                desc,
                /remote/i.test(location),
                publishedAt,
                [department, employmentType].filter(Boolean),
                "Ashby"
              );
            }).filter((j): j is Job => j !== null);
          } catch {
            return [];
          }
        })
      );

      return results.flatMap(r => r.status === "fulfilled" ? r.value : []);
    }
  };
}

