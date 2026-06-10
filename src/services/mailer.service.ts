import nodemailer from "nodemailer";
import https from "https";
import { leads, emailTemplates, emailLogs, emailProfiles, copilots } from "../db/schema";
import { eq, gte, and, count, inArray, or } from "drizzle-orm";
import type { Lead, EmailTemplate } from "../db/types";
import { db } from "../db/drizzle";
import { getValidAccessToken } from "./oauth.service";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SmtpMailConfig {
  provider: "smtp";
  host: string;
  port: number;
  email: string;
  pass: string;
  sendName: string;
}

interface GmailMailConfig {
  provider: "gmail";
  email: string;
  accessToken: string;
  sendName: string;
}

interface OutlookMailConfig {
  provider: "outlook";
  email: string;
  accessToken: string;
  sendName: string;
}

type MailConfig = SmtpMailConfig | GmailMailConfig | OutlookMailConfig;

export interface SendResult {
  success: boolean;
  error?: string;
}

// ─── Transporters ──────────────────────────────────────────────────────────────

function createSmtpTransporter(config: SmtpMailConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.email, pass: config.pass },
  });
}

function createGmailTransporter(config: GmailMailConfig) {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: config.email,
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      accessToken: config.accessToken,
    },
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function interpolate(text: string, lead: Lead, sendName: string): string {
  return text
    .replace(/{{companyName}}/g, lead.companyName ?? "")
    .replace(/{{email}}/g, lead.email ?? "")
    .replace(/{{website}}/g, lead.website ?? "")
    .replace(/{{phone}}/g, lead.phone ?? "")
    .replace(/{{senderName}}/g, sendName);
}

async function logResult(
  template: EmailTemplate,
  lead: Lead,
  copilotId: number,
  subject: string,
  success: boolean,
  errorMessage?: string
): Promise<void> {
  if (success) {
    await db.insert(emailLogs).values({
      leadId: lead.id,
      usersId: template.userId,
      templateId: template.id,
      subject,
      status: "sent",
    });
    await db
      .update(leads)
      .set({ status: "sent", emailedAt: new Date(), copilotId })
      .where(eq(leads.id, lead.id));
  } else {
    await db.insert(emailLogs).values({
      leadId: lead.id,
      usersId: template.userId,
      templateId: template.id,
      subject: template.subject,
      status: "failed",
      errorMessage: errorMessage || "Unknown error",
    });
  }
}

// ─── Send via Outlook Graph API ────────────────────────────────────────────────

function sendViaGraphApi(
  config: OutlookMailConfig,
  lead: Lead,
  template: EmailTemplate
): Promise<SendResult> {
  return new Promise((resolve) => {
    const subject = interpolate(template.subject ?? "", lead, config.sendName);
    const body = interpolate(template.body ?? "", lead, config.sendName);

    const payload = JSON.stringify({
      message: {
        subject,
        body: { contentType: "Text", content: body },
        toRecipients: [{ emailAddress: { address: lead.email } }],
      },
    });

    const req = https.request(
      {
        hostname: "graph.microsoft.com",
        port: 443,
        path: "/v1.0/me/sendMail",
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload).toString(),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", async () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`✅ Email sent via Outlook to ${lead.email} (${lead.companyName})`);
            resolve({ success: true });
          } else {
            const message = `Graph API returned ${res.statusCode}: ${data}`;
            console.error(`❌ Outlook send failed: ${message}`);
            resolve({ success: false, error: message });
          }
        });
      }
    );

    req.on("error", (err) => {
      console.error(`❌ Outlook send failed: ${err.message}`);
      resolve({ success: false, error: err.message });
    });

    req.write(payload);
    req.end();
  });
}

// ─── Core send ────────────────────────────────────────────────────────────────

async function sendEmail(
  config: MailConfig,
  copilotId: number,
  lead: Lead,
  template: EmailTemplate
): Promise<SendResult> {
  try {
    let subject: string;
    let success: boolean;
    let errorMessage: string | undefined;

    if (config.provider === "outlook") {
      subject = interpolate(template.subject ?? "", lead, config.sendName);
      const result = await sendViaGraphApi(config, lead, template);
      success = result.success;
      errorMessage = result.error;
    } else {
      const transporter =
        config.provider === "gmail"
          ? createGmailTransporter(config)
          : createSmtpTransporter(config);

      subject = interpolate(template.subject ?? "", lead, config.sendName);
      const body = interpolate(template.body ?? "", lead, config.sendName);

      await transporter.sendMail({
        from: `"${config.sendName}" <${config.email}>`,
        to: lead.email as string,
        subject,
        text: body,
      });

      success = true;
    }

    await logResult(template, lead, copilotId, subject, success, errorMessage);

    if (success) {
      console.log(`✅ Email sent to ${lead.email} (${lead.companyName})`);
    }

    return { success, error: errorMessage };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await logResult(template, lead, copilotId, template.subject, false, message);
    console.error(`❌ Failed to send to ${lead.email}: ${message}`);
    return { success: false, error: message };
  }
}

