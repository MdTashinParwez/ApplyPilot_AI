import dotenv from "dotenv";
import { createApp } from "./app.js";
import { createDatabase } from "./database.js";
import { createDiscoveryRunner, startDiscoveryScheduler } from "./discovery.js";
import { createJobSourceRegistry } from "./jobs/publicSources.js";
import { analyzeJobs } from "./aiServiceClient.js";

dotenv.config({ path: "../../.env" });

const port = Number(process.env.API_PORT ?? 3001);
const { prisma, applicationRepository, assistantRepository } = createDatabase();
const jobSource = createJobSourceRegistry();
const app = createApp(applicationRepository, jobSource, analyzeJobs, assistantRepository);
const intervalMinutes = Number(process.env.JOB_DISCOVERY_INTERVAL_MINUTES ?? 360);
const runDiscovery = createDiscoveryRunner(assistantRepository, () => applicationRepository.getProfile(), jobSource, analyzeJobs);
const stopScheduler = startDiscoveryScheduler(() => runDiscovery("scheduled"), intervalMinutes, { runOnStartup: true });
const server = app.listen(port, () => console.log(`ApplyPilot API listening at http://localhost:${port}`));

async function shutdown() {
  stopScheduler();
  server.close();
  await prisma.$disconnect();
}

process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });