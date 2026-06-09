import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { generateAuthUrl, handleCallback } from "../services/oauth.service";

export const oauthRouter: Router = Router();

const FRONTEND_CALLBACK_URL = () =>
  `${process.env.FRONTEND_URL || "http://localhost:3000"}/dashboard/email-profiles/callback`;

const VALID_PROVIDERS = ["google", "microsoft"] as const;

// GET /auth/:provider/url
// Protected: requires Clerk session. Returns the OAuth authorization URL.
oauthRouter.get(
  "/:provider/url",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const provider = req.params.provider as string;
      if (!VALID_PROVIDERS.includes(provider as any)) {
        res.status(400).json({ error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(", ")}` });
        return;
      }

      const result = await generateAuthUrl(provider as "google" | "microsoft", req.dbUser.id);
      res.json({ url: result.url });
    } catch (err) {
      next(err);
    }
  }
);

// GET /auth/:provider/callback
// Public: called by Google/Microsoft after user authorization.
// Validates state, exchanges code for tokens, redirects to frontend callback page.
oauthRouter.get(
  "/:provider/callback",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const provider = req.params.provider as string;
      if (!VALID_PROVIDERS.includes(provider as any)) {
        res.redirect(
          `${FRONTEND_CALLBACK_URL()}?error=invalid_provider&message=Invalid+OAuth+provider`
        );
        return;
      }

      const { code, state } = req.query as { code?: string; state?: string };

      if (!code || !state) {
        res.redirect(
          `${FRONTEND_CALLBACK_URL()}?error=missing_params&message=Missing+code+or+state+parameter`
        );
        return;
      }

      const result = await handleCallback(provider as "google" | "microsoft", code, state);

      if (!result.success) {
        const encodedMessage = encodeURIComponent(result.error);
        res.redirect(
          `${FRONTEND_CALLBACK_URL()}?error=${result.errorCode}&message=${encodedMessage}`
        );
        return;
      }

      res.redirect(
        `${FRONTEND_CALLBACK_URL()}?success=true&provider=${result.provider}&profileId=${result.profileId}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      res.redirect(
        `${FRONTEND_CALLBACK_URL()}?error=server_error&message=${encodeURIComponent(message)}`
      );
    }
  }
);
