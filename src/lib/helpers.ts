import { db } from "../db/drizzle";
import { usage } from "../db/schema";
import { eq, and, lte, gte, sql } from "drizzle-orm";

export async function incrementUsage(
    userId: number,
    subscriptionId: number,
    increments: { emailsSent?: number; copilotsCreated?: number; emailProfilesCreated?: number }
) {
    const now = new Date();

    await db
        .update(usage)
        .set({
            emailsSent: sql`${usage.emailsSent} + ${increments.emailsSent ?? 0}`,
            copilotsCreated: sql`${usage.copilotsCreated} + ${increments.copilotsCreated ?? 0}`,
            emailProfilesCreated: sql`${usage.emailProfilesCreated} + ${increments.emailProfilesCreated ?? 0}`,
            updatedAt: now,
        })
        .where(
            and(
                eq(usage.userId, userId),
                eq(usage.subscriptionId, subscriptionId),
                lte(usage.periodStart, now),
                gte(usage.periodEnd, now)
            )
        );
}