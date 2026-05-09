import { Router, Request, Response } from "express";
import { db } from "../db/drizzle";
import { subscriptions, invoices, users, usage, copilots, emailProfiles } from "../db/schema";
import { eq, desc, and, lte, gte, ne, count } from "drizzle-orm";
import createMollieClient, {
    MollieClient,
    SequenceType
} from "@mollie/api-client";
import { getAuth } from "@clerk/express";

export const billingRouter: Router = Router();

// ─── Mollie Client ─────────────────────────────────────────────────────────────
const mollie: MollieClient = createMollieClient({
    apiKey: process.env.MOLLIE_API_KEY!,
});

// ─── Plans ─────────────────────────────────────────────────────────────────────
const PLANS = [
    {
        id: "starter",
        name: "Starter",
        price: 9,
        amount: "9.00",
        interval: "1 month",
        currency: "EUR",
        features: ["3 Copilots", "1 Email Profile", "500 emails/mo", "Basic templates", "Email support"],
    },
    {
        id: "growth",
        name: "Growth",
        price: 19,
        amount: "19.00",
        interval: "1 month",
        currency: "EUR",
        highlight: true,
        features: ["15 Copilots", "5 Email Profiles", "5,000 emails/mo", "Unlimited templates", "Priority support", "API access"],
    },
    {
        id: "scale",
        name: "Scale",
        price: 39,
        amount: "39.00",
        interval: "1 month",
        currency: "EUR",
        features: ["Unlimited Copilots", "20 Email Profiles", "25,000 emails/mo", "Custom templates", "Dedicated support", "API access", "Team seats"],
    },
] as const;

type PlanId = (typeof PLANS)[number]["id"];

function getPlan(planId: string) {
    return PLANS.find((p) => p.id === planId) ?? null;
}

// ─── Status Mapping ────────────────────────────────────────────────────────────
function mapMollieStatus(mollieStatus: string): "active" | "canceled" | "past_due" | "trialing" | "pending" | "suspended" {
    const map: Record<string, any> = {
        active: "active",
        canceled: "canceled",
        suspended: "suspended",
        completed: "canceled",
        pending: "pending",
    };
    return map[mollieStatus] ?? "pending";
}

// ─── Routes ────────────────────────────────────────────────────────────────────

// GET /billing/plans
billingRouter.get("/plans", (_req: Request, res: Response) => {
    res.json(PLANS);
});

// GET /billing/subscription
billingRouter.get("/subscription", async (req: Request, res: Response) => {
    try {
        const { userId } = getAuth(req)
        if (!userId) return res.status(401).json({ error: "User not found" });

        const user = await db.select().from(users).where(eq(users.clerkId, userId)).then(rows => rows[0]);


        const [sub] = await db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.userId, user.id))
            .orderBy(desc(subscriptions.createdAt))
            .limit(1);

        if (!sub) return res.status(404).json({ error: "No subscription found" });
        res.json(sub);
    } catch (err) {
        console.error("Fetch subscription error", err);
        res.status(500).json({ error: "Failed to fetch subscription" });
    }
});

// GET /billing/invoices
billingRouter.get("/invoices", async (req: Request, res: Response) => {
    try {
        const { userId } = getAuth(req)
        console.log("User ID from auth:", userId);
        if (!userId) return res.status(401).json({ error: "User not found" });

        const user = await db.select().from(users).where(eq(users.clerkId, userId)).then(rows => rows[0]);
        console.log("User from DB:", user);

        const rows = await db
            .select()
            .from(invoices)
            .where(eq(invoices.userId, user.id))
            .orderBy(desc(invoices.createdAt));
        res.json(rows);
    } catch (err) {
        console.error("Fetch invoices error", err);
        res.status(500).json({ error: "Failed to fetch invoices" });
    }
});

