import {
  pgTable,
  serial,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  pgEnum,
  jsonb,
} from "drizzle-orm/pg-core";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const emailProviderEnum = pgEnum("email_provider", ["gmail", "outlook", "smtp"]);
export const emailProfileStatusEnum = pgEnum("email_profile_status", ["active", "inactive", "error"]);

// scrapeProfiles (config-level) reuses this; scrapeJobs (run-level) has its own below
export const scrapeStatusEnum = pgEnum("scrape_status", ["idle", "running", "done", "error"]);

// scraper.ts writes: "running" | "done" | "failed"  ← needs "failed"
export const scrapeJobStatusEnum = pgEnum("scrape_job_status", ["running", "done", "failed"]);

export const templateCategoryEnum = pgEnum("template_category", [
  "Cold Outreach",
  "Follow-up",
  "Re-engagement",
  "Partnership",
  "Other",
]);

export const copilotStatusEnum = pgEnum("copilot_status", ["draft", "active", "paused", "archived"]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "canceled",
  "past_due",
  "trialing",
]);

export const invoiceStatusEnum = pgEnum("invoice_status", ["paid", "pending", "failed"]);

export const integrationProviderEnum = pgEnum("integration_provider", [
  "google",
  "microsoft",
  "sendgrid",
  "hunter",
  "apollo",
  "clearbit",
  "hubspot",
  "salesforce",
  "slack",
  "webhook",
]);

export const themeEnum = pgEnum("theme", ["light", "dark", "system"]);

// leads.status — mailer.ts writes: "new" | "queued" | "sent"
export const leadStatusEnum = pgEnum("lead_status", ["new", "queued", "sent", "failed", "unsubscribed"]);

// emailLogs.status — mailer.ts writes: "sent" | "failed"
export const emailLogStatusEnum = pgEnum("email_log_status", ["sent", "failed", "opened", "replied"]);

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkId: varchar("clerk_id", { length: 255 }).notNull().unique(),
  firstName: varchar("first_name", { length: 100 }).notNull().default(""),
  lastName: varchar("last_name", { length: 100 }).notNull().default(""),
  email: varchar("email", { length: 255 }).notNull().unique(),
  timezone: varchar("timezone", { length: 100 }).notNull().default("UTC"),
  theme: themeEnum("theme").notNull().default("light"),
  notifyOnReply: boolean("notify_on_reply").notNull().default(true),
  notifyOnBounce: boolean("notify_on_bounce").notNull().default(true),
  notifyWeeklyReport: boolean("notify_weekly_report").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Settings ─────────────────────────────────────────────────────────────────
