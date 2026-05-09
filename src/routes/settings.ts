import { Router, Request, Response } from "express";
import { db } from "../db/drizzle";
import {
  emailProfiles,
  scrapeProfiles,
  emailTemplates,
  copilots,
  integrations,
  settings,
  subscriptions,
  invoices,
  leads,
  scrapeJobs,
} from "../db/schema";
import { eq } from "drizzle-orm";

export const settingsRouter: Router = Router();


// ─── Settings ─────────────────────────────────────────────────────────────────
// GET  /api/settings
// PUT  /api/settings
// PUT  /api/settings/password
// DELETE /api/settings/account

settingsRouter.get("", async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(settings);
    // Return as a flat key/value map for easy consumption
    const map = rows.reduce<Record<string, string | null>>((acc, r) => {
      acc[r.key] = r.value;
      return acc;
    }, {});
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

settingsRouter.put("", async (req: Request, res: Response) => {
  try {
    // Body: { [key: string]: string }  e.g. { smtp_host: "smtp.gmail.com", ... }
    const entries = Object.entries(req.body as Record<string, string>);
    for (const [key, value] of entries) {
      const existing = await db.query.settings.findFirst({
        where: eq(settings.key, key),
      });
      if (existing) {
        await db
          .update(settings)
          .set({ value, updatedAt: new Date() })
          .where(eq(settings.key, key));
      } else {
        // userId should come from auth middleware in production
        await db.insert(settings).values({ key, value, userId: req.body.userId ?? 1 });
      }
    }
    res.json({ message: "Settings updated" });
  } catch (err) {
    res.status(500).json({ error: "Failed to update settings" });
  }
});

settingsRouter.put("/password", async (req: Request, res: Response) => {
  try {
    // Expects { currentPassword, newPassword } — hash logic belongs in auth layer
    const { newPassword } = req.body as { newPassword: string };
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    // Stub: real impl would verify currentPassword and hash newPassword
    res.json({ message: "Password updated" });
  } catch (err) {
    res.status(500).json({ error: "Failed to update password" });
  }
});

settingsRouter.delete("/account", async (_req: Request, res: Response) => {
  try {
    // Stub: real impl would delete the authenticated user and cascade via FK
    res.json({ message: "Account deletion scheduled" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete account" });
  }
});
