import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import type { Application } from "./generated/prisma/client.js";
import type { ApplicationRepository } from "./repository.js";
import type { ApplicationRecord, CreateApplicationInput } from "@applypilot/shared";

function toRecord(application: Application): ApplicationRecord {
  return {
    ...application,
    createdAt: application.createdAt.toISOString(),
    updatedAt: application.updatedAt.toISOString()
  };
}

export function createDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required. Copy .env.example to .env and set DATABASE_URL.");
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const applicationRepository: ApplicationRepository = {
    async list() {
      const applications = await prisma.application.findMany({ orderBy: { createdAt: "desc" } });
      return applications.map(toRecord);
    },
    async create(data: CreateApplicationInput) {
      return toRecord(await prisma.application.create({ data }));
    },
    async ping() {
      await prisma.$queryRaw`SELECT 1`;
    }
  };
  return { prisma, applicationRepository };
}
