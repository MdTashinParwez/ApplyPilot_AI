import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import request from "supertest";
import type { ApplicationRecord, CreateApplicationInput } from "@applypilot/shared";
import { createApp } from "./app.js";
import type { ApplicationRepository } from "./repository.js";

const now = new Date("2026-10-19T12:00:00.000Z");
const record: ApplicationRecord = {
  id: "application_123",
  company: "Linear",
  role: "Product Designer",
  location: "Remote",
  jobUrl: "https://linear.app/careers",
  status: "saved",
  notes: "Follow up next week",
  createdAt: now.toISOString(),
  updatedAt: now.toISOString()
};

let originalConsoleError: typeof console.error;
before(() => { originalConsoleError = console.error; console.error = () => undefined; });
after(() => { console.error = originalConsoleError; });

function makeRepository(overrides: Partial<ApplicationRepository> = {}) {
  const repository: ApplicationRepository = {
    list: async () => [],
    create: async (_data: CreateApplicationInput) => record,
    ping: async () => undefined,
    ...overrides
  };
  return repository;
}

test("POST /api/applications validates and creates a record", async () => {
  let received: CreateApplicationInput | undefined;
  const app = createApp(makeRepository({ create: async data => { received = data; return record; } }));
  const response = await request(app).post("/api/applications").send({
    company: "Linear", role: "Product Designer", location: "Remote", jobUrl: "https://linear.app/careers", notes: "Follow up next week"
  });

  assert.equal(response.status, 201);
  assert.deepEqual(received, { company: "Linear", role: "Product Designer", location: "Remote", jobUrl: "https://linear.app/careers", status: "saved", notes: "Follow up next week" });
  assert.deepEqual(response.body, record);
});

test("POST /api/applications rejects invalid input before writing", async () => {
  let createCalled = false;
  const app = createApp(makeRepository({ create: async () => { createCalled = true; return record; } }));
  const response = await request(app).post("/api/applications").send({ company: "", role: "Designer", status: "pending" });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
  assert.ok(response.body.error.details.length > 0);
  assert.equal(createCalled, false);
});

test("database errors return a consistent 503 response without leaking details", async () => {
  const app = createApp(makeRepository({ list: async () => { throw new Error("password=do-not-leak"); } }));
  const response = await request(app).get("/api/applications");

  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: { code: "DATABASE_UNAVAILABLE", message: "The database is temporarily unavailable" } });
  assert.equal(JSON.stringify(response.body).includes("do-not-leak"), false);
});

test("database create failures return the same service-unavailable error", async () => {
  const app = createApp(makeRepository({ create: async () => { throw new Error("connection refused"); } }));
  const response = await request(app).post("/api/applications").send({ company: "Linear", role: "Designer" });

  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, "DATABASE_UNAVAILABLE");
  assert.equal(response.body.error.message, "The database is temporarily unavailable");
});

test("health contract reports a disconnected database without taking the API offline", async () => {
  const app = createApp(makeRepository({ ping: async () => { throw new Error("offline"); } }));
  const response = await request(app).get("/api/health");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: "ok", database: "disconnected" });
});
