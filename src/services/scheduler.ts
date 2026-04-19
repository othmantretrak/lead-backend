import cron from "node-cron";
import { settings } from "../db/schema";
import { eq } from "drizzle-orm";
import { runDailySendJob } from "./mailer";
import { db } from "../db/drizzle";

interface SchedulerState {
  sendJob: cron.ScheduledTask | null;
  scrapeJobAM: cron.ScheduledTask | null;
  scrapeJobPM: cron.ScheduledTask | null;
}

const state: SchedulerState = { sendJob: null, scrapeJobAM: null, scrapeJobPM: null };

async function getSetting(key: string, fallback: string): Promise<string> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, key) });
  return (row?.value as string) ?? fallback;
}

function stopAll() {
  state.sendJob?.stop();
  state.scrapeJobAM?.stop();
  state.scrapeJobPM?.stop();
  state.sendJob = null;
  state.scrapeJobAM = null;
  state.scrapeJobPM = null;
}

async function runScrapeJob() {
  try {
    const { runScrapeJob: scrape } = await import("./scraper");
    await scrape();
  } catch (error) {
    console.error("❌ Scrape job error:", error);
  }
}

export async function initScheduler(): Promise<void> {
  console.log("⏰ Initialising scheduler...");
  stopAll();

  const sendHour = await getSetting("send_hour", "9");
  const scrapeHours = await getSetting("scrape_hours", "8,14");
  const [amHour, pmHour] = scrapeHours.split(",").map((h) => h.trim());

  const sendCron = `0 ${sendHour} * * *`;
  state.sendJob = cron.schedule(sendCron, async () => {
    console.log(`\n📧 [${new Date().toISOString()}] Send job triggered`);
    try { await runDailySendJob(); } catch (e) { console.error("❌ Send job error:", e); }
  });
  console.log(`   ✅ Send job at ${sendHour}:00 daily`);

  if (amHour) {
    state.scrapeJobAM = cron.schedule(`0 ${amHour} * * *`, async () => {
      console.log(`\n🔍 AM scrape triggered`);
      await runScrapeJob();
    });
    console.log(`   ✅ AM scrape at ${amHour}:00 daily`);
  }

  if (pmHour) {
    state.scrapeJobPM = cron.schedule(`0 ${pmHour} * * *`, async () => {
      console.log(`\n🔍 PM scrape triggered`);
      await runScrapeJob();
    });
    console.log(`   ✅ PM scrape at ${pmHour}:00 daily`);
  }

  console.log("⏰ Scheduler ready.\n");
}

export async function restartScheduler(): Promise<void> {
  console.log("🔄 Restarting scheduler...");
  await initScheduler();
}

export function getSchedulerStatus() {
  return {
    sendJob: { active: state.sendJob !== null },
    scrapeJobAM: { active: state.scrapeJobAM !== null },
    scrapeJobPM: { active: state.scrapeJobPM !== null },
  };
}