import { subscriptions, copilots } from "../db/schema";
import { desc, eq, and } from "drizzle-orm";
import { runCopilot } from "./copilot.service";
import { db } from "../db/drizzle";

// ─── State ────────────────────────────────────────────────────────────────────
interface SchedulerState {
  timeout: NodeJS.Timeout | null;
  copilotId: number | null;
}

const stateMap = new Map<number, SchedulerState>();

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

function stopUser(userId: number) {
  const existing = stateMap.get(userId);
  if (existing) {
    if (existing.timeout) clearTimeout(existing.timeout);
    stateMap.delete(userId);
  }
}

function stopAll() {
  for (const [userId, s] of stateMap) {
    if (s.timeout) clearTimeout(s.timeout);
  }
  stateMap.clear();
}

function calculateDelay(runAt: string): number {
  const now = new Date();
  const [targetHour, targetMinute] = runAt.split(":").map(Number);
  const target = new Date(now);
  target.setHours(targetHour, targetMinute, 0, 0);

  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  return target.getTime() - now.getTime();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function initScheduler(userId: number): Promise<void> {
  console.log(`⏰ Initialising scheduler for user ${userId}...`);
  stopUser(userId);

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

  const copilotId = copilot.id;

  console.log(`${new Date().toLocaleTimeString()} - 📡 Using copilot: "${copilot.name}" (id: ${copilotId})`);

  const settings = copilot.settings as { schedule?: { runAt?: string } } | undefined;
  const runAt = settings?.schedule?.runAt ?? "09:00";

  const delay = calculateDelay(runAt);
  console.log(`   ⏱️  Copilot will run at ${runAt} (in ${Math.round(delay / 1000 / 60)} minutes)`);

  const timeout = setTimeout(async () => {
    console.log(`\n🚀 [${new Date().toISOString()}] Running copilot ${copilotId}`);
    try {
      await runCopilot(copilotId, userId);
    } catch (e) {
      console.error("❌ Copilot run error:", e);
    }
    console.log(`   🛑 Copilot finished for user ${userId}. Scheduler removed.`);
    stateMap.delete(userId);
  }, delay);

  stateMap.set(userId, { timeout, copilotId });

  console.log("⏰ Scheduler ready.\n");
}

export async function restartScheduler(userId: number): Promise<void> {
  console.log(`🔄 Restarting scheduler for user ${userId}...`);
  await initScheduler(userId);
}

export function getSchedulerStatus() {
  const active: { userId: number; copilotId: number | null }[] = [];
  for (const [userId, s] of stateMap) {
    if (s.timeout) {
      active.push({ userId, copilotId: s.copilotId });
    }
  }
  return { activeSchedulers: active, count: active.length };
}