// POST /billing/subscribe
billingRouter.post("/subscribe", async (req: Request, res: Response) => {
    try {
        const { userId } = getAuth(req)
        if (!userId) return res.status(401).json({ error: "User not found" });

        const user = await db.select().from(users).where(eq(users.clerkId, userId)).then(rows => rows[0]);

        const { planId } = req.body as { planId: string };

        const plan = getPlan(planId);
        if (!plan) return res.status(400).json({ error: "Invalid planId" });

        console.log(`User ${user.email} subscribing to ${planId}`);

        // 1. Get or create Mollie Customer (idempotent)
        let mollieCustomerId: string;

        const [existingSub] = await db
            .select({ mollieCustomerId: subscriptions.mollieCustomerId })
            .from(subscriptions)
            .where(eq(subscriptions.userId, user.id))
            .limit(1);

        if (existingSub?.mollieCustomerId) {
            mollieCustomerId = existingSub.mollieCustomerId;
        } else {
            const customer = await mollie.customers.create({
                name: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email,
                email: user.email,
                metadata: { userId: String(user.id), clerkId: user.clerkId },
            });
            mollieCustomerId = customer.id;
        }

        // 2. Create first payment (sequenceType: "first" creates mandate)
        const payment = await mollie.payments.create({
            amount: { currency: plan.currency, value: plan.amount },
            customerId: mollieCustomerId,
            sequenceType: SequenceType.first,
            description: `${plan.name} plan – first payment`,
            redirectUrl: `${process.env.WEBHOOK_URL}/billing/subscribe/return?planId=${planId}&userId=${user.id}`,
            webhookUrl: `${process.env.WEBHOOK_URL}/billing/webhook`,
            metadata: { planId, userId: String(user.id) },
        });

        console.log(`Mollie payment created: ${payment.id} for user ${user.email}`);

        // 3. Upsert pending subscription + create pending invoice (in transaction)
        await db.transaction(async (tx) => {
            if (existingSub) {
                await tx
                    .update(subscriptions)
                    .set({
                        planId,
                        status: "pending",
                        mollieCustomerId,
                        updatedAt: new Date(),
                    })
                    .where(eq(subscriptions.userId, user.id));
            } else {
                await tx.insert(subscriptions).values({
                    userId: user.id,
                    planId,
                    status: "pending",
                    mollieCustomerId,
                });
            }

            await tx.insert(invoices).values({
                userId: user.id,
                molliePaymentId: payment.id,
                amount: Math.round(plan.price * 100),
                currency: plan.currency.toLowerCase(),
                status: "pending",
                downloadUrl: payment.getCheckoutUrl() ?? undefined,
            });
        });

        res.json({ checkoutUrl: payment.getCheckoutUrl() });
    } catch (err: any) {
        console.error("Subscribe error:", err);
        res.status(500).json({ error: "Failed to initiate subscription" });
    }
});

// GET /billing/subscribe/return
billingRouter.get("/subscribe/return", (req: Request, res: Response) => {
    const { planId } = req.query as { planId?: string };
    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
    res.redirect(`${frontendUrl}/dashboard/billing?plan=${planId ?? ""}&status=pending`);
});

// POST /billing/webhook
billingRouter.post("/webhook", async (req: Request, res: Response) => {
    const { id } = req.body as { id?: string };
    console.log("📬 Webhook received with body:", req.body);
    console.log("📬 Webhook received with id:", id);
    if (!id) return res.status(400).send("Missing id");

    try {
        // Payment webhook (first payment + recurring)
        if (id.startsWith("tr_")) {
            console.log(`💳 Processing payment webhook: ${id}`);
            const payment = await mollie.payments.get(id);
            console.log(`💳 Payment status: ${payment.status}, customerId: ${payment.customerId}`);
            const meta = payment.metadata as { planId?: string; userId?: string } | undefined;
            const userId = meta?.userId ? parseInt(meta.userId) : null;
            const planId = meta?.planId;

            if (!userId || !planId) {
                console.log("⚠️ Missing userId or planId in payment metadata");
                return res.status(200).send("ok");
            }

            const plan = getPlan(planId);
            if (!plan) {
                console.log(`⚠️ Plan not found: ${planId}`);
                return res.status(200).send("ok");
            }

            if (payment.status === "paid") {
                console.log(`✅ Payment successful for user ${userId}, plan ${planId}`);
                await handleSuccessfulPayment(payment, userId, plan);
            } else if (payment.status === "failed" || payment.status === "expired" || payment.status === "canceled") {
                console.log(`❌ Payment ${payment.status} for payment id ${id}`);
                await db
                    .update(invoices)
                    .set({ status: "failed" })
                    .where(eq(invoices.molliePaymentId, id));
            }
        }

        // Subscription webhook (recurring status changes)
        else if (id.startsWith("sub_")) {
            console.log(`🔄 Processing subscription webhook: ${id}`);
            await handleSubscriptionWebhook(id);
        }

        res.status(200).send("ok");
    } catch (err) {
        console.error("❌ Webhook error:", err);
        res.status(200).send("ok"); // Always acknowledge to Mollie
    }
});

