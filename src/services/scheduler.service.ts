import cron from "node-cron";
import { subscriptions, scrapeProfiles, copilots, scrapeJobs } from "../db/schema";
import { desc, eq, and } from "drizzle-orm";
import { runDailySendJob } from "./mailer.service";
import { runScrapeJob } from "./scraper.service";
import { db } from "../db/drizzle";

// ─── State ────────────────────────────────────────────────────────────────────
interface SchedulerState {
  sendJob: cron.ScheduledTask | null;
  scrapeJobAM: cron.ScheduledTask | null;
  scrapeJobPM: cron.ScheduledTask | null;
  copilotId: number | null;
}

const state: SchedulerState = {
  sendJob: null,
  scrapeJobAM: null,
  scrapeJobPM: null,
  copilotId: null,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolves the user's active subscription at job fire time.
 * Intentionally NOT cached at init — avoids a stale subscriptionId if the user
 * upgrades or changes plan between scheduler restarts.
 */
async function getActiveSubscription(userId: number) {
  const subs = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.createdAt));
  const sub = subs[0];
  if (!sub) throw new Error(`No active subscription for user ${userId}`);
  return sub;
}

/**
 * Gets the user's active copilot (most recently updated if multiple).
 * Returns null if no active copilot exists.
 */
async function getActiveCopilot(userId: number) {
  const copilotList = await db
    .select()
    .from(copilots)
    .where(and(
      eq(copilots.userId, userId),
      eq(copilots.status, "active")
    ))
    .orderBy(desc(copilots.updatedAt))
    .limit(1);

  return copilotList[0] || null;
}

/**
 * Runs the copilot's linked scrape profile.
 */
async function runCopilotScrapeProfile(copilotId: number): Promise<void> {
  const [copilot] = await db
    .select()
    .from(copilots)
    .where(eq(copilots.id, copilotId));

  if (!copilot || !copilot.scrapeProfileId) {
    console.log(`📭 No scrape profile linked to copilot ${copilotId} — skipping`);
    return;
  }

  const [profile] = await db
    .select()
    .from(scrapeProfiles)
    .where(eq(scrapeProfiles.id, copilot.scrapeProfileId));

  if (!profile) {
    console.log(`📭 Scrape profile not found for copilot ${copilotId} — skipping`);
    return;
  }

  console.log(`🔍 Running scrape profile: "${profile.name}" (query: "${profile.searchQuery}")`);
  await runScrapeJob(profile);
}

function stopAll() {
  state.sendJob?.stop();
  state.scrapeJobAM?.stop();
  state.scrapeJobPM?.stop();
  state.sendJob = null;
  state.scrapeJobAM = null;
  state.scrapeJobPM = null;
  state.copilotId = null;
}

function atHour(hour: string): string {
  return `0 ${hour} * * *`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialises cron jobs for a user.
 * Requires active subscription. Uses the user's active copilot for scrape and send.
 *
 * Schedules are currently hardcoded defaults. Replace the constants with a
 * per-user DB lookup once you have a user-preferences table.
 *
 * Send:   09:00 daily
 * Scrape: 08:00 and 14:00 daily
 */
export async function initScheduler(userId: number): Promise<void> {
  console.log(`⏰ Initialising scheduler for user ${userId}...`);
  stopAll();

  try {
    await getActiveSubscription(userId);
  } catch (e) {
    console.log(`⚠️  No active subscription for user ${userId}. Scheduler not started.`);
    return;
  }

  const copilot = await getActiveCopilot(userId);

  if (!copilot) {
    console.log(`⚠️  No active copilot for user ${userId}. Scheduler not started.`);
    return;
  }

  state.copilotId = copilot.id;
  console.log(`   📡 Using copilot: "${copilot.name}" (id: ${copilot.id})`);

  // ── Send job ────────────────────────────────────────────────────────────────
  const SEND_HOUR = "14";

  state.sendJob = cron.schedule(atHour(SEND_HOUR), async () => {
    console.log(`\n📧 [${new Date().toISOString()}] Send job triggered for copilot ${state.copilotId}`);
    try {
      if (!state.copilotId) {
        console.error("❌ No copilot configured");
        return;
      }
      await runDailySendJob(state.copilotId);
    } catch (e) {
      console.error("❌ Send job error:", e);
    }
  });
  console.log(`   ✅ Send job at ${SEND_HOUR}:00 daily`);

  // ── Scrape jobs ─────────────────────────────────────────────────────────────
  const AM_HOUR = "8";
  const PM_HOUR = "14";

  state.scrapeJobAM = cron.schedule(atHour(AM_HOUR), async () => {
    console.log(`\n🔍 [${new Date().toISOString()}] AM scrape triggered for copilot ${state.copilotId}`);
    if (!state.copilotId) {
      console.error("❌ No copilot configured");
      return;
    }
    await runCopilotScrapeProfile(state.copilotId).catch((e) =>
      console.error("❌ AM scrape error:", e)
    );
  });
  console.log(`   ✅ AM scrape at ${AM_HOUR}:00 daily`);

  state.scrapeJobPM = cron.schedule(atHour(PM_HOUR), async () => {
    console.log(`\n🔍 [${new Date().toISOString()}] PM scrape triggered for copilot ${state.copilotId}`);
    if (!state.copilotId) {
      console.error("❌ No copilot configured");
      return;
    }
    await runCopilotScrapeProfile(state.copilotId).catch((e) =>
      console.error("❌ PM scrape error:", e)
    );
  });
  console.log(`   ✅ PM scrape at ${PM_HOUR}:00 daily`);

  console.log("⏰ Scheduler ready.\n");
}

export async function restartScheduler(userId: number): Promise<void> {
  console.log(`🔄 Restarting scheduler for user ${userId}...`);
  await initScheduler(userId);
}

export function getSchedulerStatus() {
  return {
    sendJob: { active: state.sendJob !== null },
    scrapeJobAM: { active: state.scrapeJobAM !== null },
    scrapeJobPM: { active: state.scrapeJobPM !== null },
    copilotId: state.copilotId,
  };
}