// mailer.ts reads:  smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from_name, daily_send_limit
// scraper.ts reads: scrape_query, scrape_results_per_run
// Simple key/value store scoped per user.

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  key: varchar("key", { length: 100 }).notNull(),
  // value is always stored as text; callers cast (parseInt etc.) at read time
  value: text("value"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Email Profiles ───────────────────────────────────────────────────────────

export const emailProfiles = pgTable("email_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  provider: emailProviderEnum("provider").notNull().default("gmail"),
  smtpHost: varchar("smtp_host", { length: 255 }),
  smtpPort: integer("smtp_port").default(587),
  username: varchar("username", { length: 255 }),
  passwordEncrypted: text("password_encrypted"),
  status: emailProfileStatusEnum("status").notNull().default("inactive"),
  dailyLimit: integer("daily_limit").notNull().default(100),
  sentToday: integer("sent_today").notNull().default(0),
  lastVerifiedAt: timestamp("last_verified_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Email Templates ──────────────────────────────────────────────────────────
// mailer.ts: db.query.emailTemplates.findFirst({ where: eq(emailTemplates.isActive, true) })
//            uses fields: isActive, subject, body
// This replaces the generic `templates` table for outbound email content.

export const emailTemplates = pgTable("email_templates", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 150 }).notNull(),
  subject: text("subject").notNull(),
  // Supports {{companyName}} {{email}} {{website}} {{phone}} interpolation (see mailer.ts)
  body: text("body").notNull(),
  category: templateCategoryEnum("category").notNull().default("Other"),
  // mailer.ts: eq(emailTemplates.isActive, true)
  isActive: boolean("is_active").notNull().default(false),
  variables: jsonb("variables").$type<string[]>().notNull().default([]),
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Scrape Jobs ──────────────────────────────────────────────────────────────
// scraper.ts: db.insert(scrapeJobs).values({ query, status: "running" })
//             db.update(scrapeJobs).set({ status: "done", leadsFound, finishedAt })
//             db.update(scrapeJobs).set({ status: "failed", errorMessage, finishedAt })

export const scrapeJobs = pgTable("scrape_jobs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .references(() => users.id, { onDelete: "set null" }),
  // scraper.ts stores the Google Maps search string here
  query: text("query").notNull(),
  status: scrapeJobStatusEnum("status").notNull().default("running"),
  leadsFound: integer("leads_found").notNull().default(0),
  errorMessage: text("error_message"),
  finishedAt: timestamp("finished_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Leads ────────────────────────────────────────────────────────────────────
// scraper.ts inserts: companyName, email, website, phone, address, sourceQuery, scrapeJobId, status("new")
// mailer.ts reads:    status("new"), scrapedAt, email, companyName
//           updates:  status("queued"), status("sent"), emailedAt

export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .references(() => users.id, { onDelete: "set null" }),
  companyName: varchar("company_name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  website: text("website").unique(),          // unique — scraper deduplicates on this
  phone: varchar("phone", { length: 50 }),
  address: text("address"),
  // scraper.ts stores the Maps search query that produced this lead
  sourceQuery: text("source_query"),
  scrapeJobId: integer("scrape_job_id")
    .references(() => scrapeJobs.id, { onDelete: "set null" }),
  // mailer.ts: orderBy leads.scrapedAt  →  needs to be a real column
  scrapedAt: timestamp("scraped_at").notNull().defaultNow(),
  status: leadStatusEnum("status").notNull().default("new"),
  // mailer.ts: .set({ status: "sent", emailedAt: new Date() })
  emailedAt: timestamp("emailed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Email Logs ───────────────────────────────────────────────────────────────
// mailer.ts inserts on success: { leadId, templateId, subject, status: "sent" }
// mailer.ts inserts on failure: { leadId, templateId, subject, status: "failed", errorMessage }
// mailer.ts counts:  .where(and(eq(emailLogs.status, "sent"), gte(emailLogs.sentAt, startOfDay)))

export const emailLogs = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leads.id, { onDelete: "cascade" }),
  templateId: integer("template_id")
    .references(() => emailTemplates.id, { onDelete: "set null" }),
  subject: text("subject").notNull(),
  status: emailLogStatusEnum("status").notNull(),
  errorMessage: text("error_message"),
  // mailer.ts: gte(emailLogs.sentAt, startOfDay) — tracks when the attempt was made
  sentAt: timestamp("sent_at").notNull().defaultNow(),
});

// ─── Scrape Profiles (config-level) ──────────────────────────────────────────
// These are reusable scrape configurations distinct from individual scrape job runs.

export const scrapeProfiles = pgTable("scrape_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  searchQuery: varchar("search_query", { length: 100 }).notNull(),
  resultsPerRun: integer("results_per_run").notNull().default(100),
  schedule: varchar("schedule", { length: 100 }),
  status: scrapeStatusEnum("status").notNull().default("idle"),
  resultsCount: integer("results_count").notNull().default(0),
  lastRun: timestamp("last_run"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Scrape Results ───────────────────────────────────────────────────────────

export const scrapeResults = pgTable("scrape_results", {
  id: serial("id").primaryKey(),
  scrapeProfileId: integer("scrape_profile_id")
    .notNull()
    .references(() => scrapeProfiles.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<Record<string, string>>().notNull(),
  scrapedAt: timestamp("scraped_at").notNull().defaultNow(),
});

// ─── Copilots ─────────────────────────────────────────────────────────────────

export const copilots = pgTable("copilots", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 150 }).notNull(),
  description: text("description"),
  status: copilotStatusEnum("status").notNull().default("draft"),
  emailProfileId: integer("email_profile_id").references(() => emailProfiles.id, {
    onDelete: "set null",
  }),
  scrapeProfileId: integer("scrape_profile_id").references(() => scrapeProfiles.id, {
    onDelete: "set null",
  }),
  // Now references emailTemplates (not the removed generic templates table)
  templateId: integer("template_id").references(() => emailTemplates.id, {
    onDelete: "set null",
  }),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  emailsSent: integer("emails_sent").notNull().default(0),
  emailsOpened: integer("emails_opened").notNull().default(0),
  emailsReplied: integer("emails_replied").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Integrations ─────────────────────────────────────────────────────────────

export const integrations = pgTable("integrations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: integrationProviderEnum("provider").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  apiKey: text("api_key"),
  expiresAt: timestamp("expires_at"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  connectedAt: timestamp("connected_at").notNull().defaultNow(),
});

// ─── Billing / Subscriptions ──────────────────────────────────────────────────

export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  planId: varchar("plan_id", { length: 50 }).notNull(),
  status: subscriptionStatusEnum("status").notNull().default("active"),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  currentPeriodStart: timestamp("current_period_start").notNull(),
  currentPeriodEnd: timestamp("current_period_end").notNull(),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  subscriptionId: integer("subscription_id").references(() => subscriptions.id, {
    onDelete: "set null",
  }),
  stripeInvoiceId: varchar("stripe_invoice_id", { length: 255 }),
  amount: integer("amount").notNull(), // stored in cents
  currency: varchar("currency", { length: 10 }).notNull().default("usd"),
  status: invoiceStatusEnum("status").notNull().default("pending"),
  downloadUrl: text("download_url"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Type exports ─────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Settings = typeof settings.$inferSelect;
export type NewSettings = typeof settings.$inferInsert;

export type EmailProfile = typeof emailProfiles.$inferSelect;
export type NewEmailProfile = typeof emailProfiles.$inferInsert;

export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type NewEmailTemplate = typeof emailTemplates.$inferInsert;

export type ScrapeJob = typeof scrapeJobs.$inferSelect;
export type NewScrapeJob = typeof scrapeJobs.$inferInsert;

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;

export type EmailLog = typeof emailLogs.$inferSelect;
export type NewEmailLog = typeof emailLogs.$inferInsert;

export type ScrapeProfile = typeof scrapeProfiles.$inferSelect;
export type NewScrapeProfile = typeof scrapeProfiles.$inferInsert;

export type ScrapeResult = typeof scrapeResults.$inferSelect;
export type NewScrapeResult = typeof scrapeResults.$inferInsert;

export type Copilot = typeof copilots.$inferSelect;
export type NewCopilot = typeof copilots.$inferInsert;

export type Integration = typeof integrations.$inferSelect;
export type NewIntegration = typeof integrations.$inferInsert;

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;