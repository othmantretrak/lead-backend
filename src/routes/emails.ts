import { Router, Request, Response } from "express";
import { emailLogs, emailTemplates, leads } from "../db/schema";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/drizzle";

export const emailsRouter: Router = Router();

// GET /emails/logs
emailsRouter.get("/logs", async (req: Request, res: Response) => {
  try {
    const { page = "1", limit = "20" } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    const [rows, total] = await Promise.all([
      db.query.emailLogs.findMany({
        orderBy: desc(emailLogs.sentAt),
        limit: limitNum,
        offset,
        with: {
          lead: { columns: { id: true, companyName: true, email: true } },
          template: { columns: { id: true, name: true } },
        },
      }),
      db.$count(emailLogs),
    ]);

    res.json({
      data: rows,
      meta: { total: Number(total), page: pageNum, limit: limitNum, totalPages: Math.ceil(Number(total) / limitNum) },
    });
  } catch (error) {
    console.error("Error fetching email logs:", error);
    res.status(500).json({ error: "Failed to fetch email logs" });
  }
});

// GET /emails/templates
emailsRouter.get("/templates", async (_req: Request, res: Response) => {
  try {
    const templates = await db.query.emailTemplates.findMany({
      orderBy: desc(emailTemplates.createdAt),
    });
    res.json(templates);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch templates" });
  }
});

// POST /emails/templates
emailsRouter.post("/templates", async (req: Request, res: Response) => {
  try {
    const { name, subject, body } = req.body;
    if (!name || !subject || !body) {
      res.status(400).json({ error: "name, subject and body are required" });
      return;
    }
    const [template] = await db.insert(emailTemplates).values({ name, subject, body }).returning();
    res.status(201).json(template);
  } catch (error) {
    res.status(500).json({ error: "Failed to create template" });
  }
});

// PATCH /emails/templates/:id
emailsRouter.patch("/templates/:id", async (req: Request, res: Response) => {
  try {
    const { name, subject, body, isActive } = req.body;
    const id = parseInt(req.params.id);

    if (isActive === true) {
      await db.update(emailTemplates).set({ isActive: false });
    }

    const updateData: Record<string, any> = {};
    if (name !== undefined) updateData.name = name;
    if (subject !== undefined) updateData.subject = subject;
    if (body !== undefined) updateData.body = body;
    if (isActive !== undefined) updateData.isActive = isActive;
    updateData.updatedAt = new Date();

    const [template] = await db
      .update(emailTemplates)
      .set(updateData)
      .where(eq(emailTemplates.id, id))
      .returning();

    res.json(template);
  } catch (error) {
    res.status(500).json({ error: "Failed to update template" });
  }
});

// DELETE /emails/templates/:id
emailsRouter.delete("/templates/:id", async (req: Request, res: Response) => {
  try {
    await db.delete(emailTemplates).where(eq(emailTemplates.id, parseInt(req.params.id)));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete template" });
  }
});