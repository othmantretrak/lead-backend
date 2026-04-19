import { emailLogs, emailTemplates, leads, settings, scrapeJobs, leadStatusEnum } from "./schema";

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type EmailLog = typeof emailLogs.$inferSelect;
export type ScrapeJob = typeof scrapeJobs.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type LeadStatus = typeof leadStatusEnum.enumValues[number];