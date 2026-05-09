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

export const scrapeJobsRouter: Router = Router();



// ─── Scrape Jobs (bonus — exposed for job status polling) ─────────────────────
// GET /api/scrape-jobs
// GET /api/scrape-jobs/:id

scrapeJobsRouter.get("", async (_req: Request, res: Response) => {
    try {
        const rows = await db.select().from(scrapeJobs);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch scrape jobs" });
    }
});

scrapeJobsRouter.get("/:id", async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const [row] = await db.select().from(scrapeJobs).where(eq(scrapeJobs.id, id));
        if (!row) return res.status(404).json({ error: "Scrape job not found" });
        res.json(row);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch scrape job" });
    }
});

// ─── Scrape Jobs (bonus — exposed for job status polling) ─────────────────────
// GET /api/scrape-jobs
// GET /api/scrape-jobs/:id

scrapeJobsRouter.get("", async (_req: Request, res: Response) => {
    try {
        const rows = await db.select().from(scrapeJobs);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch scrape jobs" });
    }
});

scrapeJobsRouter.get("/:id", async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const [row] = await db.select().from(scrapeJobs).where(eq(scrapeJobs.id, id));
        if (!row) return res.status(404).json({ error: "Scrape job not found" });
        res.json(row);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch scrape job" });
    }
});
