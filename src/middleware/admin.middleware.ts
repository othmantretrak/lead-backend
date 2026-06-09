import { Request, Response, NextFunction } from "express";

export function requireAdminKey(req: Request, res: Response, next: NextFunction) {
  const key = req.headers["x-admin-key"];
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: "Invalid or missing admin key" });
  }
  next();
}
