import type { VercelRequest, VercelResponse } from "@vercel/node";
import { rawKeyValid } from "../../lib/auth.js";
import { fetchAccessToken } from "../../lib/fatsecret.js";
import { methodNotAllowed, sendError, sendJson } from "../../lib/http.js";

/**
 * Step 3 of connecting a FatSecret account. Trades the request token and
 * the PIN the user pasted for a long-lived access token and returns it.
 * Called by the page served from /api/auth/start.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "POST") {
    methodNotAllowed(res, ["POST"]);
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.key !== "string" || !rawKeyValid(body.key)) {
    sendError(res, 401, "Missing or invalid key");
    return;
  }
  const oauthToken = body.oauth_token;
  const oauthTokenSecret = body.oauth_token_secret;
  const verifier = body.verifier;
  if (
    typeof oauthToken !== "string" ||
    typeof oauthTokenSecret !== "string" ||
    typeof verifier !== "string" ||
    !oauthToken ||
    !oauthTokenSecret ||
    !verifier
  ) {
    sendError(res, 400, "oauth_token, oauth_token_secret and verifier are required");
    return;
  }
  const consumerKey = process.env.FATSECRET_CONSUMER_KEY;
  const consumerSecret = process.env.FATSECRET_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) {
    sendError(res, 500, "FATSECRET_CONSUMER_KEY and FATSECRET_CONSUMER_SECRET must be set first");
    return;
  }
  try {
    const { token, tokenSecret } = await fetchAccessToken(
      consumerKey,
      consumerSecret,
      oauthToken,
      oauthTokenSecret,
      verifier,
    );
    sendJson(res, 200, {
      access_token: token,
      access_token_secret: tokenSecret,
    });
  } catch (err) {
    sendError(
      res,
      502,
      err instanceof Error ? err.message : "FatSecret request failed",
    );
  }
}
