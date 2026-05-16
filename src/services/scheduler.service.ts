import cron from "node-cron";
import { subscriptions, copilots } from "../db/schema";
import { desc, eq, and } from "drizzle-orm";
import { runCopilot } from "./copilot.service";
import { db } from "../db/drizzle";

// ─── State ────────────────────────────────────────────────────────────────────
interface SchedulerState {
  job: cron.ScheduledTask | null;
  copilotId: number | null;
}

const state: SchedulerState = {
  job: null,
  copilotId: null,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function stopAll() {
  state.job?.stop();
  state.job = null;
  state.copilotId = null;
}

function atTime(hour: string, minute: string): string {
  return `${minute} ${hour} * * *`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

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

  console.log(`${new Date().toLocaleTimeString()} - 📡 Using copilot: "${copilot.name}" (id: ${copilot.id})`);

  const settings = copilot.settings as { schedule?: { runAt?: string } } | undefined;
  const runAt = settings?.schedule?.runAt ?? "09:00";
  const [hour, minute] = runAt.split(":");

  state.job = cron.schedule(atTime(hour, minute), async () => {
    console.log(`\n🚀 [${new Date().toISOString()}] Running copilot ${state.copilotId}`);
    try {
      if (!state.copilotId) {
        console.error("❌ No copilot configured");
        return;
      }
      await runCopilot(state.copilotId, userId);
    } catch (e) {
      console.error("❌ Copilot run error:", e);
    }
  });
  console.log(`   ✅ Copilot runs at ${runAt} daily`);

  console.log("⏰ Scheduler ready.\n");
}

export async function restartScheduler(userId: number): Promise<void> {
  console.log(`🔄 Restarting scheduler for user ${userId}...`);
  await initScheduler(userId);
}

export function getSchedulerStatus() {
  return {
    job: { active: state.job !== null },
    copilotId: state.copilotId,
  };
}