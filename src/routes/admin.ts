import { Router, Request, Response, NextFunction } from "express";
import { db } from "../db/drizzle";
import { copilots } from "../db/schema";
import { eq } from "drizzle-orm";
import { updateCopilotStatus } from "../services/copilot.service";
import { restartScheduler, getSchedulerStatus } from "../services/scheduler.service";

export const adminRouter: Router = Router();

// POST /admin/copilots/:id/activate
adminRouter.post("/copilots/:id/activate", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const copilotId = Number(req.params.id);
    const [copilot] = await db.select().from(copilots).where(eq(copilots.id, copilotId));
    if (!copilot) {
      return res.status(404).json({ error: "Copilot not found" });
    }

    const updated = await updateCopilotStatus(copilotId, copilot.userId, { status: "active" });
    await restartScheduler(copilot.userId);

    res.json({ message: "Copilot activated and scheduler re-armed", copilot: updated });
  } catch (err) { next(err); }
});

// GET /admin/scheduler/status
adminRouter.get("/scheduler/status", (_req: Request, res: Response) => {
  res.json(getSchedulerStatus());
});