// ─── Helper Functions ──────────────────────────────────────────────────────────

async function handleSuccessfulPayment(payment: any, userId: number, plan: any) {
    await db.transaction(async (tx) => {
        // Update invoice
        await tx
            .update(invoices)
            .set({ status: "paid", paidAt: new Date() })
            .where(eq(invoices.molliePaymentId, payment.id));

        // Update subscription
        const [sub] = await tx
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.userId, userId))
            .limit(1);

        if (!sub) return;

        let mollieSubscriptionId = sub.mollieSubscriptionId;

        // Create recurring subscription only once (after first successful payment)
        if (!mollieSubscriptionId && payment.customerId) {
            const mandates = await mollie.customerMandates.page({
                customerId: payment.customerId,
            });

            const validMandate = mandates.find((m: any) => m.status === "valid");

            if (validMandate) {
                const mollieSub = await mollie.customerSubscriptions.create({
                    customerId: payment.customerId,
                    amount: { currency: plan.currency, value: plan.amount },
                    interval: plan.interval,
                    description: `${plan.name} plan`,
                    webhookUrl: `${process.env.WEBHOOK_URL}/billing/webhook`,
                    metadata: { planId: plan.id, userId: String(userId) },
                });

                mollieSubscriptionId = mollieSub.id;
            }
        }

        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        await tx
            .update(subscriptions)
            .set({
                status: "active",
                mollieMandateId: sub.mollieMandateId || payment.mandateId,
                mollieSubscriptionId,
                currentPeriodStart: now,
                currentPeriodEnd: periodEnd,
                updatedAt: now,
            })
            .where(eq(subscriptions.userId, userId));
        // === CREATE / ENSURE USAGE ROW FOR THIS PERIOD ===
        await ensureUsageRecord(tx, userId, sub.id, now, periodEnd);
    });
}

async function handleSubscriptionWebhook(subscriptionId: string) {
    const [dbSub] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.mollieSubscriptionId, subscriptionId))
        .limit(1);

    if (!dbSub?.mollieCustomerId) return;

    try {
        const mollieSub = await mollie.customerSubscriptions.get(subscriptionId, {
            customerId: dbSub.mollieCustomerId,
        });

        const newStatus = mapMollieStatus(mollieSub.status);

        await db
            .update(subscriptions)
            .set({ status: newStatus, updatedAt: new Date() })
            .where(eq(subscriptions.mollieSubscriptionId, subscriptionId));
    } catch (err) {
        console.error(`Failed to fetch Mollie subscription ${subscriptionId}`, err);
    }
}
async function ensureUsageRecord(
    tx: any,
    userId: number,
    subscriptionId: number,
    periodStart: Date,
    periodEnd: Date
) {
    // Check if usage record already exists for this period
    const [existing] = await tx
        .select()
        .from(usage)
        .where(
            and(
                eq(usage.userId, userId),
                eq(usage.subscriptionId, subscriptionId),
                eq(usage.periodStart, periodStart)
            )
        )
        .limit(1);

    if (existing) {
        return existing;
    }

    // Create new usage record
    const [newUsage] = await tx
        .insert(usage)
        .values({
            userId,
            subscriptionId,
            periodStart,
            periodEnd,
            emailsSent: 0,
            copilotsCreated: 0,
            emailProfilesCreated: 0,
        })
        .returning();

    console.log(`✅ Created new usage record for user ${userId}, period ${periodStart.toISOString()}`);
    return newUsage;
}

// POST /billing/cancel
billingRouter.post("/cancel", async (req: Request, res: Response) => {
    try {
        const { userId } = getAuth(req)
        if (!userId) return res.status(401).json({ error: "User not found" });

        const user = await db.select().from(users).where(eq(users.clerkId, userId)).then(rows => rows[0]);


        const [sub] = await db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.userId, user.id))
            .limit(1);

        if (!sub?.mollieSubscriptionId || !sub.mollieCustomerId) {
            return res.status(400).json({ error: "No active Mollie subscription found" });
        }

        await mollie.customerSubscriptions.cancel(sub.mollieSubscriptionId, {
            customerId: sub.mollieCustomerId,
        });

        await db
            .update(subscriptions)
            .set({
                cancelAtPeriodEnd: true,
                status: "canceled",
                updatedAt: new Date(),
            })
            .where(eq(subscriptions.userId, user.id));

        res.json({ message: "Subscription canceled successfully" });
    } catch (err) {
        console.error("Cancel error:", err);
        res.status(500).json({ error: "Failed to cancel subscription" });
    }
});

