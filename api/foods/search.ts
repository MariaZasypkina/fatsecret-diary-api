import type { VercelRequest, VercelResponse } from "@vercel/node";
import { bearerTokenValid } from "../../lib/auth.js";
import { configFromEnv, searchFoods } from "../../lib/fatsecret.js";
import { methodNotAllowed, sendError, sendJson } from "../../lib/http.js";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "POST") {
    methodNotAllowed(res, ["POST"]);
    return;
  }
  if (!bearerTokenValid(req)) {
    sendError(res, 401, "Missing or invalid bearer token");
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const query = body.query;
  if (typeof query !== "string" || query.trim().length === 0) {
    sendError(res, 400, "query is required");
    return;
  }
  const maxResults =
    typeof body.max_results === "number"
      ? Math.min(50, Math.max(1, Math.floor(body.max_results)))
      : 10;
  const pageNumber =
    typeof body.page_number === "number"
      ? Math.max(0, Math.floor(body.page_number))
      : 0;
  try {
    const result = await searchFoods(
      query.trim(),
      maxResults,
      pageNumber,
      configFromEnv(process.env),
    );
    sendJson(res, 200, result);
  } catch (err) {
    sendError(
      res,
      502,
      err instanceof Error ? err.message : "FatSecret request failed",
    );
  }
}
