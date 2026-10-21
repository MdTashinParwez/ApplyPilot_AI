import assert from "node:assert/strict";
import { test } from "node:test";
import type { Job } from "@applypilot/shared";
import type { JobAdapter } from "./arbeitnow.js";
import { createJobSourceRegistry, createPublicJobAdapters, normalizeExternalJob } from "./publicSources.js";

const job = (updates: Partial<Job> = {}): Job => ({
  sourceId: "stable", source: "remotive", sourceAttribution: "Remotive", title: "Backend Engineer", company: "Example",
  location: "Toronto, Canada", country: "Canada", workArrangement: "remote", url: "https://jobs.example.test/1", description: "Python API role",
  remote: true, publishedAt: null, tags: [], jobTypes: [], ...updates
});

test("normalizes source fields, canonical URLs, and safely omits unusable records", () => {
  const normalized = normalizeExternalJob("remotive", undefined, " Engineer ", "Co", "Toronto, Canada", "https://jobs.example.test/1?utm_source=feed#top", "<b>Python</b> role", null, undefined, [], "Remotive");
  assert.ok(normalized);
  assert.equal(normalized.sourceId, normalizeExternalJob("remotive", undefined, " Engineer ", "Co", "Toronto, Canada", "https://jobs.example.test/1?utm_source=feed#top", "", null)?.sourceId);
  assert.equal(normalized.url, "https://jobs.example.test/1");
  assert.equal(normalized.country, "Canada");
  assert.equal(normalizeExternalJob("remotive", "1", "", "Co", "", "", "", true), null);
  assert.equal(normalizeExternalJob("remotive", "1", "Engineer", "Co", "", "javascript:alert(1)", "", true), null);
});

test("Remotive and Remote OK adapters normalize public feed records", async () => {
  const fetcher: typeof fetch = async input => {
    const url = String(input);
    if (url.startsWith("https://remotive.com/")) return new Response(JSON.stringify({ jobs: [{ id: 7, title: "API Engineer", company_name: "Demo", candidate_required_location: "Canada", url: "https://remotive.com/jobs/7", description: "Python", publication_date: "2026-01-01", category: "Software" }] }));
    if (url === "https://remoteok.com/api") return new Response(JSON.stringify([{ id: "meta" }, { id: "8", position: "Frontend Engineer", company: "Sample", location: "Worldwide", url: "https://remoteok.com/8", description: "React", date: "2026-01-02", tags: ["react"] }]));
    return new Response(JSON.stringify({ data: [] }));
  };
  const adapters = createPublicJobAdapters(fetcher);
  const remotive = await adapters.find(item => item.id === "remotive")!.fetchJobs();
  const remoteOk = await adapters.find(item => item.id === "remote_ok")!.fetchJobs();
  assert.equal(remotive[0]?.source, "remotive");
  assert.equal(remotive[0]?.country, "Canada");
  assert.equal(remoteOk[0]?.source, "remote_ok");
  assert.equal(remoteOk[0]?.sourceAttribution, "Remote OK");
});

test("registry deduplicates repeated canonical listings, filters country and reports partial source failures", async () => {
  let calls = 0;
  const adapters: JobAdapter[] = [
    { id: "remotive", name: "Remotive", attribution: "Remotive", limitations: ["bounded"], fetchJobs: async () => { calls++; return [job({ url: "https://jobs.example.test/1?utm_source=x" }), job({ sourceId: "2", country: "India", location: "Bengaluru, India", url: "https://jobs.example.test/2" })]; } },
    { id: "remote_ok", name: "Remote OK", attribution: "Remote OK", limitations: [], fetchJobs: async () => [job({ source: "remote_ok", sourceId: "copy", url: "https://jobs.example.test/1#section" })] },
    { id: "arbeitnow", name: "Arbeitnow", attribution: "Arbeitnow", limitations: [], fetchJobs: async () => { throw new Error("upstream detail must not escape"); } }
  ];
  const registry = createJobSourceRegistry(adapters);
  const results = await Promise.all([registry.search({ keyword: "", location: "", country: "Canada", sources: "", remoteOnly: false, includeMatches: false, page: 1, pageSize: 12 }), registry.search({ keyword: "", location: "", country: "Canada", sources: "", remoteOnly: false, includeMatches: false, page: 1, pageSize: 12 })]);
  assert.equal(results[0]!.jobs.length, 1);
  assert.equal(results[0]!.jobs[0]!.source, "remotive");
  assert.equal(results[0]!.sources?.find(source => source.id === "arbeitnow")?.status, "error");
  assert.equal(results[0]!.jobs.length, results[1]!.jobs.length);
  assert.equal(calls, 2);
  const byCity = await registry.search({ keyword: "", location: "toronto", country: "", sources: "", remoteOnly: false, includeMatches: false, page: 1, pageSize: 12 });
  assert.equal(byCity.jobs.length, 1);
  const byOtherCity = await registry.search({ keyword: "", location: "Mumbai", country: "", sources: "", remoteOnly: false, includeMatches: false, page: 1, pageSize: 12 });
  assert.equal(byOtherCity.jobs.length, 0);
});
