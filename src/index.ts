import "dotenv/config";
import express from "express";
import cors from "cors";
import { requireApiKey } from "./middleware/auth";
import { leadsRouter } from "./routes/leads";
import { emailsRouter } from "./routes/emails";
import { scraperRouter } from "./routes/scraper";
import { settingsRouter } from "./routes/settings";
import { runDailySendJob } from "./services/mailer";
import { initScheduler, getSchedulerStatus } from "./services/scheduler";

import fs from "fs";
import path from "path";

const logPath = path.join(process.cwd(), "logs/app.log");
const logStream = fs.createWriteStream(logPath, { flags: "a" });

function writeLog(type: string, args: any[]) {
  const msg =
    `[${new Date().toISOString()}] [${type}] ` +
    args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") +
    "\n";

  logStream.write(msg);
}

// Override console
console.log = (...args) => writeLog("LOG", args);
console.error = (...args) => writeLog("ERROR", args);
console.warn = (...args) => writeLog("WARN", args);

// Catch crashes
process.on("uncaughtException", (err) => {
  writeLog("FATAL", [err.stack || err.message]);
});

process.on("unhandledRejection", (err: any) => {
  writeLog("PROMISE_REJECTION", [err?.stack || err]);
});

const app: express.Application = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN || "http://localhost:3000",
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "x-api-key"],
  })
);

// ─── Public routes ────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Protected routes (API key required) ─────────────────────────────────────

app.use("/leads", requireApiKey, leadsRouter);
app.use("/emails", requireApiKey, emailsRouter);
app.use("/scraper", requireApiKey, scraperRouter);
app.use("/settings", requireApiKey, settingsRouter);

// manual trigger for the daily send job (useful for testing without waiting for cron)
app.post("/send-now", requireApiKey, async (_req, res) => {
  try {
    runDailySendJob().catch(console.error);
    res.json({ message: "Send job triggered. Check server logs for progress." });
  } catch (error) {
    res.status(500).json({ error: "Failed to trigger send job" });
  }
});

// scheduler status — shows which cron jobs are active
app.get("/scheduler/status", requireApiKey, (_req, res) => {
  res.json(getSchedulerStatus());
});

// ─── 404 handler ─────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`✅ API running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);

  // start cron jobs
  await initScheduler();
});

export default app;