import { env } from "./env.js";
import { logger } from "./logger.js";
import { openDb } from "./db/index.js";
import { loadAgents } from "./config/agent.js";
import { ingest } from "./pipeline.js";
import { LystosScraper } from "./ingestion/lystos/scraper.js";
import { capture } from "./ingestion/lystos/capture.js";
import { processAgentQueue } from "./sender/worker.js";
import { buildServer } from "./server.js";
import { report } from "./report.js";

const [command, arg] = process.argv.slice(2);

function agentsFor(id?: string) {
  const agents = loadAgents();
  if (!id) return agents;
  const found = agents.filter((a) => a.id === id);
  if (found.length === 0) throw new Error(`Unknown agent id: ${id}`);
  return found;
}

async function main(): Promise<void> {
  const db = openDb(env.dbPath);

  switch (command) {
    case "ingest": {
      // One pass over every agent's Lystos feed. Run from cron/systemd-timer
      // every few minutes — speed-to-lead is most of the value.
      for (const agent of agentsFor(arg)) {
        const stats = await ingest(db, agent, new LystosScraper(agent));
        logger.info({ agent: agent.id, ...stats }, "ingest complete");
      }
      break;
    }

    case "worker": {
      // Long-running send loop. Dry-run by default; DRY_RUN=false to go live.
      logger.info({ dryRun: env.dryRun, tick: env.workerTickSeconds }, "worker started");
      const agents = agentsFor(arg);
      const tick = async () => {
        for (const agent of agents) {
          const outcome = await processAgentQueue(db, agent).catch((err) => {
            logger.error({ err, agent: agent.id }, "worker pass failed");
            return "failed" as const;
          });
          if (outcome !== "idle") logger.debug({ agent: agent.id, outcome }, "worker pass");
        }
      };
      await tick();
      setInterval(tick, env.workerTickSeconds * 1_000);
      break;
    }

    case "serve": {
      const app = buildServer(db);
      await app.listen({ port: env.port, host: "0.0.0.0" });
      logger.info({ port: env.port }, "webhook server listening");
      break;
    }

    case "capture": {
      for (const agent of agentsFor(arg)) await capture(agent);
      break;
    }

    case "report": {
      console.log(report(db));
      break;
    }

    default:
      console.log(
        [
          "Usage: tsx src/index.ts <command> [agent-id]",
          "  ingest [agent]   scrape Lystos, match, queue first-touch messages",
          "  worker [agent]   run the send loop (DRY_RUN=false to send for real)",
          "  serve            WhatsApp webhook server (statuses, replies, opt-outs)",
          "  capture [agent]  record Lystos network traffic to calibrate the scraper",
          "  report           show pipeline state and message previews",
        ].join("\n"),
      );
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
