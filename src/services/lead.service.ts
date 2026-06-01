import { db } from "../db/drizzle";
import { leads, emailLogs } from "../db/schema";
import { eq, and, desc, count, sql } from "drizzle-orm";
import type { LeadStatus } from "../db/types";
import type { PatchLeadInput, ListLeadsInput } from "../validators/lead.validator";

export async function listLeads({ status, page, limit }: ListLeadsInput, userId: number) {
  const offset = (page - 1) * limit;
  const filters = [eq(leads.userId, userId)];
  if (status) filters.push(eq(leads.status, status as LeadStatus));
  const where = and(...filters);

  const [rows, totalRows] = await Promise.all([
    db.query.leads.findMany({
      where,
      orderBy: desc(leads.scrapedAt),
      limit,
      offset,
      with: {
        emailLogs: {
          orderBy: desc(emailLogs.sentAt),
          limit: 1,
        },
      },
    }),
    db.select({ total: count() }).from(leads).where(where),
  ]);

  const total = Number(totalRows[0].total);
  return {
    data: rows,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

export async function getLeadStats(userId: number) {
  const rows = await db
    .select({ status: leads.status, count: count() })
    .from(leads)
    .where(eq(leads.userId, userId))
    .groupBy(leads.status);

  type SummaryKey = "new" | "queued" | "sent" | "replied" | "disqualified" | "failed" | "unsubscribed" | "pending_email";
  const summary = { new: 0, queued: 0, sent: 0, replied: 0, disqualified: 0, failed: 0, unsubscribed: 0, pending_email: 0, total: 0 };
  for (const row of rows) {
    summary[row.status as SummaryKey] = Number(row.count);
    summary.total += Number(row.count);
  }
  return summary;
}

export async function getLead(id: number, userId: number) {
  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, id), eq(leads.userId, userId)),
    with: { emailLogs: { orderBy: desc(emailLogs.sentAt) } },
  });
  if (!lead) throw Object.assign(new Error("Lead not found"), { statusCode: 404 });
  return lead;
}

export async function patchLead(id: number, userId: number, data: PatchLeadInput) {
  const updateData: Record<string, unknown> = {};
  if (data.status) updateData.status = data.status;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.status === "replied") updateData.repliedAt = new Date();

  const [lead] = await db
    .update(leads)
    .set(updateData)
    .where(and(eq(leads.id, id), eq(leads.userId, userId)))
    .returning();
  if (!lead) throw Object.assign(new Error("Lead not found"), { statusCode: 404 });
  return lead;
}

export async function deleteLead(id: number, userId: number) {
  await db.delete(leads).where(and(eq(leads.id, id), eq(leads.userId, userId)));
}
