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

export const templatesRouter: Router = Router();


// ─── Templates (email templates) ─────────────────────────────────────────────
// GET    /api/templates
// GET    /api/templates/:id
// POST   /api/templates
// PUT    /api/templates/:id
// DELETE /api/templates/:id
// POST   /api/templates/:id/duplicate

templatesRouter.get("/", async (_req: Request, res: Response) => {
    try {
        const rows = await db.select().from(emailTemplates);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch templates" });
    }
});

templatesRouter.get("/:id", async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const [row] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, id));
        if (!row) return res.status(404).json({ error: "Template not found" });
        res.json(row);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch template" });
    }
});

templatesRouter.post("/", async (req: Request, res: Response) => {
    try {
        const [created] = await db.insert(emailTemplates).values(req.body).returning();
        res.status(201).json(created);
    } catch (err) {
        console.error("Error creating template:", err);
        res.status(500).json({ error: "Failed to create template" });
    }
});

templatesRouter.put("/:id", async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const [updated] = await db
            .update(emailTemplates)
            .set({ ...req.body, updatedAt: new Date() })
            .where(eq(emailTemplates.id, id))
            .returning();
        if (!updated) return res.status(404).json({ error: "Template not found" });
        res.json(updated);
    } catch (err) {
        console.error("Error updating template:", err);
        res.status(500).json({ error: "Failed to update template" });
    }
});

templatesRouter.delete("/:id", async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        await db.delete(emailTemplates).where(eq(emailTemplates.id, id));
        res.status(204).send();
    } catch (err) {
        console.error("Error deleting template:", err);

        res.status(500).json({ error: "Failed to delete template" });
    }
});

// POST /api/templates/:id/duplicate
templatesRouter.post("/:id/duplicate", async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const [original] = await db
            .select()
            .from(emailTemplates)
            .where(eq(emailTemplates.id, id));
        if (!original) return res.status(404).json({ error: "Template not found" });

        const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = original;
        const [duplicate] = await db
            .insert(emailTemplates)
            .values({ ...rest, name: `${original.name} (Copy)`, isActive: false })
            .returning();
        res.status(201).json(duplicate);
    } catch (err) {
        console.error("Error duplicating template:", err);
        res.status(500).json({ error: "Failed to duplicate template" });
    }
});
