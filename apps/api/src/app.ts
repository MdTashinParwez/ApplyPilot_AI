import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import multer from "multer";
import { mkdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { candidateProfileSchema, createApplicationSchema, jobSearchSchema, saveJobSchema, type ApplicationRecord, type CandidateProfileInput } from "@applypilot/shared";
import type { ApplicationRepository } from "./repository.js";
import { createArbeitnowSource, JobSourceError, type JobSource } from "./jobs/arbeitnow.js";
import { extractResumeText, ResumeParseError } from "./resume/extract.js";
import { parseResume } from "./resume/parse.js";

const configuredResumeLimit = Number(process.env.RESUME_MAX_SIZE_MB ?? 5);
const resumeLimit = (Number.isFinite(configuredResumeLimit) ? Math.max(1, configuredResumeLimit) : 5) * 1024 * 1024;
const resumeTemp = path.join(tmpdir(), "applypilot-resumes");
const resumeUpload = multer({
  storage: multer.diskStorage({ destination: (_req, _file, callback) => { void mkdir(resumeTemp, { recursive: true }).then(() => callback(null, resumeTemp)).catch(error => callback(error as NodeJS.ErrnoException, "")); }, filename: (_req, _file, callback) => callback(null, `${randomUUID()}.upload`) }),
  limits: { fileSize: resumeLimit, files: 1, fields: 0 },
  fileFilter: (_req, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const valid = (ext === ".pdf" && file.mimetype === "application/pdf") || (ext === ".docx" && file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    if (valid) callback(null, true); else callback(new Error("Only PDF and DOCX resumes are supported."));
  }
});

class DatabaseUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Database operation failed", { cause });
    this.name = "DatabaseUnavailableError";
  }
}

function serialize(record: ApplicationRecord) {
  return { ...record, createdAt: new Date(record.createdAt).toISOString(), updatedAt: new Date(record.updatedAt).toISOString() };
}

export function createApp(repository: ApplicationRepository, jobSource: JobSource = createArbeitnowSource()) {
  const app = express();
  app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:5173" }));
  app.use(express.json({ limit: "512kb" }));

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

  app.get("/api/profile", async (_req, res, next) => {
    try {
      const profile = await repository.getProfile();
      res.json(profile ?? { ...candidateProfileSchema.parse({}), createdAt: null, updatedAt: null });
    } catch (error) { next(new DatabaseUnavailableError(error)); }
  });

  app.put("/api/profile", async (req, res, next) => {
    try {
      const input: CandidateProfileInput = candidateProfileSchema.parse(req.body);
      res.json(await repository.upsertProfile(input));
    } catch (error) {
      next(error instanceof ZodError ? error : new DatabaseUnavailableError(error));
    }
  });

  app.post("/api/profile/resume", (req, res, next) => {
    resumeUpload.single("resume")(req, res, async error => {
      if (error) { next(error); return; }
      const file = req.file;
      if (!file) { res.status(400).json({ error: { code: "RESUME_REQUIRED", message: "Choose a PDF or DOCX resume to upload." } }); return; }
      try {
        const ext = path.extname(file.originalname).toLowerCase();
        const bytes = await import("node:fs/promises").then(fs => fs.readFile(file.path));
        const validSignature = ext === ".pdf" ? bytes.subarray(0, 5).toString() === "%PDF-" : bytes.subarray(0, 4).toString("hex") === "504b0304";
        if (!validSignature) { res.status(400).json({ error: { code: "INVALID_DOCUMENT", message: "The file content does not match a valid PDF or DOCX document." } }); return; }
        const text = await extractResumeText(file.path, ext);
        res.json(parseResume(text));
      } catch (cause) {
        if (cause instanceof ResumeParseError) { res.status(422).json({ error: { code: cause.code, message: cause.message } }); return; }
        next(cause);
      } finally { await unlink(file.path).catch(() => undefined); }
    });
  });

  app.get("/api/jobs", async (req, res, next) => {
    try {
      const query = jobSearchSchema.parse(req.query);
      res.json(await jobSource.search(query));
    } catch (error) { next(error instanceof ZodError || error instanceof JobSourceError ? error : new DatabaseUnavailableError(error)); }
  });

  app.get("/api/saved-jobs", async (_req, res, next) => {
    try { res.json(await repository.listSavedJobs()); }
    catch (error) { next(new DatabaseUnavailableError(error)); }
  });

  app.post("/api/saved-jobs", async (req, res, next) => {
    try {
      const job = saveJobSchema.parse(req.body);
      const result = await repository.saveJob(job);
      res.status(result.duplicate ? 200 : 201).json({ ...result, job: serializeSavedJob(result.job) });
    } catch (error) { next(error instanceof ZodError ? error : new DatabaseUnavailableError(error)); }
  });

  app.post("/api/saved-jobs/:id/move-to-application", async (req, res, next) => {
    try {
      const result = await repository.moveSavedJobToApplication(req.params.id ?? "");
      if (!result) { res.status(404).json({ error: { code: "SAVED_JOB_NOT_FOUND", message: "Saved job not found" } }); return; }
      res.json({ ...result, application: serialize(result.application) });
    } catch (error) { next(new DatabaseUnavailableError(error)); }
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
    if (error && typeof error === "object" && "type" in error && error.type === "entity.too.large") {
      res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large" } });
      return;
    }
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: { code: "RESUME_TOO_LARGE", message: `Resume must be no larger than ${Math.floor(resumeLimit / 1024 / 1024)} MB.` } }); return;
    }
    if (error instanceof multer.MulterError) {
      res.status(400).json({ error: { code: "INVALID_UPLOAD", message: "Upload one resume file using the resume field." } }); return;
    }
    if (error instanceof Error && error.message === "Only PDF and DOCX resumes are supported.") {
      res.status(400).json({ error: { code: "UNSUPPORTED_FILE", message: error.message } }); return;
    }
    if (error instanceof DatabaseUnavailableError) {
      console.error("Database operation failed; details omitted.");
      res.status(503).json({ error: { code: "DATABASE_UNAVAILABLE", message: "The database is temporarily unavailable" } });
      return;
    }
    if (error instanceof JobSourceError) {
      const status = error.kind === "timeout" ? 504 : error.kind === "rate_limited" ? 503 : 502;
      res.status(status).json({ error: { code: `JOB_SOURCE_${error.kind.toUpperCase()}`, message: error.message } });
      return;
    }
    console.error("Unexpected API error; details omitted.");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } });
  };
  app.use(errors);
  return app;
}

function serializeSavedJob(job: import("@applypilot/shared").SavedJob) {
  return { ...job, publishedAt: job.publishedAt ? new Date(job.publishedAt).toISOString() : null, createdAt: new Date(job.createdAt).toISOString(), updatedAt: new Date(job.updatedAt).toISOString() };
}
