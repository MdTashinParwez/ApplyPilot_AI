import { createHash } from "node:crypto";
import type { Job } from "@applypilot/shared";
import type { JobAdapter } from "./arbeitnow.js";
import { normalizeExternalJob } from "./publicSources.js";

type Fetcher = typeof fetch;

export interface ExtractedJobPosting {
  title?: string;
  company?: string;
  location?: string;
  country?: string;
  url?: string;
  description?: string;
  datePosted?: string;
  validThrough?: string;
  employmentType?: string | string[];
  remote?: boolean;
}

const DEFAULT_CRAWLER_USER_AGENT = "ApplyPilotAI/1.0 (job-discovery-crawler; +https://applypilot.ai)";

export function parseJsonLdJobPostings(html: string, fallbackUrl = ""): ExtractedJobPosting[] {
  const jsonLdScripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis)];
  const extracted: ExtractedJobPosting[] = [];

  for (const scriptMatch of jsonLdScripts) {
    try {
      const parsed = JSON.parse(scriptMatch[1].trim());
      const items = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.["@graph"])
          ? parsed["@graph"]
          : [parsed];

      for (const item of items) {
        if (!item || typeof item !== "object") continue;

        const itemType = item["@type"];
        const isJobPosting = itemType === "JobPosting" ||
          (Array.isArray(itemType) && itemType.includes("JobPosting"));

        if (!isJobPosting) continue;

        // Skip expired jobs if validThrough is specified and past
        if (typeof item.validThrough === "string") {
          const expiration = Date.parse(item.validThrough);
          if (Number.isFinite(expiration) && expiration < Date.now()) {
            continue;
          }
        }

        const title = typeof item.title === "string" ? item.title.trim() : "";
        const company = typeof item.hiringOrganization === "object" && item.hiringOrganization !== null
          ? (typeof item.hiringOrganization.name === "string" ? item.hiringOrganization.name.trim() : "")
          : typeof item.hiringOrganization === "string"
            ? item.hiringOrganization.trim()
            : "";

        let location = "";
        let country: string | undefined;

        if (item.jobLocation) {
          const locObj = Array.isArray(item.jobLocation) ? item.jobLocation[0] : item.jobLocation;
          if (locObj?.address) {
            const addr = locObj.address;
            const parts = [
              typeof addr === "string" ? addr : null,
              typeof addr.streetAddress === "string" ? addr.streetAddress : null,
              typeof addr.addressLocality === "string" ? addr.addressLocality : null,
              typeof addr.addressRegion === "string" ? addr.addressRegion : null,
              typeof addr.addressCountry === "string" ? addr.addressCountry : (typeof addr.addressCountry?.name === "string" ? addr.addressCountry.name : null)
            ].filter(Boolean);
            location = parts.join(", ");
            if (addr.addressCountry) {
              country = typeof addr.addressCountry === "string" ? addr.addressCountry : addr.addressCountry.name;
            }
          }
        }

        if (!location && item.applicantLocationRequirements) {
          const req = item.applicantLocationRequirements;
          location = typeof req.name === "string" ? req.name : (typeof req === "string" ? req : "");
        }

        const isTelecommute = item.jobLocationType === "TELECOMMUTE" ||
          /remote|telecommute|anywhere|worldwide/i.test(location);

        const postingUrl = typeof item.url === "string" && item.url.trim()
          ? item.url.trim()
          : fallbackUrl;

        const description = typeof item.description === "string" ? item.description : "";
        const datePosted = typeof item.datePosted === "string" ? item.datePosted : undefined;
        const employmentType = item.employmentType;

        if (title) {
          extracted.push({
            title,
            company,
            location,
            country,
            url: postingUrl,
            description,
            datePosted,
            validThrough: typeof item.validThrough === "string" ? item.validThrough : undefined,
            employmentType,
            remote: isTelecommute
          });
        }
      }
    } catch {
      // Ignore malformed JSON-LD block and continue parsing other scripts
    }
  }

  return extracted;
}

export function detectDiscoveredAtsLinks(html: string): Array<{ ats: "greenhouse" | "lever" | "ashby"; company: string; url: string }> {
  const discovered: Array<{ ats: "greenhouse" | "lever" | "ashby"; company: string; url: string }> = [];
  const linkMatches = [...html.matchAll(/href=["'](https?:\/\/[^"'>]+)["']/gi)];

  for (const match of linkMatches) {
    const rawUrl = match[1];
    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.toLowerCase();

      if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
        const parts = parsed.pathname.split("/").filter(Boolean);
        if (parts.length >= 1 && /^[a-z0-9_-]+$/i.test(parts[0])) {
          discovered.push({ ats: "greenhouse", company: parts[0].toLowerCase(), url: rawUrl });
        }
      } else if (host === "jobs.lever.co") {
        const parts = parsed.pathname.split("/").filter(Boolean);
        if (parts.length >= 1 && /^[a-z0-9_-]+$/i.test(parts[0])) {
          discovered.push({ ats: "lever", company: parts[0].toLowerCase(), url: rawUrl });
        }
      } else if (host === "jobs.ashbyhq.com") {
        const parts = parsed.pathname.split("/").filter(Boolean);
        if (parts.length >= 1 && /^[a-z0-9_-]+$/i.test(parts[0])) {
          discovered.push({ ats: "ashby", company: parts[0].toLowerCase(), url: rawUrl });
        }
      }
    } catch {
      // Ignore invalid URL
    }
  }

  return discovered;
}

export function createCareerPageCrawlerSource(
  fetcher: Fetcher = fetch,
  targetUrls: string[] = []
): JobAdapter {
  const envUrls = (process.env.CAREER_PAGE_URLS ?? "")
    .split(",")
    .map(u => u.trim())
    .filter(u => /^https?:\/\//i.test(u));

  const allTargetUrls = Array.from(new Set([...envUrls, ...targetUrls]));

  return {
    id: "career_page" as any,
    name: "Career Page Crawler",
    attribution: "Permitted Company Career Pages",
    limitations: [
      `Autonomous crawling of permitted company career pages (${allTargetUrls.length} configured) via Schema.org JobPosting microdata.`
    ],
    async fetchJobs(): Promise<Job[]> {
      if (allTargetUrls.length === 0) return [];

      const results = await Promise.allSettled(
        allTargetUrls.slice(0, 15).map(async targetUrl => {
          try {
            const response = await fetcher(targetUrl, {
              headers: {
                Accept: "text/html,application/xhtml+xml,application/json",
                "User-Agent": DEFAULT_CRAWLER_USER_AGENT
              },
              signal: AbortSignal.timeout(8000)
            });

            if (!response.ok) return [];

            const html = await response.text();
            const extracted = parseJsonLdJobPostings(html, targetUrl);

            return extracted.map(item => {
              const types: string[] = [];
              const rawType = Array.isArray(item.employmentType)
                ? item.employmentType.join(" ")
                : (item.employmentType ?? "");
              const combinedText = `${item.title ?? ""} ${rawType}`.toLowerCase();

              if (/intern|internship|co-op/i.test(combinedText)) types.push("internship");
              if (/graduate|new grad/i.test(combinedText)) types.push("graduate");
              if (/junior|entry|associate/i.test(combinedText)) types.push("entry_level");

              const id = createHash("sha256").update(item.url || targetUrl).digest("hex").slice(0, 32);

              return normalizeExternalJob(
                "career_page" as any,
                id,
                item.title,
                item.company || new URL(targetUrl).hostname.replace(/^www\./, ""),
                item.location,
                item.url || targetUrl,
                item.description,
                item.remote,
                item.datePosted,
                types,
                "Company Career Page"
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

