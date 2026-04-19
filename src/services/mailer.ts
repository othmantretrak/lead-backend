import nodemailer from "nodemailer";
import { leads, emailTemplates, emailLogs, settings } from "../db/schema";
import { eq, gte, and, count } from "drizzle-orm";
import type { Lead, EmailTemplate } from "../db/types";
import { db } from "../db/drizzle";

interface SmtpConfig {
  host: string; port: number; user: string; pass: string; fromName: string;
}

interface SendResult {
  success: boolean; error?: string;
}

async function getSmtpConfig(): Promise<SmtpConfig> {
  const rows = await db.select().from(settings);
  const s = rows.reduce((acc, r) => {
    if (typeof r.value === "string") {
      acc[r.key as string] = r.value;
    }
    return acc;
  }, {} as Record<string, string>);

  if (!s.smtp_host || !s.smtp_user || !s.smtp_pass) {
    throw new Error("SMTP is not configured. Fill in smtp_host, smtp_user and smtp_pass in Settings.");
  }

  return {
    host: typeof s.smtp_host === "string" ? s.smtp_host : String(s.smtp_host),
    port: typeof s.smtp_port === "string" ? parseInt(s.smtp_port) : 587,
    user: typeof s.smtp_user === "string" ? s.smtp_user : String(s.smtp_user),
    pass: typeof s.smtp_pass === "string" ? s.smtp_pass : String(s.smtp_pass),
    fromName: typeof s.smtp_from_name === "string" ? s.smtp_from_name : (typeof s.smtp_user === "string" ? s.smtp_user : String(s.smtp_user)),
  };
}

function createTransporter(config: SmtpConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  });
}

function interpolate(text: string, lead: Lead): string {
  return text
    .replace(/{{companyName}}/g, typeof lead.companyName === "string" ? lead.companyName : "")
    .replace(/{{email}}/g, typeof lead.email === "string" ? lead.email : "")
    .replace(/{{website}}/g, typeof lead.website === "string" ? lead.website : "")
    .replace(/{{phone}}/g, typeof lead.phone === "string" ? lead.phone : "");
}

async function sendEmail(lead: Lead, template: EmailTemplate): Promise<SendResult> {
  try {
    const config = await getSmtpConfig();
    const transporter = createTransporter(config);
    const subject = interpolate(typeof template.subject === "string" ? template.subject : "", lead);
    const body = interpolate(typeof template.body === "string" ? template.body : "", lead);

    await transporter.sendMail({
      from: `"${config.fromName}" <${config.user}>`,
      to: typeof lead.email === "string" ? lead.email : String(lead.email),
      subject,
      text: body,
    });

    await db.insert(emailLogs).values({ leadId: lead.id, templateId: template.id, subject, status: "sent" });
    await db.update(leads).set({ status: "sent", emailedAt: new Date() }).where(eq(leads.id, lead.id));

    console.log(`✅ Email sent to ${lead.email} (${lead.companyName})`);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await db.insert(emailLogs).values({ leadId: lead.id, templateId: template.id, subject: template.subject, status: "failed", errorMessage: message });
    console.error(`❌ Failed to send to ${lead.email}: ${message}`);
    return { success: false, error: message };
  }
}

export async function runDailySendJob(): Promise<void> {
  console.log("📧 Daily send job started...");

  const allSettings = await db.select().from(settings);
  const s = allSettings.reduce((acc, r) => {
    if (typeof r.value === "string") {
      acc[r.key as string] = r.value;
    }
    return acc;
  }, {} as Record<string, string>);
  const limit = typeof s.daily_send_limit === "string" ? parseInt(s.daily_send_limit) : 10;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [{ sentToday }] = await db
    .select({ sentToday: count() })
    .from(emailLogs)
    .where(and(eq(emailLogs.status, "sent"), gte(emailLogs.sentAt, startOfDay)));

  const remaining = limit - Number(sentToday);

  if (remaining <= 0) {
    console.log(`📭 Daily limit of ${limit} already reached.`);
    return;
  }

  console.log(`📬 Sending up to ${remaining} emails (${sentToday}/${limit} sent today)`);

  const template = await db.query.emailTemplates.findFirst({
    where: eq(emailTemplates.isActive, true),
  });

  if (!template) {
    console.error("❌ No active email template found.");
    return;
  }

  const pendingLeads = await db.query.leads.findMany({
    where: eq(leads.status, "new"),
    orderBy: leads.scrapedAt,
    limit: remaining,
  });

  if (pendingLeads.length === 0) {
    console.log("📭 No new leads to email.");
    return;
  }

  // mark as queued before sending to prevent double-sends
  await db.update(leads)
    .set({ status: "queued" })
    .where(eq(leads.status, "new"));

  for (let i = 0; i < pendingLeads.length; i++) {
    if (i > 0) {
      const delayMs = randomBetween(2 * 60 * 1000, 5 * 60 * 1000);
      console.log(`⏳ Waiting ${Math.round(delayMs / 1000)}s...`);
      await sleep(delayMs);
    }
    await sendEmail(pendingLeads[i], template);
  }

  console.log("✅ Daily send job complete.");
}

export async function testSmtpConnection(): Promise<SendResult> {
  try {
    const config = await getSmtpConfig();
    const transporter = createTransporter(config);
    await transporter.verify();
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randomBetween = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;