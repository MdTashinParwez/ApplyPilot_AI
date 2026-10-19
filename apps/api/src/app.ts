import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { createApplicationSchema, type ApplicationRecord } from "@applypilot/shared";
import type { ApplicationRepository } from "./repository.js";

class DatabaseUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Database operation failed", { cause });
    this.name = "DatabaseUnavailableError";
  }
}

function serialize(record: ApplicationRecord) {
  return { ...record, createdAt: new Date(record.createdAt).toISOString(), updatedAt: new Date(record.updatedAt).toISOString() };
}

export function createApp(repository: ApplicationRepository) {
  const app = express();
  app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:5173" }));
  app.use(express.json({ limit: "32kb" }));

  app.get("/api/health", async (_req, res) => {
    let database: "connected" | "disconnected" = "connected";
    try { await repository.ping(); } catch { database = "disconnected"; }
    res.json({ status: "ok", database });
  });

  app.get("/api/applications", async (_req, res, next) => {
    try {
      const applications = await repository.list();
      res.json(applications.map(serialize));
    } catch (error) { next(new DatabaseUnavailableError(error)); }
  });

  app.post("/api/applications", async (req, res, next) => {
    try {
      const input = createApplicationSchema.parse(req.body);
      const application = await repository.create(input);
      res.status(201).json(serialize(application));
    } catch (error) {
      next(error instanceof ZodError ? error : new DatabaseUnavailableError(error));
    }
  });

  app.use("/api", (_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "API route not found" } }));

  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ZodError) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Request validation failed", details: error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })) } });
      return;
    }
    if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON" } });
      return;
    }
    if (error instanceof DatabaseUnavailableError) {
      console.error("Database operation failed:", error.cause);
      res.status(503).json({ error: { code: "DATABASE_UNAVAILABLE", message: "The database is temporarily unavailable" } });
      return;
    }
    console.error(error);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } });
  };
  app.use(errors);
  return app;
}
