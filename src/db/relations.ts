import { relations } from "drizzle-orm/relations";
import { leads, emailLogs, scrapeJobs, emailTemplates } from "./schema";

export const leadsRelations = relations(leads, ({ many }) => ({
  emailLogs: many(emailLogs),
}));

export const emailLogsRelations = relations(emailLogs, ({ one }) => ({
  lead: one(leads, {
    fields: [emailLogs.leadId],
    references: [leads.id],
  }),
  template: one(emailTemplates, {
    fields: [emailLogs.templateId],
    references: [emailTemplates.id],
  }),
}));

export const scrapeJobsRelations = relations(scrapeJobs, ({ many }) => ({
  leads: many(leads),
}));
