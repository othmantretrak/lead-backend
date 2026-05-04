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
import { testSmtpConnection } from "../services/mailer";
import { runScrapeJob } from "../services/scraper";

export const scrapeProfilesRouter: Router = Router();


// ─── Scrape Profiles ──────────────────────────────────────────────────────────
// GET    /api/scrape-profiles
// GET    /api/scrape-profiles/:id
// POST   /api/scrape-profiles
// PUT    /api/scrape-profiles/:id
// DELETE /api/scrape-profiles/:id
// POST   /api/scrape-profiles/:id/run

scrapeProfilesRouter.get("/", async (_req: Request, res: Response) => {
    try {
        const rows = await db.select().from(scrapeProfiles);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch scrape profiles" });
    }
});

scrapeProfilesRouter.get("/:id", async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const [row] = await db.select().from(scrapeProfiles).where(eq(scrapeProfiles.id, id));
        if (!row) return res.status(404).json({ error: "Scrape profile not found" });
        res.json(row);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch scrape profile" });
    }
});

scrapeProfilesRouter.post("/", async (req: Request, res: Response) => {
    try {
        const { userId, name, searchQuery, resultsPerRun, schedule } = req.body;

        if (!userId) {
            res.status(400).json({ error: "userId is required" });
            return;
        }

        const [created] = await db.insert(scrapeProfiles).values({
            userId,
            name,
            searchQuery,
            resultsPerRun: resultsPerRun || 100,
            schedule,
        }).returning();
        res.status(201).json(created);
    } catch (err) {
        console.error("Error creating scrape profile:", err);
        res.status(500).json({ error: "Failed to create scrape profile" });
    }
});

scrapeProfilesRouter.put("/:id", async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const [updated] = await db
            .update(scrapeProfiles)
            .set({ ...req.body, updatedAt: new Date() })
            .where(eq(scrapeProfiles.id, id))
            .returning();
        if (!updated) return res.status(404).json({ error: "Scrape profile not found" });
        res.json(updated);
    } catch (err) {
        console.error("Error updating scrape profile:", err);
        res.status(500).json({ error: "Failed to update scrape profile" });
    }
});

scrapeProfilesRouter.delete("/:id", async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        await db.delete(scrapeProfiles).where(eq(scrapeProfiles.id, id));
        res.status(204).send();
    } catch (err) {
        console.error("Error deleting scrape profile:", err);
        res.status(500).json({ error: "Failed to delete scrape profile" });
    }
});

// POST /api/scrape-profiles/:id/run — triggers a live scrape job
scrapeProfilesRouter.post("/:id/run", async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const [profile] = await db
            .select()
            .from(scrapeProfiles)
            .where(eq(scrapeProfiles.id, id));
        if (!profile) return res.status(404).json({ error: "Scrape profile not found" });

        // Update status to running immediately, fire job async
        await db
            .update(scrapeProfiles)
            .set({ status: "running", updatedAt: new Date() })
            .where(eq(scrapeProfiles.id, id));

        // Non-blocking — job writes its own scrapeJobs row and updates leads
        runScrapeJob().then(async () => {
            await db
                .update(scrapeProfiles)
                .set({ status: "done", lastRun: new Date(), updatedAt: new Date() })
                .where(eq(scrapeProfiles.id, id));
        }).catch(async () => {
            await db
                .update(scrapeProfiles)
                .set({ status: "error", updatedAt: new Date() })
                .where(eq(scrapeProfiles.id, id));
        });

        res.json({ message: "Scrape job started" });
    } catch (err) {
        res.status(500).json({ error: "Failed to start scrape job" });
    }
});
