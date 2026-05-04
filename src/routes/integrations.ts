import { Router, Request, Response } from "express";
import { db } from "../db/drizzle";
import {
    emailProfiles,
    scrapeProfiles,
    emailTemplates,
    copilots,
    integrations,
    settings,
    subscriptions,
    invoices,
    leads,
    scrapeJobs,
} from "../db/schema";
import { eq } from "drizzle-orm";
import { runDailySendJob, testSmtpConnection } from "../services/mailer";
import { runScrapeJob } from "../services/scraper";

export const integrationsRouter: Router = Router();


// ─── Integrations ─────────────────────────────────────────────────────────────
// GET    /api/integrations
// POST   /api/integrations/:provider/connect
// DELETE /api/integrations/:provider
// GET    /api/integrations/:provider/status

integrationsRouter.get("", async (_req: Request, res: Response) => {
    try {
        const rows = await db.select().from(integrations);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch integrations" });
    }
});

integrationsRouter.post("/:provider/connect", async (req: Request, res: Response) => {
    try {
        const { provider } = req.params;
        const { apiKey, accessToken, refreshToken, expiresAt, metadata } = req.body;
        const [created] = await db
            .insert(integrations)
            .values({
                // userId should come from auth middleware in production
                userId: req.body.userId ?? 1,
                provider: provider as any,
                apiKey,
                accessToken,
                refreshToken,
                expiresAt: expiresAt ? new Date(expiresAt) : undefined,
                metadata,
            })
            .returning();
        res.status(201).json(created);
    } catch (err) {
        res.status(500).json({ error: "Failed to connect integration" });
    }
});

integrationsRouter.delete("/:provider", async (req: Request, res: Response) => {
    try {
        const { provider } = req.params;
        await db.delete(integrations).where(eq(integrations.provider, provider as any));
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ error: "Failed to disconnect integration" });
    }
});

integrationsRouter.get("/:provider/status", async (req: Request, res: Response) => {
    try {
        const { provider } = req.params;
        const row = await db.query.integrations.findFirst({
            where: eq(integrations.provider, provider as any),
        });
        res.json({ connected: !!row, connectedAt: row?.connectedAt ?? null });
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch integration status" });
    }
});