// ─── Build mail config from profile ────────────────────────────────────────────

async function buildMailConfig(
  profileId: number
): Promise<MailConfig | null> {
  const [profile] = await db
    .select()
    .from(emailProfiles)
    .where(eq(emailProfiles.id, profileId));

  if (!profile) return null;

  const sendName = profile.sendName ?? profile.email;

  if (profile.provider === "smtp") {
    if (!profile.smtpHost || !profile.smtpPass) return null;
    return {
      provider: "smtp",
      host: profile.smtpHost,
      port: profile.smtpPort ?? 587,
      email: profile.email,
      pass: profile.smtpPass,
      sendName,
    };
  }

  const accessToken = await getValidAccessToken(profileId);
  if (!accessToken) return null;

  if (profile.provider === "gmail") {
    return { provider: "gmail", email: profile.email, accessToken, sendName };
  }

  return { provider: "outlook", email: profile.email, accessToken, sendName };
}

// ─── Send pending leads ───────────────────────────────────────────────────────

export async function sendPendingLeads(copilotId: number): Promise<void> {
  console.log("📧 Daily send job started...");

  const [copilot] = await db.select().from(copilots).where(eq(copilots.id, copilotId));
  if (!copilot) {
    console.error("❌ Copilot not found.");
    return;
  }

  let template: EmailTemplate;
  try {
    if (!copilot.templateId) throw new Error("Copilot has no template configured.");
    const [tmpl] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, copilot.templateId));
    if (!tmpl) throw new Error("Template not found.");
    template = tmpl;
  } catch (err) {
    console.error("❌ No template configured for copilot.");
    return;
  }

  let mailConfig: MailConfig;
  try {
    if (!copilot.emailProfileId) throw new Error("Copilot has no email profile configured.");

    const config = await buildMailConfig(copilot.emailProfileId);
    if (!config) throw new Error("Email profile not properly configured.");
    mailConfig = config;
  } catch (err) {
    console.error("❌ No email profile configured for copilot.");
    return;
  }

  const limit = 100;

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

  const pendingLeads = await db.query.leads.findMany({
    where: or(eq(leads.status, "new"), eq(leads.status, "queued")),
    orderBy: leads.scrapedAt,
    limit: remaining,
  });

  if (pendingLeads.length === 0) {
    console.log("📭 No new leads to email.");
    return;
  }

  const pendingIds = pendingLeads.map((l) => l.id);
  await db
    .update(leads)
    .set({ status: "queued" })
    .where(inArray(leads.id, pendingIds));

  for (let i = 0; i < pendingLeads.length; i++) {
    const lead = pendingLeads[i];

    const alreadySent = await db.query.emailLogs.findFirst({
      where: and(
        eq(emailLogs.leadId, lead.id),
        eq(emailLogs.status, "sent"),
        gte(emailLogs.sentAt, startOfDay)
      ),
    });

    if (alreadySent) {
      console.log(`⏭️  Lead ${lead.id} already sent today — marking as "sent"`);
      await db.update(leads).set({ status: "sent" }).where(eq(leads.id, lead.id));
      continue;
    }

    if (i > 0) {
      const delayMs = randomBetween(2 * 60 * 1000, 5 * 60 * 1000);
      console.log(`⏳ Waiting ${Math.round(delayMs / 1000)}s before next send...`);
      await sleep(delayMs);
    }
    await sendEmail(mailConfig, copilotId, lead, template);
  }

  console.log("✅ Daily send job complete.");
}

// ─── SMTP test ────────────────────────────────────────────────────────────────

export async function testSmtpConnection(config: {
  host: string;
  port: number;
  email: string;
  pass: string;
  sendName: string;
}): Promise<SendResult> {
  try {
    const transporter = createSmtpTransporter({
      provider: "smtp",
      ...config,
    });
    await transporter.verify();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randomBetween = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
