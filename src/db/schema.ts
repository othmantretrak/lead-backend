// At the top, keep your imports
import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  pgEnum,
  type PgEnum,
} from "drizzle-orm/pg-core";

import { relations, type Relations } from "drizzle-orm";
import type { PgTableWithColumns, TableConfig } from "drizzle-orm/pg-core/table";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const leadStatusEnum = pgEnum("lead_status", [
  "new", "queued", "sent", "replied", "disqualified",
] as const);

export const scrapeJobStatusEnum = pgEnum("scrape_job_status", [
  "running", "done", "failed",
] as const);

export const emailLogStatusEnum = pgEnum("email_log_status", [
  "sent", "failed",
] as const);

// ─── Tables ───────────────────────────────────────────────────────────────────

export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull(),
  email: text("email").notNull().unique(),
  website: text("website"),
  phone: text("phone"),
  address: text("address"),
  sourceQuery: text("source_query"),
  status: leadStatusEnum("status").notNull().default("new"),
  notes: text("notes"),
  scrapeJobId: integer("scrape_job_id"),
  scrapedAt: timestamp("scraped_at").notNull().defaultNow(),
  emailedAt: timestamp("emailed_at"),
  repliedAt: timestamp("replied_at"),
})

export const emailTemplates = pgTable("email_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const emailLogs = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull(),
  templateId: integer("template_id"),
  subject: text("subject").notNull(),
  status: emailLogStatusEnum("status").notNull(),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
})

// ─── Relations ───────────────────────────────────────────────────────────────

export const leadsRelations: Relations = relations(leads, ({ many, one }) => ({
  emailLogs: many(emailLogs),
  scrapeJob: one(scrapeJobs, {
    fields: [leads.scrapeJobId],
    references: [scrapeJobs.id],
  }),
}));

export const emailLogsRelations: Relations = relations(emailLogs, ({ one }) => ({
  lead: one(leads, {
    fields: [emailLogs.leadId],
    references: [leads.id],
  }),
  template: one(emailTemplates, {
    fields: [emailLogs.templateId],
    references: [emailTemplates.id],
  }),
}));

export const scrapeJobs = pgTable("scrape_jobs", {
  id: serial("id").primaryKey(),
  query: text("query").notNull(),
  status: scrapeJobStatusEnum("status").notNull().default("running"),
  leadsFound: integer("leads_found").notNull().default(0),
  errorMessage: text("error_message"),
  ranAt: timestamp("ran_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
})

export const scrapeJobsRelations: Relations = relations(scrapeJobs, ({ many }) => ({
  leads: many(leads),
}));

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
})

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});