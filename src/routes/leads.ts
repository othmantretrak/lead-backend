import { Router, Request, Response } from "express";
import { leads, emailLogs } from "../db/schema";
import { eq, desc, count, sql } from "drizzle-orm";
import { LeadStatus } from "../db/types";
import { db } from "../db/drizzle";

export const leadsRouter: Router = Router();

// GET /leads
leadsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const { status, page = "1", limit = "20" } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    const where = status ? eq(leads.status, status as LeadStatus) : undefined;

    const [rows, totalRows] = await Promise.all([
      db.query.leads.findMany({
        where,
        orderBy: desc(leads.scrapedAt),
        limit: limitNum,
        offset,
        with: {
          emailLogs: {
            orderBy: desc(emailLogs.sentAt),
            limit: 1,
          },
        },
      }),
      db.select({ total: count() }).from(leads).where(where ?? sql`1=1`),
    ]);

    const total = Number(totalRows[0].total);

    res.json({
      data: rows,
      meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch leads" });
  }
});

// GET /leads/stats/summary — must be before /:id
leadsRouter.get("/stats/summary", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({ status: leads.status, count: count() })
      .from(leads)
      .groupBy(leads.status);

    type SummaryKey = "new" | "queued" | "sent" | "replied" | "disqualified";
    const summary = { new: 0, queued: 0, sent: 0, replied: 0, disqualified: 0, total: 0 };
    for (const row of rows) {
      summary[row.status as SummaryKey] = Number(row.count);
      summary.total += Number(row.count);
    }

    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// GET /leads/:id
leadsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const lead = await db.query.leads.findFirst({
      where: eq(leads.id, parseInt(req.params.id)),
      with: { emailLogs: { orderBy: desc(emailLogs.sentAt) } },
    });

    if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
    res.json(lead);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch lead" });
  }
});

// PATCH /leads/:id
leadsRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const { status, notes } = req.body;
    const updateData: Record<string, any> = {};

    if (status) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    if (status === "replied") updateData.repliedAt = new Date();

    const [lead] = await db
      .update(leads)
      .set(updateData)
      .where(eq(leads.id, parseInt(req.params.id)))
      .returning();

    res.json(lead);
  } catch (error) {
    res.status(500).json({ error: "Failed to update lead" });
  }
});

// DELETE /leads/:id
leadsRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    await db.delete(leads).where(eq(leads.id, parseInt(req.params.id)));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete lead" });
  }
});