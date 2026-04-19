import { Router, Request, Response } from "express";
import { settings } from "../db/schema";
import { eq } from "drizzle-orm";
import { testSmtpConnection } from "../services/mailer";
import { restartScheduler } from "../services/scheduler";
import { db } from "../db/drizzle";

export const settingsRouter: Router = Router();

// GET /settings
settingsRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(settings);
    const result = rows.reduce(
      (acc, row) => ({ ...acc, [row.key as string]: row.value }),
      {} as Record<string, string>
    );
    delete result["smtp_pass"];
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

// PATCH /settings
settingsRouter.patch("/", async (req: Request, res: Response) => {
  try {
    const updates = req.body as Record<string, string>;
    if (!updates || typeof updates !== "object") {
      res.status(400).json({ error: "Body must be a key-value object" });
      return;
    }

    await Promise.all(
      Object.entries(updates).map(([key, value]) =>
        db
          .insert(settings)
          .values({ key, value: String(value) })
          .onConflictDoUpdate({
            target: settings.key,
            set: {
              value: String(value),           // ← static column
              updated_at: new Date(),         // ← static column
            },
          })
      )
    );

    const scheduleKeys = ["send_hour", "scrape_hours"];
    if (Object.keys(updates).some((k) => scheduleKeys.includes(k))) {
      await restartScheduler();
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error updating settings:", error);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

// POST /settings/test-smtp
settingsRouter.post("/test-smtp", async (_req: Request, res: Response) => {
  try {
    const result = await testSmtpConnection();
    if (result.success) {
      res.json({ success: true, message: "SMTP connection successful" });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to test SMTP" });
  }
});