// ─── Plan Limits Map ───────────────────────────────────────────────────────────
const PLAN_LIMITS: Record<PlanId, {
    emailsPerMonth: number;
    copilots: number;
    emailProfiles: number;
    hasApiAccess: boolean;
    hasUnlimitedTemplates: boolean;
}> = {
    starter: {
        emailsPerMonth: 500,
        copilots: 3,
        emailProfiles: 1,
        hasApiAccess: false,
        hasUnlimitedTemplates: false,
    },
    growth: {
        emailsPerMonth: 5_000,
        copilots: 15,
        emailProfiles: 5,
        hasApiAccess: true,
        hasUnlimitedTemplates: true,
    },
    scale: {
        emailsPerMonth: 25_000,
        copilots: Infinity,
        emailProfiles: 20,
        hasApiAccess: true,
        hasUnlimitedTemplates: true,
    },
};

// GET /billing/limits
billingRouter.get("/limits", async (req: Request, res: Response) => {
    try {
        const { userId } = getAuth(req);
        if (!userId) return res.status(401).json({ error: "Unauthorized" });

        const user = await db
            .select()
            .from(users)
            .where(eq(users.clerkId, userId))
            .then((rows) => rows[0]);

        if (!user) return res.status(404).json({ error: "User not found" });

        // ── 1. Active subscription ─────────────────────────────────────────────
        const [sub] = await db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.userId, user.id))
            .orderBy(desc(subscriptions.createdAt))
            .limit(1);

        if (!sub || sub.status !== "active") {
            return res.status(200).json({
                hasActivePlan: false,
                planId: null,
                limits: null,
                usage: null,
            });
        }

        const planLimits = PLAN_LIMITS[sub.planId as PlanId];
        if (!planLimits) return res.status(400).json({ error: "Unknown plan" });

        // ── 2. Current period usage ────────────────────────────────────────────
        const now = new Date();

        const [currentUsage] = await db
            .select()
            .from(usage)
            .where(
                and(
                    eq(usage.userId, user.id),
                    eq(usage.subscriptionId, sub.id),
                    lte(usage.periodStart, now),
                    gte(usage.periodEnd, now),
                )
            )
            .limit(1);

        // ── 3. Count copilots + email profiles ────────────────────────────────
        const [{ copilotsCount }] = await db
            .select({ copilotsCount: count(copilots.id) })
            .from(copilots)
            .where(
                and(
                    eq(copilots.userId, user.id),
                    ne(copilots.status, "archived")
                )
            );

        const [{ emailProfilesCount }] = await db
            .select({ emailProfilesCount: count(emailProfiles.id) })
            .from(emailProfiles)
            .where(eq(emailProfiles.userId, user.id));

        // ── 4. Build response ──────────────────────────────────────────────────
        const emailsSent = currentUsage?.emailsSent ?? 0;

        res.json({
            hasActivePlan: true,
            planId: sub.planId,
            periodStart: sub.currentPeriodStart,
            periodEnd: sub.currentPeriodEnd,

            limits: {
                emailsPerMonth: planLimits.emailsPerMonth,
                copilots: planLimits.copilots === Infinity ? null : planLimits.copilots, // null = unlimited
                emailProfiles: planLimits.emailProfiles,
                hasApiAccess: planLimits.hasApiAccess,
                hasUnlimitedTemplates: planLimits.hasUnlimitedTemplates,
            },

            usage: {
                emailsSent,
                emailsRemaining: planLimits.emailsPerMonth === Infinity
                    ? null
                    : Math.max(0, planLimits.emailsPerMonth - emailsSent),
                emailsPercent: Math.min(100, Math.round((emailsSent / planLimits.emailsPerMonth) * 100)),

                copilotsCount,
                copilotsRemaining: planLimits.copilots === Infinity
                    ? null
                    : Math.max(0, planLimits.copilots - copilotsCount),

                emailProfilesCount,
                emailProfilesRemaining: Math.max(0, planLimits.emailProfiles - emailProfilesCount),
            },
        });
    } catch (err) {
        console.error("Fetch limits error", err);
        res.status(500).json({ error: "Failed to fetch limits" });
    }
});