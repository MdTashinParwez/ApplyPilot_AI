import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateProfileSchema, type CandidateProfileInput } from "@applypilot/shared";
import { addProfileItem, mergeResumeProfile, removeProfileItem, saveCandidateProfile, uploadResume } from "./profileForm.ts";

const emptyProfile = () => candidateProfileSchema.parse({});

test("profile list add trims and appends, while empty, duplicate and over-limit entries are rejected", () => {
  const initial = ["TypeScript"];
  const added = addProfileItem(initial, "  React  ", 5);
  assert.equal(added.added, true);
  if (added.added) assert.deepEqual(added.values, ["TypeScript", "React"]);
  const duplicate = addProfileItem(["React"], " react ", 5);
  const empty = addProfileItem(initial, "   ", 5);
  const overLimit = addProfileItem(initial, "Node", 1);
  assert.equal(duplicate.added, false);
  assert.equal(empty.added, false);
  assert.equal(overLimit.added, false);
  if (!duplicate.added) assert.equal(duplicate.reason, "duplicate");
  if (!empty.added) assert.equal(empty.reason, "empty");
  if (!overLimit.added) assert.equal(overLimit.reason, "limit");
  assert.deepEqual(initial, ["TypeScript"]);
});

test("profile list removal removes only the requested item without mutating the original", () => {
  const values = ["React", "Vue", "Svelte"];
  assert.deepEqual(removeProfileItem(values, 1), ["React", "Svelte"]);
  assert.deepEqual(values, ["React", "Vue", "Svelte"]);
});

test("save sends the latest validated profile and returns the server-confirmed profile", async () => {
  const profile: CandidateProfileInput = { ...emptyProfile(), fullName: "Jordan Lee", skills: ["React"] };
  let capturedUrl = "";
  let capturedBody = "";
  const request = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedBody = String(init?.body);
    return new Response(JSON.stringify({ ...JSON.parse(capturedBody), createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z" }), { status: 200 });
  }) as typeof fetch;
  const saved = await saveCandidateProfile(profile, request, "/api/profile");
  assert.equal(capturedUrl, "/api/profile");
  assert.equal(JSON.parse(capturedBody).fullName, "Jordan Lee");
  assert.deepEqual(saved.skills, ["React"]);
});

test("save failure is actionable and validation prevents the request", async () => {
  let requests = 0;
  const request = (async () => {
    requests++;
    return new Response(JSON.stringify({ error: { code: "DATABASE_UNAVAILABLE", message: "Database unavailable" } }), { status: 503 });
  }) as typeof fetch;
  await assert.rejects(saveCandidateProfile(emptyProfile(), request), /Database unavailable/);
  const invalid = { ...emptyProfile(), minimumSalary: -1 } as CandidateProfileInput;
  await assert.rejects(saveCandidateProfile(invalid, request));
  assert.equal(requests, 1);
});

test("saved profile can be reloaded through the API after save", async () => {
  let persisted: CandidateProfileInput | undefined;
  const request = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") {
      persisted = JSON.parse(String(init.body)) as CandidateProfileInput;
      return new Response(JSON.stringify(persisted), { status: 200 });
    }
    return new Response(JSON.stringify(persisted), { status: 200 });
  }) as typeof fetch;
  const expected = { ...emptyProfile(), targetJobTitles: ["Frontend Engineer"] };
  await saveCandidateProfile(expected, request);
  const response = await request("/api/profile");
  const reloaded = candidateProfileSchema.parse(await response.json());
  assert.deepEqual(reloaded.targetJobTitles, ["Frontend Engineer"]);
});

test("resume import merges detected values and preserves profile values the parser missed", () => {
  const current = { ...emptyProfile(), fullName: "Existing Name", skills: ["React"], preferredCountries: ["Canada"] };
  const extracted = { ...emptyProfile(), fullName: "Parsed Name", skills: ["TypeScript", "react"], resumeText: "Resume text" };
  const merged = mergeResumeProfile(current, extracted);
  assert.equal(merged.fullName, "Parsed Name"); assert.deepEqual(merged.skills, ["React", "TypeScript"]);
  assert.deepEqual(merged.preferredCountries, ["Canada"]); assert.equal(merged.resumeText, "Resume text");
});

test("resume upload posts multipart data and surfaces safe API validation messages", async () => {
  const file = new File(["fixture"], "resume.pdf", { type: "application/pdf" });
  let requestBody: BodyInit | null | undefined;
  const request = (async (_input: RequestInfo | URL, init?: RequestInit) => { requestBody = init?.body; return new Response(JSON.stringify({ profile: emptyProfile(), contact: { email: "", phone: "" }, found: [], uncertain: [] })); }) as typeof fetch;
  await uploadResume(file, request);
  assert.ok(requestBody instanceof FormData); assert.equal((requestBody as FormData).get("resume"), file);
  const failing = (async () => new Response(JSON.stringify({ error: { message: "Only PDF and DOCX resumes are supported." } }), { status: 400 })) as typeof fetch;
  await assert.rejects(uploadResume(file, failing), /Only PDF and DOCX/);
});
