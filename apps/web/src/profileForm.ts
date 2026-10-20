import { candidateProfileSchema, type CandidateProfileInput } from "@applypilot/shared";

export type AddItemResult = { values: string[]; added: true } | { values: string[]; added: false; reason: "empty" | "duplicate" | "limit" };

export function addProfileItem(values: string[], draft: string, limit: number): AddItemResult {
  const value = draft.trim();
  if (!value) return { values, added: false, reason: "empty" };
  if (values.some(item => item.toLowerCase() === value.toLowerCase())) return { values, added: false, reason: "duplicate" };
  if (values.length >= limit) return { values, added: false, reason: "limit" };
  return { values: [...values, value], added: true };
}

export function removeProfileItem<T>(values: T[], index: number): T[] {
  return values.filter((_, itemIndex) => itemIndex !== index);
}

export function mergeResumeProfile(current: CandidateProfileInput, extracted: CandidateProfileInput): CandidateProfileInput {
  const merged = { ...current };
  for (const key of ["fullName", "professionalSummary", "resumeText"] as const) if (extracted[key].trim()) merged[key] = extracted[key];
  merged.skills = [...current.skills, ...extracted.skills.filter(item => !current.skills.some(existing => existing.toLowerCase() === item.toLowerCase()))].slice(0, 50);
  for (const key of ["education", "experience", "projects"] as const) if (extracted[key].length) merged[key] = [...current[key], ...extracted[key]].slice(0, key === "education" ? 20 : 30) as never;
  return candidateProfileSchema.parse(merged);
}

export async function uploadResume(file: File, request: typeof fetch = fetch, endpoint = "/api/profile/resume") {
  const form = new FormData(); form.append("resume", file);
  const response = await request(endpoint, { method: "POST", body: form });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(body?.error?.message ?? "Could not parse this resume.");
  return body as { profile: CandidateProfileInput; contact: { email: string; phone: string }; found: string[]; uncertain: string[] };
}

export async function saveCandidateProfile(profile: CandidateProfileInput, request: typeof fetch = fetch, endpoint = "/api/profile"): Promise<CandidateProfileInput> {
  const input = candidateProfileSchema.parse(profile);
  const response = await request(endpoint, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    const detail = Array.isArray(body?.error?.details)
      ? body.error.details.map((item: { path?: string; message?: string }) => `${item.path || "Profile"}: ${item.message || "Invalid value"}`).join("\n")
      : "";
    const error = new Error(body?.error?.message ?? "Could not save your profile.") as Error & { details?: string };
    error.details = detail;
    throw error;
  }
  return candidateProfileSchema.parse(body);
}
