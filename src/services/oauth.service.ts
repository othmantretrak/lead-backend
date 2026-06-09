import { google } from "googleapis";
import { db } from "../db/drizzle";
import { oauthStates, emailProfiles } from "../db/schema";
import { and, eq, lt } from "drizzle-orm";
import crypto from "crypto";
import https from "https";

// ─── Constants ────────────────────────────────────────────────────────────────

const GOOGLE_SCOPES = [
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

const MICROSOFT_SCOPES = [
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/User.Read",
  "offline_access",
];

const STATE_TTL_MS = 10 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

export type OAuthProvider = "google" | "microsoft";

export interface OAuthUrlResult {
  url: string;
}

export type OAuthCallbackResult = {
  success: true;
  profileId: number;
  provider: string;
  email: string;
} | {
  success: false;
  error: string;
  errorCode: string;
};

// ─── HTTP helpers (Microsoft only) ────────────────────────────────────────────

function httpsPostForm(url: string, formData: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(formData).toString();
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Invalid JSON response: ${data}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function httpsGet(url: string, accessToken: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Invalid JSON response: ${data}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

// ─── State helpers ────────────────────────────────────────────────────────────

function randomState(): string {
  return crypto.randomBytes(32).toString("hex");
}

async function cleanupExpiredStates(): Promise<void> {
  const cutoff = new Date(Date.now() - STATE_TTL_MS);
  await db.delete(oauthStates).where(lt(oauthStates.createdAt, cutoff));
}

// ─── Google OAuth2 (via googleapis) ───────────────────────────────────────────

function getGoogleOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

async function exchangeGoogleCode(code: string) {
  const auth = getGoogleOAuth2Client();
  const { tokens } = await auth.getToken(code);
  return tokens;
}

async function getGoogleUserInfo(accessToken: string) {
  const auth = getGoogleOAuth2Client();
  auth.setCredentials({ access_token: accessToken });
  const oauth2 = google.oauth2({ version: "v2", auth });
  const { data } = await oauth2.userinfo.get();
  return data;
}

// ─── Microsoft OAuth2 (via raw HTTPS) ─────────────────────────────────────────

function generateMicrosoftAuthUrl(state: string): string {
  const query = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    redirect_uri: process.env.MICROSOFT_REDIRECT_URI!,
    response_type: "code",
    scope: MICROSOFT_SCOPES.join(" "),
    state,
    prompt: "select_account",
  });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${query.toString()}`;
}

async function exchangeMicrosoftCode(code: string) {
  return httpsPostForm("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    code,
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
    redirect_uri: process.env.MICROSOFT_REDIRECT_URI!,
    grant_type: "authorization_code",
  });
}

async function getMicrosoftUserInfo(accessToken: string) {
  return httpsGet("https://graph.microsoft.com/v1.0/me", accessToken);
}

async function refreshMicrosoftToken(refreshToken: string) {
  return httpsPostForm("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    refresh_token: refreshToken,
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
    grant_type: "refresh_token",
  });
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Generates the OAuth authorization URL for the given provider.
 * Creates a CSRF state token stored in the database.
 */
export async function generateAuthUrl(
  provider: OAuthProvider,
  userId: number
): Promise<OAuthUrlResult> {
  await cleanupExpiredStates();
  const state = randomState();

  await db.insert(oauthStates).values({ userId, provider, state });

  let url: string;

  if (provider === "google") {
    const auth = getGoogleOAuth2Client();
    url = auth.generateAuthUrl({
      access_type: "offline",
      scope: GOOGLE_SCOPES,
      state,
      prompt: "consent",
    });
  } else {
    url = generateMicrosoftAuthUrl(state);
  }

  return { url };
}

/**
 * Handles the OAuth callback. Validates the state, exchanges the code for tokens,
 * fetches user info, creates/updates an email profile, and returns the result.
 */
export async function handleCallback(
  provider: OAuthProvider,
  code: string,
  state: string
): Promise<OAuthCallbackResult> {
  if (!code || !state) {
    return { success: false, error: "Missing code or state parameter", errorCode: "missing_params" };
  }

  const [stored] = await db
    .select()
    .from(oauthStates)
    .where(and(eq(oauthStates.state, state), eq(oauthStates.provider, provider)));

  if (!stored) {
    return { success: false, error: "Invalid or expired state parameter", errorCode: "invalid_state" };
  }

  const age = Date.now() - stored.createdAt.getTime();
  if (age > STATE_TTL_MS) {
    await db.delete(oauthStates).where(eq(oauthStates.id, stored.id));
    return { success: false, error: "State parameter expired", errorCode: "state_expired" };
  }

  const userId = stored.userId;
  let tokens: any;
  let userInfo: any;

  try {
    if (provider === "google") {
      tokens = await exchangeGoogleCode(code);
      if (!tokens.access_token || !tokens.refresh_token) {
        await db.delete(oauthStates).where(eq(oauthStates.id, stored.id));
        return {
          success: false,
          error: "Google did not return a refresh token. Ensure the app is verified or try removing access from your Google account and reconnecting.",
          errorCode: "no_refresh_token",
        };
      }
      userInfo = await getGoogleUserInfo(tokens.access_token);
    } else {
      tokens = await exchangeMicrosoftCode(code);
      if (!tokens.access_token || !tokens.refresh_token) {
        await db.delete(oauthStates).where(eq(oauthStates.id, stored.id));
        return {
          success: false,
          error: "Microsoft did not return a refresh token.",
          errorCode: "no_refresh_token",
        };
      }
      userInfo = await getMicrosoftUserInfo(tokens.access_token);
    }
  } catch (err: any) {
    await db.delete(oauthStates).where(eq(oauthStates.id, stored.id));
    return {
      success: false,
      error: err?.message || "Failed to exchange authorization code",
      errorCode: "token_exchange_failed",
    };
  }

  const email =
    provider === "google"
      ? userInfo.email
      : userInfo.mail || userInfo.userPrincipalName;

  const displayName =
    provider === "google"
      ? userInfo.name
      : userInfo.displayName;

  const providerAccountId = userInfo.id;

  if (!email) {
    await db.delete(oauthStates).where(eq(oauthStates.id, stored.id));
    return {
      success: false,
      error: `Could not retrieve email from ${provider} account`,
      errorCode: "email_not_found",
    };
  }

  const mappedProvider = provider === "google" ? "gmail" : "outlook";
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000)
    : null;

  // Upsert email profile
  let [existing] = await db
    .select()
    .from(emailProfiles)
    .where(
      and(
        eq(emailProfiles.userId, userId),
        eq(emailProfiles.provider, mappedProvider),
        eq(emailProfiles.providerAccountId, providerAccountId)
      )
    );

  let profileId: number;

  if (existing) {
    const [updated] = await db
      .update(emailProfiles)
      .set({
        email,
        sendName: displayName || email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: expiresAt,
        status: "active",
        lastVerifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(emailProfiles.id, existing.id))
      .returning();
    profileId = updated.id;
  } else {
    const profileName = provider === "google" ? "My Gmail" : "My Outlook";
    const [created] = await db
      .insert(emailProfiles)
      .values({
        userId,
        profileName,
        email,
        sendName: displayName || email,
        provider: mappedProvider,
        status: "active",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: expiresAt,
        providerAccountId,
        lastVerifiedAt: new Date(),
      })
      .returning();
    profileId = created.id;
  }

  await db.delete(oauthStates).where(eq(oauthStates.id, stored.id));

  return { success: true, profileId, provider, email };
}

/**
 * Refreshes the access token for a given email profile.
 * Returns the new access token string, or null if refresh failed.
 */
export async function refreshAccessToken(profileId: number): Promise<string | null> {
  const [profile] = await db
    .select()
    .from(emailProfiles)
    .where(eq(emailProfiles.id, profileId));

  if (!profile || !profile.refreshToken) return null;

  try {
    let accessToken: string;
    let expiresAt: Date | null;

    if (profile.provider === "gmail") {
      const auth = getGoogleOAuth2Client();
      auth.setCredentials({ refresh_token: profile.refreshToken });
      const { credentials } = await auth.refreshAccessToken();
      accessToken = credentials.access_token!;
      expiresAt = credentials.expiry_date ? new Date(credentials.expiry_date) : null;
    } else if (profile.provider === "outlook") {
      const tokens = await refreshMicrosoftToken(profile.refreshToken);
      accessToken = tokens.access_token;
      expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null;
    } else {
      return null;
    }

    await db
      .update(emailProfiles)
      .set({
        accessToken,
        tokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(emailProfiles.id, profileId));

    return accessToken;
  } catch (err) {
    console.error(`Failed to refresh token for profile ${profileId}:`, err);

    await db
      .update(emailProfiles)
      .set({ status: "error", updatedAt: new Date() })
      .where(eq(emailProfiles.id, profileId));

    return null;
  }
}

/**
 * Returns a valid (non-expired) access token for the given email profile.
 * Refreshes if the token is expired or about to expire (within 5 minutes).
 */
export async function getValidAccessToken(profileId: number): Promise<string | null> {
  const [profile] = await db
    .select()
    .from(emailProfiles)
    .where(eq(emailProfiles.id, profileId));

  if (!profile) return null;
  if (!profile.accessToken) return null;

  if (profile.tokenExpiresAt) {
    const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
    if (profile.tokenExpiresAt < fiveMinFromNow) {
      return refreshAccessToken(profileId);
    }
  }

  return profile.accessToken;
}
