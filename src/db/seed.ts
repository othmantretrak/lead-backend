import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { settings, emailTemplates } from "./schema";
import { eq } from "drizzle-orm";

const client = postgres(process.env.DATABASE_URL!, { ssl: "require" });
const db = drizzle(client);

async function main() {
  console.log("🌱 Seeding database...");

  const defaultSettings = [
    { key: "daily_send_limit",       value: "10" },
    { key: "scrape_query",           value: "restaurants in Paris" },
    { key: "scrape_results_per_run", value: "10" },
    { key: "send_hour",              value: "9" },
    { key: "scrape_hours",           value: "8,14" },
    { key: "smtp_host",              value: "" },
    { key: "smtp_port",              value: "587" },
    { key: "smtp_user",              value: "" },
    { key: "smtp_pass",              value: "" },
    { key: "smtp_from_name",         value: "" },
  ];

  for (const s of defaultSettings) {
    const existing = await db
      .select()
      .from(settings)
      .where(eq(settings.key, s.key))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(settings).values(s);
      console.log(`   ✅ Setting: ${s.key}`);
    } else {
      console.log(`   ⏭️  Setting already exists: ${s.key}`);
    }
  }

  const existingTemplate = await db.select().from(emailTemplates).limit(1);

  if (existingTemplate.length === 0) {
    await db.insert(emailTemplates).values({
      name:     "Cold outreach v1",
      subject:  "Quick question for {{companyName}}",
      body:     `Hi,\n\nI came across {{companyName}} and wanted to reach out quickly.\n\n[Your value proposition here]\n\nWould you be open to a short 15-minute call this week?\n\nBest,\n[Your name]`,
      isActive: true,
    });
    console.log("   ✅ Starter email template seeded");
  } else {
    console.log("   ⏭️  Email template already exists");
  }

  console.log("✅ Seed complete");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Seed failed:", e);
  process.exit(1);
});
