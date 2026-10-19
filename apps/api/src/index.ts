import dotenv from "dotenv";
import { createApp } from "./app.js";
import { createDatabase } from "./database.js";

dotenv.config({ path: "../../.env" });

const port = Number(process.env.API_PORT ?? 3001);
const { prisma, applicationRepository } = createDatabase();
const app = createApp(applicationRepository);
const server = app.listen(port, () => console.log(`ApplyPilot API listening at http://localhost:${port}`));

async function shutdown() {
  server.close();
  await prisma.$disconnect();
}

process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
